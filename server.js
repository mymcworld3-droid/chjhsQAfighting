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

// ⭐ 初始化 Gemini 2.5 模型 (保留用於生成文字)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemma-4-31b-it"
});

// 根目錄路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// API 1: 分析使用者輸入的弱項 (保持不變)
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
// API 3: 取得伺服器上的圖片列表 (保持不變，用於靜態資源)
// ==========================================
app.get('/api/assets', (req, res) => {
    const assetsDir = path.join(__dirname, 'public', 'assets');
    
    fs.readdir(assetsDir, (err, files) => {
        if (err) {
            console.error("無法讀取 assets 資料夾:", err);
            return res.status(500).json({ error: "無法讀取圖片列表" });
        }
        
        const images = files.filter(file => /\.(png|jpg|jpeg|gif|webp)$/i.test(file));
        const imagePaths = images.map(file => `assets/${file}`);
        res.json({ images: imagePaths });
    });
});

// ==========================================
// API 4: 取得題庫檔案列表 (保持不變)
// ==========================================
app.get('/api/banks', (req, res) => {
    const banksDir = path.join(__dirname, 'public', 'banks');

    if (!fs.existsSync(banksDir)) {
        fs.mkdirSync(banksDir);
    }

    const getFilesRecursively = (dir, fileList = [], rootDir = banksDir) => {
        const files = fs.readdirSync(dir);
        
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                getFilesRecursively(filePath, fileList, rootDir);
            } else {
                if (file.endsWith('.json')) {
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
// 定義學科與子題型架構 (Knowledge Schema)
// ==========================================
// (這裡原本的 SUBJECT_DETAILS 和 SUBJECT_SCHEMA 保持不變，省略以節省篇幅)
const SUBJECT_DETAILS = {
    "國文": {
        "字形字音字義": "測驗對日常常用字、古今異義字、一字多義的理解。",
        "詞語與成語": "考查詞語的褒貶意涵、語境運用、古今差異。",
        "修辭與句法": "判斷文句中使用的修辭與句子結構。",
        "國學與文化常識": "文學史、題辭、書法、對聯、應用文（書信、公文）等知識。",
        "白話文閱讀": "理解文章主旨、擷取訊息、語意分析。",
        "文言文閱讀": "文意詮釋、古文句式翻譯、作者觀點分析。",
        "跨文本比較": "將文言文與白話文內容連結、主題相近的文章對比分析。"
    },
    "英文": {
        "詞彙與字彙": "測驗單字詞性、時態及搭配用法。解析請用中文",
        "綜合測驗(Cloze)": "克漏字，測驗文意發展、語法與單字理解。解析請用中文",
        "文意選填(Matching)": "給定短文與數個空格及選項，測驗判斷單字詞性與上下文脈絡。解析請用中文",
        "篇章結構": "將句子或段落填回文章，依據連接詞、轉折詞推敲邏輯。解析請用中文",
        "閱讀測驗": "根據短文理解內容、找出主題句、推理或主旨。解析請用中文"
    },
    "數學": {
        "基礎計算": "快速反應運算能力。",
        "應用素養": "結合實際情境（如披薩分割、銀行利率），考驗將文字轉化為數學模型。",
        "幾何題": "利用圖形性質（如三角形、圓、平行四邊形）進行推理。",
        "代數與函數": "不等式、數列、三角函數、矩陣等運算。",
        "證明題": "嚴謹推導公式或定理。"
    },
    "公民": {
        "法律應用": "給予一段社會新聞或契約糾紛，要求考生判斷適用何種法律（如行政法、勞基法）或程序原則。",
        "經濟圖表": "分析市場供給、需求曲線，或計算機會成本、GDP 組成、匯率變動對貿易的影響。",
        "政治體制": "比較不同國家的政府體制、選舉制度。",
        "時事解析": "融入性別平等、國際衝突（如俄烏戰爭）等議題，測驗學生對公民素養的反思。"
    },
    "歷史": {
        "史料解析": "提供一段日記、古籍或報章雜誌，要求考生辨識作者立場，並從文字中推論出當時的社會背景。",
        "時空定位": "將歷史事件與地理空間結合，例如分析特定時期的全球貿易網絡或戰爭路線。",
        "因果推導": "探討某個政策或文化交流如何影響後續的發展。",
        "多重敘事": "呈現對同一個歷史事件的不同描述，要求學生進行比較並分析背後的差異性。"
    },
    "地理": {
        "地形判讀": "要求閱讀等高線圖、衛星影像或統計圖表（如氣候圖、風花圖），判斷當地的自然環境特徵。",
        "區域分析": "根據經緯度、氣候、產業發展等條件，辨識出特定區域（如臺灣分區或世界主要國家）。",
        "GIS應用": "測驗對於空間資訊收集、分析與應用（如公民科學）的理解。",
        "環境議題": "討論氣候變遷、能源轉型、永續發展等「人與環境」的連動問題。"
    },
    "物理": {
        "運動與力學": "大量出現 v-t 圖、位移與路徑長的比較，要求學生判讀物體運動狀態。",
        "定性分析": "測驗基本定義，例如電場的 SI 單位，或分析能量守恆、動能變化量而不需複雜計算。",
        "生活應用": "結合時事或新技術，如小型模組化反應爐（SMR）發電原理或汽車安全設備的物理機制。"
    },
    "化學": {
        "混合單元": "同一題組可能同時考物質性質、原子結構與化學反應（如莫耳數計量）。",
        "數據判讀": "溶解度曲線、飽和水氣壓圖表，或根據實驗步驟推論未知化合物成分。",
        "實務能源": "綠色能源（鋰離子電池、儲氫材料）與環境保護（海洋淡化、碳捕獲）等素養題材常見。"
    },
    "生物": {
        "實驗探究": "考查對實驗數據的分析與結論推論，例如判斷植物維管束構造或酵素活性變化。",
        "情境閱讀": "長文章敘述一種生物現象（如珊瑚成長與地球自轉的關係），要求考生從文中抓取關鍵資訊解題。",
        "微觀與宏觀": "細胞生理（微觀）與生態環境（宏觀）的連結，如氣候變遷對特定生物生理特性的影響。"
    }
};

const SUBJECT_SCHEMA = {};
for (const [subj, details] of Object.entries(SUBJECT_DETAILS)) {
    SUBJECT_SCHEMA[subj] = Object.keys(details);
}

function getRandomItem(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// API 2: 生成測驗題目
// Gemma 4 31B
// 流程：
// Gemma 直接生成
// → Node.js 基本 JSON 檢查
// → 通過：直接回傳
// → 失敗：整題丟掉
// → 重新生成
//
// 不進行 AI 審核
// 不進行品質修正
// ==========================================

app.post('/api/generate-quiz', async (req, res) => {

    let {
        subject,
        level,
        rank,
        difficulty,
        knowledgeMap,
        specificTopic,
        topic
    } = req.body;

    let targetTopic = specificTopic || topic;

    // ==========================================
    // 1. 科目選擇
    // ==========================================

    if (!subject) {
        const allSubjects = Object.keys(SUBJECT_SCHEMA);
        subject = getRandomItem(allSubjects);
    }

    // ==========================================
    // 2. 子題型選擇
    // ==========================================

    if (!targetTopic && SUBJECT_SCHEMA[subject]) {
        targetTopic = getRandomItem(SUBJECT_SCHEMA[subject]);
    }

    if (!targetTopic) {
        targetTopic = "綜合測驗";
    }

    // ==========================================
    // 3. 取得題型說明
    // ==========================================

    let topicDescription = "";

    if (
        SUBJECT_DETAILS[subject] &&
        SUBJECT_DETAILS[subject][targetTopic]
    ) {
        topicDescription =
            SUBJECT_DETAILS[subject][targetTopic];
    }

    // ==========================================
    // 4. 建構玩家診斷資訊
    // ==========================================

    let diagnosticInfo = "";

    if (
        knowledgeMap &&
        knowledgeMap[subject] &&
        knowledgeMap[subject][targetTopic]
    ) {

        const stats =
            knowledgeMap[subject][targetTopic];

        const accuracy =
            stats.total > 0
                ? ((stats.correct / stats.total) * 100).toFixed(1)
                : 0;

        diagnosticInfo =
            `[玩家數據] 在「${subject}-${targetTopic}」上正確率為 ${accuracy}% (已練 ${stats.total} 題)。`;

        // 保留你原本的難度自動調整機制
        if (stats.total > 3 && accuracy < 40) {
            difficulty = "easy";
        }

        if (stats.total > 5 && accuracy > 80) {
            difficulty = "hard";
        }
    }

    // ==========================================
    // 5. 每一次重新生成，都建立新的 randomSeed
    // ==========================================

    const maxAttempts = 3;

    // ==========================================
    // 6. 開始生成
    // ==========================================

    for (let attempts = 1; attempts <= maxAttempts; attempts++) {

        const randomSeed =
            Math.random().toString(36).substring(2, 10);

        const generationPrompt = `
生成一道「${subject}」的「${targetTopic}」單選題。

程度：${level}
段位：${rank}
難度：${difficulty}

題型要求：
${topicDescription}

${diagnosticInfo}

只輸出 JSON，不要 Markdown：

{
  "q": "題目",
  "correct": "正確答案",
  "wrong": ["錯誤1", "錯誤2", "錯誤3"],
  "exp": "繁體中文解析",
  "subject": "${subject}",
  "sub_topic": "${targetTopic}"
}

要求：
- 只有一個正確答案
- wrong 必須正好 3 個
- correct 不得出現在 wrong
- 四個選項不得重複
`;

        try {

            console.log(
                `[Gemma Gen] ${subject} > ${targetTopic} (${difficulty}) - 嘗試 ${attempts}/${maxAttempts}`
            );

            // ==========================================
            // Gemma 直接生成
            // ==========================================

            const genResult =
                await model.generateContent(generationPrompt);

            const rawText =
                genResult.response.text();

            console.log(
                `[Gemma Raw] ${rawText.substring(0, 300)}`
            );

            // ==========================================
            // Node.js 基本 JSON 解析
            // ==========================================

            const jsonMatch =
                rawText.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error(
                    "找不到 JSON"
                );
            }

            const parsed =
                JSON.parse(jsonMatch[0]);

            // ==========================================
            // Node.js 基本結構檢查
            //
            // 注意：
            // 這裡只檢查「格式」
            // 不做 AI 品質判斷
            // 不修改內容
            // ==========================================

            if (
                !parsed ||
                typeof parsed !== "object"
            ) {
                throw new Error(
                    "JSON 不是物件"
                );
            }

            if (
                typeof parsed.q !== "string" ||
                parsed.q.trim() === ""
            ) {
                throw new Error(
                    "缺少 q"
                );
            }

            if (
                typeof parsed.correct !== "string" ||
                parsed.correct.trim() === ""
            ) {
                throw new Error(
                    "缺少 correct"
                );
            }

            if (
                !Array.isArray(parsed.wrong)
            ) {
                throw new Error(
                    "wrong 不是陣列"
                );
            }

            if (
                parsed.wrong.length !== 3
            ) {
                throw new Error(
                    "wrong 必須有 3 個選項"
                );
            }

            if (
                parsed.wrong.some(
                    item =>
                        typeof item !== "string" ||
                        item.trim() === ""
                )
            ) {
                throw new Error(
                    "wrong 包含無效選項"
                );
            }

            if (
                typeof parsed.exp !== "string"
            ) {
                throw new Error(
                    "缺少 exp"
                );
            }

            // ==========================================
            // 基本答案檢查
            //
            // 只檢查資料結構與明顯錯誤
            // 不做內容品質修正
            // ==========================================

            if (
                parsed.wrong.includes(
                    parsed.correct
                )
            ) {
                throw new Error(
                    "correct 同時存在於 wrong"
                );
            }

            const allOptions = [
                parsed.correct,
                ...parsed.wrong
            ];

            const uniqueOptions =
                new Set(allOptions);

            if (
                uniqueOptions.size !== 4
            ) {
                throw new Error(
                    "選項存在重複"
                );
            }

            // ==========================================
            // 補上系統欄位
            //
            // 這不是品質修正，
            // 只是確保 API 回傳欄位存在。
            // ==========================================

            if (!parsed.subject) {
                parsed.subject = subject;
            }

            if (!parsed.sub_topic) {
                parsed.sub_topic = targetTopic;
            }

            // ==========================================
            // 通過基本檢查
            //
            // 直接回傳
            // 不再呼叫任何 Gemini 審核
            // ==========================================

            console.log(
                `[Gemma OK] ${subject} > ${targetTopic}`
            );

            return res.json({
                text: JSON.stringify(parsed)
            });

        } catch (error) {

            // ==========================================
            // 這一題直接丟掉
            // 不修正
            // 不審核
            // 不要求 AI 修改
            // ==========================================

            console.error(
                `[Gemma Reject] 嘗試 ${attempts}:`,
                error.message
            );

            // 如果還有次數，就重新生成
            if (attempts < maxAttempts) {

                console.log(
                    `[Gemma Retry] 丟棄這一題，重新生成...`
                );

                continue;
            }

            // ==========================================
            // 3 次都失敗
            // ==========================================

            return res.status(500).json({
                error: "生成失敗"
            });
        }
    }
});

// ==========================================
// API 5: 取得中學單元列表 (遞迴讀取)
// ==========================================
// 🔥 server.js 修正：新增單元列表 API
app.get('/api/units', (req, res) => {
    const unitsDir = path.join(__dirname, 'public', 'middle_school_unit_name');
    if (!fs.existsSync(unitsDir)) fs.mkdirSync(unitsDir, { recursive: true });

    const getFiles = (dir, list = [], root = unitsDir) => {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) getFiles(filePath, list, root);
            else list.push(path.relative(root, filePath).split(path.sep).join('/'));
        });
        return list;
    };
    try { res.json({ files: getFiles(unitsDir) }); } 
    catch (e) { console.error("API Error (/api/units):", e); res.json({ files: [] }); }
});
// [已刪除] /api/generate-image 路由已移除，節省費用

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
