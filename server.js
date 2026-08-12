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

// ⭐ 初始化 Gemma 模型
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemma-4-31b" 
    // 🚨 修正：移除了 responseMimeType: "application/json"
    // 因為 Gemma 模型不支援此強制屬性，帶上它會導致 API 回傳 400 錯誤並觸發 500 Server Error
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
        const rawText = result.response.text();
        
        // 🚨 修正：過濾 Gemma 思考區塊與安全提取 JSON
        let cleanedText = rawText.replace(/<\|?think\|?>[\s\S]*?<\/\|?think\|?>/gi, '');
        let startIdx = cleanedText.indexOf('{');
        let endIdx = cleanedText.lastIndexOf('}');
        let jsonText = cleanedText.substring(startIdx, endIdx + 1);
        
        const parsed = JSON.parse(jsonText);
        res.json({ subjects: parsed.subjects });

    } catch (error) {
        console.error("Analyze Error:", error);
        res.json({ subjects: req.body.text }); 
    }
});

// ==========================================
// API 3: 取得伺服器上的圖片列表
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
// API 4: 取得題庫檔案列表
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
        "數據判讀": "溶解度曲線、飽滿水氣壓圖表，或根據實驗步驟推論未知化合物成分。",
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
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    let { subject, level, rank, difficulty, knowledgeMap, specificTopic, topic } = req.body;
    
    let targetTopic = specificTopic || topic;

    if (!subject) {
        const allSubjects = Object.keys(SUBJECT_SCHEMA);
        subject = getRandomItem(allSubjects);
    }

    if (!targetTopic && SUBJECT_SCHEMA[subject]) {
        targetTopic = getRandomItem(SUBJECT_SCHEMA[subject]);
    }
    if (!targetTopic) targetTopic = "綜合測驗";

    let topicDescription = "";
    if (SUBJECT_DETAILS[subject] && SUBJECT_DETAILS[subject][targetTopic]) {
        topicDescription = SUBJECT_DETAILS[subject][targetTopic];
    }

    let diagnosticInfo = "";
    if (knowledgeMap && knowledgeMap[subject] && knowledgeMap[subject][targetTopic]) {
        const stats = knowledgeMap[subject][targetTopic];
        const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
        diagnosticInfo = `[玩家數據] 在「${subject}-${targetTopic}」上正確率為 ${accuracy}% (已練 ${stats.total} 題)。`;
        if (stats.total > 3 && accuracy < 40) difficulty = "easy"; 
        if (stats.total > 5 && accuracy > 80) difficulty = "hard"; 
    }

    const randomSeed = Math.random().toString(36).substring(7);

    const generationPrompt = `
        [系統指令]
        你是由 Google 開發的 AI 教育專家，請生成一道高品質的「單選題」。
        題目有需要換行時可以打\n。
        
        [出題規格]
        1. **主科目**：${subject}
        2. **指定題型**：${targetTopic}
        3. **題型要求**：${topicDescription}
        4. **適用程度**：${level} (段位：${rank})
        5. **難度設定**：${difficulty}
        6. **隨機因子**：${randomSeed}
        ${diagnosticInfo}
    
        [輸出格式 (JSON Only)]
        請直接回傳 JSON，不要 markdown 標記：
        {
            "q": "題目內容 (純文字描述)",
            "correct": "正確選項",
            "wrong": ["錯誤1", "錯誤2", "錯誤3"],
            "exp": "解析內容...",
            "subject": "${subject}",
            "sub_topic": "${targetTopic}" 
        }
        請檢查：答案 "correct" 只有一個、錯誤答案中沒有正確答案、選項必須在選項裡不可在題目裡、不可為多選題。
    `;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Gen] ${subject} > ${targetTopic} (${difficulty}) - 嘗試 ${attempts + 1}`); 
            const genResult = await model.generateContent(generationPrompt);
            const rawText = genResult.response.text();
            
            // 🚨 修正：過濾 Gemma 思考區塊與安全提取 JSON，防止正則崩潰
            let cleanedText = rawText.replace(/<\|?think\|?>[\s\S]*?<\/\|?think\|?>/gi, '');
            let startIdx = cleanedText.indexOf('{');
            let endIdx = cleanedText.lastIndexOf('}');
            
            if (startIdx === -1 || endIdx === -1) {
                throw new Error("AI 回應中未找到 JSON 結構");
            }
            
            const parsed = JSON.parse(cleanedText.substring(startIdx, endIdx + 1));
            
            if(!parsed.sub_topic) parsed.sub_topic = targetTopic;
            if(!parsed.subject) parsed.subject = subject;

            return res.json({ text: JSON.stringify(parsed) });

        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            if (attempts === maxAttempts) return res.status(500).json({ error: "生成失敗" });
        }
    }
});

// ==========================================
// API: 回報審查 
// ==========================================
app.post('/api/verify-report', async (req, res) => {
    const { question, options, correctIndex, explanation, userReason } = req.body;
    
    const correctAnswerText = options[correctIndex];

    const prompt = `
        你是一名極度嚴格的考題審查員。玩家回報了一道題目有錯誤。
        請仔細審查該題目是否存在：事實錯誤、邏輯漏洞、錯別字、選項歧義、答案錯誤、或排版嚴重混亂。
        只要有任何一點小錯誤，都算「回報有效 (valid: true)」。
        
        [題目資訊]
        題目: ${question}
        選項: ${JSON.stringify(options)}
        系統設定答案: ${correctAnswerText}
        系統解析: ${explanation}
        
        [玩家回報理由]
        ${userReason}
        
        請以 JSON 格式回傳審查結果：
        {
            "valid": boolean,  // true 代表題目真的有錯 (或玩家理由合理)，false 代表題目無誤
            "reason": "請用繁體中文簡短說明判斷理由 (50字內)"
        }
    `;

    try {
        const result = await model.generateContent(prompt);
        const rawText = result.response.text();
        
        // 🚨 修正：過濾 Gemma 思考區塊與安全提取 JSON
        let cleanedText = rawText.replace(/<\|?think\|?>[\s\S]*?<\/\|?think\|?>/gi, '');
        let startIdx = cleanedText.indexOf('{');
        let endIdx = cleanedText.lastIndexOf('}');
        let jsonText = cleanedText.substring(startIdx, endIdx + 1);
        
        const json = JSON.parse(jsonText);
        res.json(json);
    } catch (error) {
        console.error("Report Verification Error:", error);
        res.json({ valid: false, reason: "系統忙碌，無法完成審查。" });
    }
});

// ==========================================
// API 5: 取得中學單元列表 (遞迴讀取)
// ==========================================
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

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
