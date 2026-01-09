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
// --- 修改 API 2: 生成具備診斷功能的測驗題目 ---
app.post('/api/generate-quiz', async (req, res) => {
    // 接收知識地圖數據
    const { subject, level, rank, difficulty, knowledgeMap } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    const randomSeed = Math.random().toString(36).substring(7);

    // 根據知識地圖動態調整難度描述
    let diagnosticInfo = "";
    if (knowledgeMap && knowledgeMap[subject]) {
        const stats = knowledgeMap[subject];
        const accuracy = (stats.correct / stats.total) * 100;
        diagnosticInfo = `玩家在此科目[${subject}]的正確率為 ${accuracy.toFixed(1)}%，平均答題時間為 ${stats.avgTime.toFixed(1)}秒。`;
    }

    const generationPrompt = `
        [系統指令]
        角色：AI 智能教育診斷專家
        任務：出一道單選題，並根據玩家能力進行調整。
        隨機因子：${randomSeed}

        [玩家背景數據]
        學歷程度：${level || "一般"}
        目前段位：${rank || "新手"}
        指定難度：${difficulty || "medium"}
        ${diagnosticInfo}

        [出題策略引導]
        1. 針對「${subject}」領域出題。
        2. 如果玩家正確率高且速度快，請增加題目複雜度，引入跨領域概念。
        3. 如果玩家速度慢但正確率高，請出一些需要邏輯推理而非記憶性的題目。
        4. 如果玩家正確率低，請將難度調至最低，並提供更詳細的解析。

        [回傳純 JSON 格式]
        {
            "q": "題目敘述...",
            "correct": "正確答案",
            "wrong": ["錯1", "錯2", "錯3"],
            "exp": "解析：請針對題目考查的知識點進行深度說明，並給予學習建議。",
            "sub_topic": "此題細分的具體知識點"
        }
    `;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Diagnostic Gen] Subject: ${subject}`);
            const genResult = await model.generateContent(generationPrompt);
            let rawText = genResult.response.text();
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

            const parsed = JSON.parse(rawText);
            return res.json({ text: JSON.stringify(parsed) });

        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            if (attempts === maxAttempts) return res.status(500).json({ error: "AI 思考超時" });
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
