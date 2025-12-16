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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 根目錄路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/generate-quiz', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        // 🚨 修正點 1：嘗試改用 "-it" 結尾的模型名稱 (Instruction Tuned)
        // 如果 gemma-3-27b-it 還是報錯，請暫時改回 gemini-1.5-flash 測試是否為帳號權限問題
        const modelName = "gemma-3-27b-it"; 
        
        console.log(`正在使用模型: ${modelName} 請求中...`);
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("✅ 生成成功！");
        res.json({ text: text });

    } catch (error) {
        // 🚨 修正點 2：印出更詳細的錯誤資訊到終端機，方便除錯
        console.error("❌ Backend Error Details:", error);
        
        // 檢查是否為模型不支援
        let errorMsg = error.message || "Internal Server Error";
        if (error.message.includes("404") || error.message.includes("not found")) {
            errorMsg = "找不到指定的模型 (Model not found)。請確認該模型是否有權限使用，或嘗試改回 gemini-1.5-flash。";
        }

        res.status(500).json({ error: errorMsg });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
