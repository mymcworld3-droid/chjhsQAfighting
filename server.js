const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
    model: "gemini-2.5-flash-lite", // 建議改回這個
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
// API 3: 取得伺服器上的圖片列表 (新增功能)
// ==========================================
app.get('/api/assets', (req, res) => {
    const assetsDir = path.join(__dirname, 'public', 'assets');
    
    // 讀取資料夾
    fs.readdir(assetsDir, (err, files) => {
        if (err) {
            console.error("無法讀取 assets 資料夾:", err);
            return res.status(500).json({ error: "無法讀取圖片列表" });
        }
        
        // 過濾出圖片檔 (png, jpg, jpeg, webp, gif)
        const images = files.filter(file => /\.(png|jpg|jpeg|gif|webp)$/i.test(file));
        
        // 回傳格式：加上資料夾前綴 (例如: "assets/abc.png")
        const imagePaths = images.map(file => `assets/${file}`);
        res.json({ images: imagePaths });
    });
});

// ==========================================
// API 4: 取得題庫檔案列表 (支援子資料夾)
// ==========================================
app.get('/api/banks', (req, res) => {
    const banksDir = path.join(__dirname, 'public', 'banks');

    // 如果資料夾不存在，建立它
    if (!fs.existsSync(banksDir)) {
        fs.mkdirSync(banksDir);
    }

    // 定義遞迴讀取函式
    const getFilesRecursively = (dir, fileList = [], rootDir = banksDir) => {
        const files = fs.readdirSync(dir);
        
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                // 如果是資料夾，繼續往下找
                getFilesRecursively(filePath, fileList, rootDir);
            } else {
                // 如果是檔案，且是 .json 結尾
                if (file.endsWith('.json')) {
                    // 計算相對路徑 (例如: "歷史/grade1.json")
                    // 並將 Windows 的反斜線 (\) 統一轉為正斜線 (/)
                    const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
                    fileList.push(relativePath);
                }
            }
        });
        return fileList;
    };

    try {
        const allFiles = getFilesRecursively(banksDir);
        res.json({ files: allFiles });
    } catch (e) {
        console.error("讀取題庫失敗:", e);
        res.json({ files: [] });
    }
});

// ==========================================
// API 2: 生成測驗題目 (包含自動審查機制)
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    const { subject, level, rank, difficulty } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    const randomSeed = Math.random().toString(36).substring(7);

    // 定義難度描述
    let difficultyDesc = "適中";
    if (difficulty === 'easy') difficultyDesc = "簡單直觀，適合初學者";
    if (difficulty === 'hard') difficultyDesc = "困難，需要深入思考或冷門知識";

    // --- 步驟 1: 生成題目 (Generator) ---
    const generationPrompt = `
        [系統指令]
        角色：創意題庫出題者
        任務：出一道單選題。
        隨機因子：${randomSeed}

        [玩家數據]
        程度：${level || "一般"}
        段位：${rank || "新手"}
        題目難度：${difficultyDesc} (重要！)。
        
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
