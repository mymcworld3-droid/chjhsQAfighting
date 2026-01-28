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

const SUBJECT_SCHEMA = {
    "國文": ["字形字音字義", "詞語成語", "修辭句法", "國學常識", "白話閱讀", "文言閱讀", "跨文本比較", "圖表判讀"],
    "英文": ["詞彙字彙", "綜合測驗(Cloze)", "文意選填", "篇章結構", "閱讀測驗"],
    "數學": ["基礎計算", "應用素養", "幾何圖形", "代數函數", "邏輯證明", "統計機率"],
    "公民": ["法律應用", "經濟圖表", "政治體制", "時事解析"],
    "歷史": ["史料解析", "時空定位", "因果推導", "多重敘事"],
    "地理": ["地形判讀", "區域分析", "GIS應用", "環境議題"],
    "物理": ["力學圖表", "定性分析", "生活應用"],
    "化學": ["混合概念", "數據判讀", "實務能源"],
    "生物": ["實驗探究", "情境閱讀", "微觀宏觀"]
};
// ==========================================
// API 2: 生成測驗題目 (包含自動審查機制)
// ==========================================
// --- 修改 API 2: 生成具備診斷功能的測驗題目 ---
app.post('/api/generate-quiz', async (req, res) => {
    // 接收參數：subject (主科), specificTopic (指定子題, 可選)
    let { subject, level, rank, difficulty, knowledgeMap, specificTopic } = req.body;
    
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    // 1. 決定子題型 (Topic)
    // 如果前端沒指定，則由後端隨機選一個 (預設行為)
    let targetTopic = specificTopic;
    if (!targetTopic && SUBJECT_SCHEMA[subject]) {
        targetTopic = getRandomItem(SUBJECT_SCHEMA[subject]);
    }
    // 防呆：如果是不認識的科目，給個預設值
    if (!targetTopic) targetTopic = "綜合測驗";

    // 2. 建構診斷資訊 (Diagnostic Info)
    // 我們希望 AI 知道玩家在這個「特定子題」上的表現，而不只是整科
    let diagnosticInfo = "";
    if (knowledgeMap && knowledgeMap[subject] && knowledgeMap[subject][targetTopic]) {
        const stats = knowledgeMap[subject][targetTopic];
        const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
        diagnosticInfo = `[玩家數據] 在「${subject}-${targetTopic}」題型上，正確率為 ${accuracy}% (共練習 ${stats.total} 題)。`;
        
        // 動態難度調整
        if (stats.total > 3 && accuracy < 40) difficulty = "easy"; // 錯太多自動降難度
        if (stats.total > 5 && accuracy > 80) difficulty = "hard"; // 太強自動升難度
    }

    const randomSeed = Math.random().toString(36).substring(7);

    // 3. 全新設計的 Prompt 結構
    const generationPrompt = `
        [系統指令]
        你是由 Google 開發的 AI 教育專家，請生成一道高品質的「單選題」。
        
        [出題規格]
        1. **主科目**：${subject}
        2. **指定題型**：${targetTopic} (請務必符合此題型的測驗目標)
        3. **適用程度**：${level} (段位：${rank})
        4. **難度設定**：${difficulty}
        5. **隨機因子**：${randomSeed}
        ${diagnosticInfo}

        [題型定義參考]
        - 若為「閱讀測驗」或「史料解析」，請提供一段短文或引言作為題幹。
        - 若為「素養題」或「情境題」，請設計一個生活化或學術情境。
        - 若為「圖表題」，請用文字詳細描述圖表數據 (因目前無法生成圖片)。

        [輸出格式 (JSON Only)]
        請直接回傳 JSON，不要 markdown 標記：
        {
            "q": "題目敘述...",
            "correct": "正確選項內容",
            "wrong": ["錯誤選項1", "錯誤選項2", "錯誤選項3"],
            "exp": "解析：針對 ${targetTopic} 概念進行解說...",
            "subject": "${subject}",
            "sub_topic": "${targetTopic}" 
        }
    `;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Gen] ${subject} > ${targetTopic} (${difficulty})`); // Log 方便除錯
            const genResult = await model.generateContent(generationPrompt);
            let rawText = genResult.response.text();
            rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(rawText);
        
            // 確保回傳資料包含 sub_topic 供前端統計使用
            if(!parsed.sub_topic) parsed.sub_topic = targetTopic;
        
            res.json({ text: JSON.stringify(parsed) });
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
