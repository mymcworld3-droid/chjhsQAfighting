const express = require('express');
const cors = require('cors');
const path = require('path'); // 👈 新增這個套件用來處理路徑
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 👇👇👇 關鍵修改 1：設定靜態檔案目錄 👇👇👇
// 告訴 Express，public 資料夾裡的東西都是可以直接給瀏覽器看的
app.use(express.static(path.join(__dirname, 'public')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 👇👇👇 關鍵修改 2：首頁路由 👇👇👇
// 當使用者進入首頁 ('/') 時，傳送 index.html 給他
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/generate-quiz', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ text: text });

    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
