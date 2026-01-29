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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite", // 若遇 429 錯誤可改回 gemini-2.0-flash-exp
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
// server.js

// ==========================================
// 1. 定義學科與子題型架構 (含詳細指導語)
// ==========================================
// 這是您提供的完整題型架構，AI 將依據此描述出題
const SUBJECT_DETAILS = {
    "國文": {
        "字形字音字義": "測驗對日常常用字、古今異義字、一字多義的理解。",
        "詞語與成語": "考查詞語的褒貶意涵、語境運用、古今差異。",
        "修辭與句法": "判斷文句中使用的修辭（如譬喻、排比）與句子結構（如判斷句、敘事句）。",
        "國學與文化常識": "文學史、題辭、書法、對聯、應用文（書信、公文）等知識。",
        "白話文閱讀": "理解文章主旨、擷取訊息、語意分析。",
        "文言文閱讀": "文意詮釋、古文句式翻譯、作者觀點分析。",
        "跨文本比較": "將文言文與白話文內容連結、主題相近的文章對比分析。",
        "圖表與情境閱讀": "素養題，要求讀懂圖表、漫畫或特定情境再選出答案。"
    },
    "英文": {
        "詞彙與字彙": "測驗單字詞性、時態及搭配用法。",
        "綜合測驗(Cloze)": "克漏字，測驗文意發展、語法與單字理解。",
        "文意選填(Matching)": "給定短文與數個空格及選項，測驗判斷單字詞性與上下文脈絡。",
        "篇章結構": "將句子或段落填回文章，依據連接詞、轉折詞推敲邏輯。",
        "閱讀測驗": "根據短文理解內容、找出主題句、推理或主旨。"
    },
    "數學": {
        "基礎計算": "快速反應運算能力。",
        "應用素養": "結合實際情境（如披薩分割、銀行利率），考驗將文字轉化為數學模型。",
        "幾何題": "利用圖形性質（如三角形、圓、平行四邊形）進行推理，如「漏斗型」對頂角或圓的性質。",
        "代數與函數": "不等式、數列、三角函數、矩陣等運算。",
        "證明題": "嚴謹推導公式或定理。",
        "統計與機率": "數據圖表分析。"
    },
    "公民": {
        "法律應用": "給予一段社會新聞或契約糾紛，要求考生判斷適用何種法律（如行政法、勞基法）或程序原則。",
        "經濟圖表": "分析市場供給、需求曲線，或計算機會成本、GDP 組成、匯率變動對貿易的影響。",
        "政治體制": "比較不同國家的政府體制（如內閣制與總統制）、選舉制度（如單一選區與比例代表制）。",
        "時事解析": "融入 MeToo、性別平等、國際衝突（如俄烏戰爭）等議題，測驗學生對公民素養的反思。"
    },
    "歷史": {
        "史料解析": "提供一段日記、古籍或報章雜誌，要求考生辨識作者立場，並從文字中推論出當時的社會背景。",
        "時空定位": "將歷史事件與地理空間結合，例如分析特定時期的全球貿易網絡或戰爭路線。",
        "因果推導": "探討某個政策或文化交流如何影響後續的發展（如日治時期行政制度對現代訴訟的影響）。",
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

// 產生簡單的 Key-Value 對照表供程式邏輯使用
const SUBJECT_SCHEMA = {};
for (const [subj, details] of Object.entries(SUBJECT_DETAILS)) {
    SUBJECT_SCHEMA[subj] = Object.keys(details);
}

// 輔助函式
function getRandomItem(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// API 2: 生成測驗題目 (整合詳細描述 Prompt)
// ==========================================
app.post('/api/generate-quiz', async (req, res) => {
    let { subject, level, rank, difficulty, knowledgeMap, specificTopic } = req.body;
    
    // 1. 科目選擇 (若未指定則隨機)
    if (!subject) {
        const allSubjects = Object.keys(SUBJECT_SCHEMA);
        subject = getRandomItem(allSubjects);
    }

    // 2. 子題型選擇
    let targetTopic = specificTopic;
    if (!targetTopic && SUBJECT_SCHEMA[subject]) {
        targetTopic = getRandomItem(SUBJECT_SCHEMA[subject]);
    }
    if (!targetTopic) targetTopic = "綜合測驗";

    // 3. 取得該題型的「詳細指導語」
    // 這會讓 AI 知道「史料解析」具體是要考什麼，而不只是看標題
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

    // 5. Prompt 生成 (注入 topicDescription)
    const generationPrompt = `
        [系統指令]
        你是由 Google 開發的 AI 教育專家，請生成一道高品質的「單選題」。
        
        [出題規格]
        1. **主科目**：${subject}
        2. **指定題型**：${targetTopic}
        3. **題型要求**：${topicDescription} (請嚴格遵守此描述設計題目)
        4. **適用程度**：${level} (段位：${rank})
        5. **難度設定**：${difficulty}
        6. **隨機因子**：${randomSeed}
        ${diagnosticInfo}

        [輸出格式 (JSON Only)]
        請直接回傳 JSON，不要 markdown 標記：
        {
            "q": "題目內容 (若為閱讀題請包含短文)",
            "correct": "正確選項",
            "wrong": ["錯誤1", "錯誤2", "錯誤3"],
            "exp": "解析：針對 ${targetTopic} 的概念解說...",
            "subject": "${subject}",
            "sub_topic": "${targetTopic}" 
        }
    `;

    // 6. 呼叫 AI (保持原本的雙重審查邏輯)
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            console.log(`[Gen] ${subject} > ${targetTopic} (${difficulty})`); 
            const genResult = await model.generateContent(generationPrompt);
            let rawText = genResult.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            // 審查 Prompt (簡化版)
            const validationPrompt = `
                請檢查以下 JSON 格式是否正確，且確認：答案 "correct" 只有一個、正確答案是否正確、錯誤答案中是否有正確答案、選項要在選項裡、不可為多選題、選項不可只有英文字母，要有文本。
                並回傳修正後的純 JSON：
                ${rawText}
            `;
            const valResult = await model.generateContent(validationPrompt);
            let finalText = valResult.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            
            const parsed = JSON.parse(finalText);
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

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
