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

// ⭐ 初始化 Gemini 2.0 Flash 模型
// 使用 'gemini-2.0-flash-exp' (目前最快且支援 JSON 模式的版本)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp", 
    generationConfig: { responseMimeType: "application/json" } // 強制 JSON 模式
});

// 根目錄路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: 生成測驗題目 (包含重試機制)
app.post('/api/generate-quiz', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    // --- 🛡️ 防彈重試機制 ---
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Attempt ${attempts + 1}] Generating quiz with Gemini 2.0...`);
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();

            // 強力清洗：移除 Markdown 符號
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();

            // 自我驗證：確保是有效的 JSON
            JSON.parse(text); 

            console.log("✅ 生成成功！");
            return res.json({ text: text });

        } catch (error) {
            console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            
            if (attempts === maxAttempts) {
                let errorMsg = "AI 連線繁忙，請稍後再試。";
                if (error.message.includes("429")) {
                    errorMsg = "今日 API 使用額度已達上限 (429)，請明天再來。";
                } else if (error.message.includes("not found")) {
                    errorMsg = "找不到 Gemini 2.0 模型，請檢查 API Key 權限。";
                }
                return res.status(500).json({ error: errorMsg, details: error.message });
            }
        }
    }
});

// API: 分析使用者輸入的弱項 (資料清洗)
app.post('/api/analyze-subjects', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text || text.trim().length === 0) {
            return res.json({ subjects: "" });
        }

        const prompt = `
            任務：分析使用者的輸入文字，提取出「學科」或「知識領域」關鍵字。
            使用者輸入：${text}
            
            要求：
            1. 去除廢話 (如 "我不太會", "還有", "超級爛")。
            2. 統一用「繁體中文」的正式名稱 (如 "Math" -> "數學", "理化" -> "物理, 化學")。
            3. 回傳純 JSON，格式：{ "subjects": "科目A, 科目B, 科目C" }
            4. 用逗號分隔，不要有陣列符號。
            5. 如果輸入完全無關或無法辨識，回傳 { "subjects": "綜合常識" }
        `;

        // 這裡也使用 Gemini 2.0
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(jsonText);
        res.json({ subjects: parsed.subjects });

    } catch (error) {
        console.error("Analyze Error:", error);
        // 如果 AI 失敗，就原樣回傳，至少不要讓程式當掉
        res.json({ subjects: req.body.text }); 
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
