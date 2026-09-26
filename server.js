const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const aiRouter = require('./ai-router');
const registerDongtianApi = require('./dongtian-api');
const registerIdentityApi = require('./identity-api');
const registerQuestionReportApi = require('./question-report-api.cjs');
const registerArtifactGenerationApi = require('./artifact-generation-api');
const registerFirebaseProjectAuthApi = require('./firebase-project-auth-api.cjs');
const registerAutoMigrationApi = require('./firebase-auto-migration-api.cjs');
const registerPlayerProvisionApi = require('./firebase-player-provision-api.cjs');
const registerAdminAccountApi = require('./admin-account-api.cjs');
const registerAdminArtifactDeleteApi = require('./admin-artifact-delete-api.cjs');
const { registerItemImageApi } = require('./item-image-api.cjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
registerDongtianApi(app);
registerIdentityApi(app);
registerQuestionReportApi(app);
registerArtifactGenerationApi(app);
registerFirebaseProjectAuthApi(app);
const migrationController = registerAutoMigrationApi(app);
registerPlayerProvisionApi(app, { migrationController });
registerAdminAccountApi(app);
registerAdminArtifactDeleteApi(app);
registerItemImageApi(app);

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
// API: 題目旁的問道助手
// ==========================================
app.post('/api/question-helper', async (req, res) => {
    try {
        const question = String(req.body?.question || '').trim().slice(0, 3000);
        const userMessage = String(req.body?.message || '').trim().slice(0, 600);
        const answered = req.body?.answered === true;
        const explanation = answered ? String(req.body?.explanation || '').trim().slice(0, 3000) : '';
        const selectedOption = answered ? String(req.body?.selectedOption || '').trim().slice(0, 800) : '';
        const correctOption = answered ? String(req.body?.correctOption || '').trim().slice(0, 800) : '';
        const options = (Array.isArray(req.body?.options) ? req.body.options : [])
            .slice(0, 6)
            .map(item => String(item || '').trim().slice(0, 800))
            .filter(Boolean);
        const history = (Array.isArray(req.body?.history) ? req.body.history : [])
            .slice(-6)
            .map(item => ({
                role: item?.role === 'assistant' ? 'assistant' : 'user',
                text: String(item?.text || '').trim().slice(0, 800)
            }))
            .filter(item => item.text);

        if (!question || !userMessage) {
            return res.status(400).json({ error: '缺少題目或提問內容' });
        }

        const conversation = history.length
            ? history.map(item => `${item.role === 'assistant' ? '助教' : '玩家'}：${item.text}`).join('\n')
            : '尚無前文';

        const prompt = `
你是修仙學習遊戲中的「問道助手」，使用繁體中文回答玩家針對目前題目的疑問。
你的任務是幫助玩家理解與推理，而不是取代玩家作答。

[目前題目]
${question}

[選項]
${options.length ? options.map((item, index) => `${String.fromCharCode(65 + index)}. ${item}`).join('\n') : '未提供'}

[目前狀態]
玩家${answered ? '已經作答，可以完整解析並指出正確觀念。' : '尚未作答。不可直接透露正確選項字母、完整最終答案或直接替玩家完成計算；請用提示、關鍵觀念、拆步驟、反問或指出下一步的方式協助。'}
${answered ? `
[作答結果]
玩家選擇：${selectedOption || '未記錄'}
正確選項：${correctOption || '未記錄'}
原題解析：${explanation || '未提供'}
` : ''}

[最近對話]
${conversation}

[玩家最新提問]
${userMessage}

回答規則：
1. 只處理這一道題相關的問題。
2. 優先回答玩家真正卡住的地方，不要長篇重述題目。
3. 尚未作答時，可以示範方法與中間步驟，但在最關鍵一步前停下，讓玩家自己完成。
4. 已作答時，可完整說明解法、錯因與觀念。
5. 數學式可使用 $...$ TeX 語法。
6. 回答控制在約 220 個中文字內，除非玩家明確要求詳細說明。
7. 從這次回答中整理出一個最適合延伸練習的核心知識點，knowledgePoint 要簡短、具體，可直接作為下一題出題範圍，例如「一元一次方程式移項」、「現在完成式」、「清代臺灣行政區劃」。
8. 請只回傳合法 JSON：
{"answer":"你的回答","knowledgePoint":"核心知識點"}
`;

        const routed = await aiRouter.generateJSON(prompt, { timeoutMs: 25000 });
        const answer = String(routed.data?.answer || '').trim();
        if (!answer) throw new Error('AI 未回傳有效回答');
        const fallbackPoint = userMessage.replace(/[？?！!。,.，]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
        const knowledgePoint = String(routed.data?.knowledgePoint || fallbackPoint || '本題核心觀念')
            .replace(/[\r\n]+/g, ' ')
            .trim()
            .slice(0, 60);

        res.json({ answer, knowledgePoint, provider: routed.provider, model: routed.model });
    } catch (error) {
        console.error('[Question Helper]', error);
        res.status(502).json({ error: '問道助手暫時無法回應，請稍後再試。' });
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


const QUESTION_FORMS = Object.freeze([
    'direct-application', 'inverse-reasoning', 'error-analysis', 'scenario-modeling',
    'data-interpretation', 'comparison', 'multi-step', 'concept-transfer'
]);

function cleanQuestionText(value) {
    return String(value || '').trim().slice(0, 500);
}

function normalizedQuestionFingerprint(value, ignoreNumbers = false) {
    let text = cleanQuestionText(value).toLowerCase()
        .replace(/\\[a-z]+/g, ' ')
        .replace(/[{}$^_=+×÷*\/\\]/g, ' ')
        .replace(/[，。！？；：、,.!?;:「」『』（）()\[\]<>]/g, '')
        .replace(/\s+/g, '');
    if (ignoreNumbers) {
        text = text
            .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
            .replace(/[一二三四五六七八九十百千萬億兩〇零]+/g, '#');
    }
    return text;
}

function questionShingles(value) {
    const text = normalizedQuestionFingerprint(value, true);
    const set = new Set();
    if (text.length < 3) {
        if (text) set.add(text);
        return set;
    }
    for (let i = 0; i <= text.length - 3; i++) set.add(text.slice(i, i + 3));
    return set;
}

function diceSimilarity(a, b) {
    const A = questionShingles(a);
    const B = questionShingles(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const item of A) if (B.has(item)) hit++;
    return (2 * hit) / (A.size + B.size);
}

function normalizeQuestionMeta(input = {}) {
    if (!input || typeof input !== 'object') return null;
    return {
        q: cleanQuestionText(input.q || input.question),
        concept_id: String(input.concept_id || '').trim().slice(0, 100),
        template_id: String(input.template_id || '').trim().slice(0, 120),
        question_form: String(input.question_form || '').trim().slice(0, 60),
        cognitive_level: Math.max(1, Math.min(5, Number(input.cognitive_level) || 1)),
        reasoning_steps: Math.max(1, Math.min(6, Number(input.reasoning_steps) || 1))
    };
}

function isTooSimilarQuestion(candidate, history) {
    const exact = normalizedQuestionFingerprint(candidate);
    const structural = normalizedQuestionFingerprint(candidate, true);
    return history.some(old => {
        if (!old) return false;
        if (exact === normalizedQuestionFingerprint(old)) return true;
        if (structural && structural === normalizedQuestionFingerprint(old, true)) return true;
        return diceSimilarity(candidate, old) >= 0.84;
    });
}

function qualityPolicy(subject, difficulty) {
    const languageSocial = ['國文', '英文', '歷史', '地理', '公民'].includes(subject);
    if (difficulty === 'hard') {
        return {
            cognitive: '4-5',
            steps: '3-5',
            instruction: languageSocial
                ? '至少包含推論、比較、資料或語境判讀之一，不得只問單一名詞、翻譯或年代記憶。'
                : '至少需要 3 個有意義的解題步驟，優先結合兩個子技能、逆向推理、資料判讀或陌生情境。'
        };
    }
    if (difficulty === 'medium') {
        return {
            cognitive: '3-4',
            steps: '2-3',
            instruction: languageSocial
                ? '不能只靠看到關鍵字直接作答；至少需要理解上下文、因果、比較或資訊整合。'
                : '至少包含一次轉換、建模、判斷方法或兩步計算；避免單純代公式。'
        };
    }
    return {
        cognitive: '2-3',
        steps: '1-2',
        instruction: '基礎題仍要檢查真正理解；可以直接，但避免反覆只考定義、背誦或完全相同公式代入。'
    };
}

function chooseQuestionForm(previousMeta, seed) {
    const recent = new Set(previousMeta.slice(-5).map(item => item.question_form).filter(Boolean));
    const candidates = QUESTION_FORMS.filter(form => !recent.has(form));
    const pool = candidates.length ? candidates : QUESTION_FORMS;
    const n = [...String(seed || '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return pool[n % pool.length];
}

// ==========================================
// API 2: 生成測驗題目 (優化版：單次請求 + 安全 JSON 解析)
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    // 兼容前端可能傳來的 specificTopic 或 topic
    let { subject, level, rank, difficulty, knowledgeMap, specificTopic, topic, avoidQuestions, avoidQuestionMeta } = req.body || {};
    subject = String(subject || '').trim().slice(0, 40);
    level = String(level || '國中一年級').slice(0, 32);
    difficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const previousQuestions = (Array.isArray(avoidQuestions) ? avoidQuestions : [])
        .map(cleanQuestionText).filter(Boolean).slice(-80);
    const previousMeta = (Array.isArray(avoidQuestionMeta) ? avoidQuestionMeta : [])
        .map(normalizeQuestionMeta).filter(Boolean).slice(-80);
    for (const item of previousMeta) {
        if (item.q && !previousQuestions.includes(item.q)) previousQuestions.push(item.q);
    }
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
        // 低正確率代表需要更清楚的鷹架，不代表永遠只做 easy。
        // hard 最多降一級到 medium；medium 保持兩步以上的理解／推理要求。
        if (stats.total > 3 && Number(accuracy) < 40 && difficulty === "hard") difficulty = "medium";
        if (stats.total > 5 && Number(accuracy) > 80) difficulty = "hard";
    }

    const randomSeed = Math.random().toString(36).substring(7);
    const quality = qualityPolicy(subject, difficulty);
    const targetForm = chooseQuestionForm(previousMeta, randomSeed);
    const recentTemplates = [...new Set(previousMeta.slice(-18).map(item => item.template_id).filter(Boolean))];
    const recentConceptForms = previousMeta.slice(-6)
        .filter(item => item.concept_id || item.question_form)
        .map(item => ({ concept_id: item.concept_id, question_form: item.question_form }));

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
        8. **避免重複題目**：近期已有 ${previousQuestions.length} 題。不得只換數字、人名、物品、地點或敘述後重出相同解法骨架。
        9. **本題指定表現形式**：${targetForm}。除非該科確實不適用，請依這種形式設計。
        10. **深度要求**：認知層級約 ${quality.cognitive}，合理推理步數約 ${quality.steps}。 ${quality.instruction}
        11. **近期禁止骨架**：${recentTemplates.length ? JSON.stringify(recentTemplates) : '無'}。template_id 必須描述解題骨架，不可只寫題目名稱。
        12. **近期概念/題型組合**：${recentConceptForms.length ? JSON.stringify(recentConceptForms) : '無'}。若可行，避免立刻重複同一 concept_id + question_form。
        13. 錯誤選項應對應常見迷思、計算錯誤或推理錯誤，不能只是隨機湊數。
        14. 必須提供四個不重複且僅有一個正解的選項，以及完整解析；解析須點出關鍵觀念與主要步驟。
        15. **LaTeX 排版**：題幹、正確選項、三個錯誤選項及解析中的所有數學式都必須使用 TeX 語法。行內數學用 $...$，獨立公式用 $...$；例如 $x^2+1$、$\\frac{1}{2}$。一般中文保留純文字，不要將整段中文包進公式；不要輸出 HTML 或 Markdown 程式碼區塊。
        ${diagnosticInfo}
    
        [輸出格式 (JSON Only)]
        請直接回傳 JSON，不要 markdown 標記：
        {
            "q": "題目內容 (純文字描述)",
            "correct": "正確選項",
            "wrong": ["錯誤1", "錯誤2", "錯誤3"],
            "exp": "解析內容...",
            "subject": "${subject}",
            "sub_topic": "${targetTopic}",
            "concept_id": "穩定且短小的考點ID",
            "template_id": "描述解題骨架的ID",
            "question_form": "${targetForm}",
            "cognitive_level": 1,
            "reasoning_steps": 1
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
                isTooSimilarQuestion(parsed.q, previousQuestions)) {
                throw new Error('AI 題目未通過範圍、格式或結構去重檢查');
            }

            parsed.subject = subject;
            parsed.sub_topic = targetTopic;
            parsed.question_form = QUESTION_FORMS.includes(String(parsed.question_form || ''))
                ? String(parsed.question_form) : targetForm;
            parsed.concept_id = String(parsed.concept_id || (subject + ':' + targetTopic)).trim().slice(0, 100);
            parsed.template_id = String(parsed.template_id || (parsed.concept_id + ':' + parsed.question_form))
                .trim().slice(0, 120);
            parsed.cognitive_level = Math.max(1, Math.min(5, Number(parsed.cognitive_level) || (difficulty === 'hard' ? 4 : difficulty === 'medium' ? 3 : 2)));
            parsed.reasoning_steps = Math.max(1, Math.min(6, Number(parsed.reasoning_steps) || (difficulty === 'hard' ? 3 : difficulty === 'medium' ? 2 : 1)));

            if (recentTemplates.includes(parsed.template_id)) {
                throw new Error('AI 題目與近期解題骨架重複');
            }

            return res.json({ text: JSON.stringify(parsed), provider: routed.provider, model: routed.model });

        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, error.message);
            attempts++;
            if (attempts === maxAttempts) return res.status(500).json({ error: "生成失敗" });
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
