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
    model: "gemini-2.5-flash", 
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

app.post('/api/generate-quiz', async (req, res) => {
    // 1. 接收前端傳來的「參數」，而不是完整的 Prompt
    const { subject, level, rank } = req.body;

    // 簡單驗證
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    // 2. 在後端生成隨機因子
    const randomSeed = Math.random().toString(36).substring(7);

    // 3. ⭐ 在後端組裝 Prompt (這樣前端就看不到了，比較安全)
    const prompt = `
        [系統指令]
        角色：專業題庫老師
        當前任務：出一道單選題。
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

    // --- 🛡️ 防彈重試機制 ---
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Attempt ${attempts + 1}] Generating quiz for topic: ${subject}...`);
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            let text = response.text();

            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            JSON.parse(text); // 驗證格式

            console.log("✅ 生成成功！");
            return res.json({ text: text });

        } catch (error) {
            console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            
            if (attempts === maxAttempts) {
                let errorMsg = "AI 連線繁忙，請稍後再試。";
                if (error.message.includes("429")) {
                    errorMsg = "今日 API 使用額度已達上限 (429)。";
                }
                return res.status(500).json({ error: errorMsg, details: error.message });
            }
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
