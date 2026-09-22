const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const aiRouter = require('./ai-router');
const registerDongtianApi = require('./dongtian-api');
const registerIdentityApi = require('./identity-api');
const registerArtifactGenerationApi = require('./artifact-generation-api');
const registerFirebaseProjectAuthApi = require('./firebase-project-auth-api.cjs');
const registerAutoMigrationApi = require('./firebase-auto-migration-api.cjs');
const registerPlayerProvisionApi = require('./firebase-player-provision-api.cjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
registerDongtianApi(app);
registerIdentityApi(app);
registerArtifactGenerationApi(app);
registerFirebaseProjectAuthApi(app);
const migrationController = registerAutoMigrationApi(app);
registerPlayerProvisionApi(app, { migrationController });

// 根目錄路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 僅回傳已配置 provider 的名稱與模型，不暴露 API key。
app.get('/api/ai-status', (req, res) => {
    const providers = aiRouter.getStatus();
    res.json({
        strategy: process.env.AI_PROVIDER_STRATEGY || 'round-robin',
        count: providers.length,
        providers,
        // Recent actual attempts (including fallbacks), not just configured providers.
        // In-memory per Render instance; no keys, prompts or user identifiers.
        recent: aiRouter.getRecentActivity()
    });
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

        const routed = await aiRouter.generateJSON(prompt);
        res.json({ subjects: routed.data.subjects, provider: routed.provider, model: routed.model });

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
// API 2: 生成測驗題目 (優化版：單次請求 + 安全 JSON 解析)
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    // 兼容前端可能傳來的 specificTopic 或 topic
    let { subject, level, rank, difficulty, knowledgeMap, specificTopic, topic, avoidQuestions } = req.body || {};
    subject = String(subject || '').trim().slice(0, 40);
    level = String(level || '國中一年級').slice(0, 32);
    difficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const previousQuestions = (Array.isArray(avoidQuestions) ? avoidQuestions : [])
        .filter(value => typeof value === 'string').slice(-10).map(value => value.trim().slice(0, 180)).filter(Boolean);
    const fingerprint = value => String(value).replace(/\s+/g, '').toLowerCase();
    let targetTopic = String(specificTopic || topic || '').trim().slice(0, 240);

    // 1. 科目選擇
    if (!subject) {
        const allSubjects = Object.keys(SUBJECT_SCHEMA);
        subject = getRandomItem(allSubjects);
    }

    // 2. 子題型選擇
    if (!targetTopic && SUBJECT_SCHEMA[subject]) {
        targetTopic = getRandomItem(SUBJECT_SCHEMA[subject]);
    }
    if (!targetTopic) targetTopic = "綜合測驗";

    // 3. 取得詳細指導語
    let topicDescription = "";
    if (SUBJECT_DETAILS[subject] && SUBJECT_DETAILS[subject][targetTopic]) {
        topicDescription = SUBJECT_DETAILS[subject][targetTopic];
    }

    // 4. 建構診斷資訊
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
        你是一名 AI 教育專家，請生成一道高品質的「單選題」。
        題目有需要換行時可以打\n。
        
        [出題規格]
        1. **主科目**：${subject}
        2. **指定題型**：${targetTopic}
        3. **題型要求**：${topicDescription}
        4. **適用程度**：${level} (段位：${rank})
        5. **難度設定**：${difficulty}
        6. **隨機因子**：${randomSeed}
        7. **嚴格範圍**：只能考查「${level}」程度內的「${subject}／${targetTopic}」，不得跨科、超綱或擅自替換單元。
        8. **避免重複題目**：${previousQuestions.length ? JSON.stringify(previousQuestions) : '本場尚無既有題目'}。不得改寫同一道題目再出。
        9. 必須提供四個不重複且僅有一個正解的選項，以及能夠支持該答案的完整解析。
        10. **LaTeX 排版**：題幹、正確選項、三個錯誤選項及解析中的所有數學式都必須使用 TeX 語法。行內數學用 $...$，獨立公式用 $...$；例如 $x^2+1$、$\\frac{1}{2}$。一般中文保留純文字，不要將整段中文包進公式；不要輸出 HTML 或 Markdown 程式碼區塊。
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

    // 6. 呼叫 AI (取消雙重呼叫，改為直接解析)
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Gen] ${subject} > ${targetTopic} (${difficulty}) - 嘗試 ${attempts + 1}`); 
            const routed = await aiRouter.generateJSON(generationPrompt);
            const parsed = routed.data;
            const wrong = Array.isArray(parsed?.wrong) ? parsed.wrong : [];
            const options = [parsed?.correct, ...wrong];
            if (typeof parsed?.q !== 'string' || parsed.q.trim().length < 5 ||
                typeof parsed.correct !== 'string' || wrong.length !== 3 ||
                options.some(item => typeof item !== 'string' || !item.trim()) ||
                new Set(options.map(fingerprint)).size !== 4 ||
                typeof parsed.exp !== 'string' || parsed.exp.trim().length < 5 ||
                (parsed.subject && String(parsed.subject).trim() !== subject) ||
                previousQuestions.some(old => fingerprint(old) === fingerprint(parsed.q))) {
                throw new Error('AI 題目未通過範圍、格式或去重檢查');
            }
            parsed.subject = subject;
            parsed.sub_topic = targetTopic;

            return res.json({ text: JSON.stringify(parsed), provider: routed.provider, model: routed.model });

        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            if (attempts === maxAttempts) return res.status(500).json({ error: "生成失敗" });
        }
    }
});

app.post('/api/verify-report', async (req, res) => {
    const { question, options, correctIndex, explanation, userReason } = req.body;
    
    // 取得正確答案的文字內容
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
        const routed = await aiRouter.generateJSON(prompt);
        res.json({ ...routed.data, provider: routed.provider, model: routed.model });
    } catch (error) {
        console.error("Report Verification Error:", error);
        // 若 AI 發生錯誤，保守起見設為無效，並請玩家稍後再試
        res.json({ valid: false, reason: "系統忙碌，無法完成審查。" });
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
