const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⭐ 初始化 Gemini 2.5 模型
// ⚠️ 警告：根據你的資料，此模型每日限制可能僅有 10-20 次
// 如果遇到 429 錯誤，請改回 'gemini-2.0-flash-exp' 或 'gemini-1.5-flash'
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite", 
    generationConfig: { responseMimeType: "application/json" }
});

// 根目錄路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// API 1: 分析使用者輸入的弱項
// ==========================================
app.post('/api/analyze-subjects', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.trim().length === 0) return res.json({ subjects: "" });

        const prompt = `
            任務：分析使用者的輸入文字，提取出「學科」或「知識領域」關鍵字。
            輸入：${text}
            要求：統一用繁體中文正式名稱，回傳純 JSON { "subjects": "科目A, 科目B" }。
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonText);
        res.json({ subjects: parsed.subjects });

    } catch (error) {
        console.error("Analyze Error:", error);
        res.json({ subjects: req.body.text }); 
    }
});

// ==========================================
// API 2: 生成測驗題目 (包含自動審查機制)
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    const { subject, level, rank } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    const randomSeed = Math.random().toString(36).substring(7);

    // --- 步驟 1: 生成題目 (Generator) ---
    const generationPrompt = `
        [系統指令]
        角色：創意題庫出題者
        任務：出一道單選題。
        隨機因子：${randomSeed}

        [玩家數據]
        程度：${level || "一般"}
        段位：${rank || "新手"}
        
        [出題核心要求]
        1. ⚠️ **指定主題**：請務必針對「${subject}」這個領域出題。
        2. 若該主題非學科(如動漫)，請出趣味題；若為學科，請結合生活應用。
        3. 請提供 1 個正確選項，以及 3 個具誘答性的錯誤選項。
        4. **回傳純 JSON**，格式如下 (不要 Markdown)：

        {
            "q": "題目敘述...",
            "correct": "正確選項的文字",
            "wrong": ["錯誤選項1", "錯誤選項2", "錯誤選項3"],
            "exp": "解析：解釋為什麼正確，並補充相關知識..." 
        }
    `;

    // --- 🛡️ 重試機制 (包含審查步驟) ---
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Attempt ${attempts + 1}] Step 1: Generating (${subject})...`);
            
            // 1. 初次生成
            const genResult = await model.generateContent(generationPrompt);
            let rawText = genResult.response.text();
            
            // 清理 Markdown (防止 AI 加了 ```json)
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

            // --- 步驟 2: 自我審查與修正 (Critic) ---
            console.log(`[Attempt ${attempts + 1}] Step 2: Validating...`);
            
            const validationPrompt = `
                [系統指令：嚴格審查員]
                你現在是審題老師，請檢查以下 AI 生成的題目 JSON。
                
                [待審查 JSON]
                ${rawText}

                [審查標準]
                1. **正確性**： "correct" 的答案是否絕對正確？
                2. **唯一性**： "wrong" 選項中是否有正確答案？(確保只有一個正解)
                3. **邏輯性**： 題目敘述是否通順？
                4. **格式**： 是否符合 JSON 格式？

                [輸出要求]
                - 如果發現錯誤：請修正它，並輸出修正後的 **純 JSON**。
                - 如果完全正確：請直接輸出原 JSON。
                - 不要輸出任何解釋文字，只要 JSON。
            `;

            const valResult = await model.generateContent(validationPrompt);
            let finalText = valResult.response.text();
            
            // 清理驗證後的文字
            finalText = finalText.replace(/```json/g, '').replace(/```/g, '').trim();

            // 測試能否解析 (確保是有效 JSON)
            JSON.parse(finalText); 

            console.log("✅ 審查通過，生成成功！");
            return res.json({ text: finalText });

        } catch (error) {
            console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            
            if (attempts === maxAttempts) {
                let errorMsg = "AI 連線繁忙，請稍後再試。";
                if (error.message.includes("429")) {
                    errorMsg = "❌ Gemini API 額度已用完。";
                }
                return res.status(500).json({ error: errorMsg, details: error.message });
            }
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
