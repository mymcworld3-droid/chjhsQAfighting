const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 允許跨網域請求 (重要！否則前端連不上)
app.use(cors());
app.use(express.json());

// 初始化 Gemini
// 注意：這裡我們使用環境變數，絕對不把 Key 寫死在程式碼裡
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
    res.send('✅ Server is running! API endpoint is at /api/generate-quiz');
});

app.post('/api/generate-quiz', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // 這裡可以隨時切換你想用的模型，例如 'gemini-1.5-flash' 或 'gemini-2.0-flash-exp'
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 直接回傳 AI 的原始文字，讓前端去處理 JSON 解析
        res.json({ text: text });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
