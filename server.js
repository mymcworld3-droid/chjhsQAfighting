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

// ==========================================
// AI 模型設定
// ==========================================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 第一階段：主要出題模型
// 注意：這裡的模型名稱請依你的 API 帳號實際可用名稱設定
const gemmaModel = genAI.getGenerativeModel({
    model: process.env.GEMMA_MODEL || "gemma-4-31b-it",
    generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.8
    }
});

// 第二階段：品質審核模型
const reviewModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_REVIEW_MODEL || "gemini-3.5-flash-lite",
    generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
    }
});

// 保留原本 model，給其他 API 使用
const model = reviewModel;

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
// 題目自動品質檢查
// 不呼叫 AI，先用程式快速過濾明顯錯誤
// ==========================================

function validateQuizQuestion(question, expectedSubject, expectedTopic) {
    const issues = [];

    // ==========================================
    // 1. 基本結構
    // ==========================================

    if (!question || typeof question !== "object" || Array.isArray(question)) {
        return {
            passed: false,
            suspicious: true,
            issues: ["題目資料不是有效物件"]
        };
    }

    if (
        typeof question.q !== "string" ||
        question.q.trim().length < 8
    ) {
        issues.push("題目內容太短或不存在");
    }

    if (
        typeof question.correct !== "string" ||
        question.correct.trim().length === 0
    ) {
        issues.push("缺少正確答案");
    }

    if (!Array.isArray(question.wrong)) {
        issues.push("wrong 必須是陣列");
    } else if (question.wrong.length !== 3) {
        issues.push("錯誤選項必須剛好 3 個");
    }

    if (
        typeof question.exp !== "string" ||
        question.exp.trim().length < 10
    ) {
        issues.push("解析不存在或過短");
    }

    // ==========================================
    // 2. 學科 / 題型一致性
    // ==========================================

    if (question.subject !== expectedSubject) {
        issues.push(
            `subject 不一致：${question.subject}，預期：${expectedSubject}`
        );
    }

    if (question.sub_topic !== expectedTopic) {
        issues.push(
            `sub_topic 不一致：${question.sub_topic}，預期：${expectedTopic}`
        );
    }

    // ==========================================
    // 3. 選項檢查
    // ==========================================

    if (
        typeof question.correct === "string" &&
        Array.isArray(question.wrong)
    ) {
        const allOptions = [
            question.correct.trim(),
            ...question.wrong.map(option =>
                typeof option === "string"
                    ? option.trim()
                    : ""
            )
        ];

        // ------------------------------------------
        // 3-1. 必須剛好四個選項
        // ------------------------------------------

        if (allOptions.length !== 4) {
            issues.push("題目必須剛好有四個選項");
        }

        // ------------------------------------------
        // 3-2. 不可有空白選項
        // ------------------------------------------

        if (allOptions.some(option => !option)) {
            issues.push("存在空白選項");
        }

        // ------------------------------------------
        // 3-3. 選項不能重複
        // ------------------------------------------

        const normalizeOption = value => {
            return String(value)
                .replace(/\s+/g, "")
                .replace(/[，。！？、,.!?；;：:（）()「」『』【】[\]{}]/g, "")
                .toLowerCase()
                .trim();
        };

        const normalizedOptions =
            allOptions.map(normalizeOption);

        const uniqueOptions =
            new Set(normalizedOptions);

        if (
            normalizedOptions.length === 4 &&
            uniqueOptions.size !== 4
        ) {
            issues.push("選項存在重複");
        }

        // ------------------------------------------
        // 3-4. 正確答案不可出現在 wrong
        // ------------------------------------------

        const correctNormalized =
            normalizedOptions[0];

        for (let i = 1; i < normalizedOptions.length; i++) {
            if (
                correctNormalized &&
                normalizedOptions[i] &&
                normalizedOptions[i] === correctNormalized
            ) {
                issues.push(
                    "正確答案與錯誤答案重複"
                );
                break;
            }
        }

        // ------------------------------------------
        // 3-5. 選項不應該直接複製整段題目
        // ------------------------------------------

        const questionNormalized =
            normalizeOption(question.q);

        for (const option of normalizedOptions) {
            if (
                option.length >= 8 &&
                questionNormalized.includes(option)
            ) {
                issues.push(
                    "選項可能直接出現在題幹中"
                );
                break;
            }
        }
    }

    // ==========================================
    // 4. 題目是否疑似多選題
    // ==========================================

    const multiChoicePatterns = [
        /複選/,
        /多選/,
        /選出所有/,
        /以下.*何者.*皆/,
        /下列.*何者.*皆/,
        /有幾項/,
        /正確的是.*項/,
        /正確的有.*項/
    ];

    if (
        typeof question.q === "string" &&
        multiChoicePatterns.some(
            pattern => pattern.test(question.q)
        )
    ) {
        issues.push("題目可能不是單選題");
    }

    // ==========================================
    // 5. 禁止「以上皆是 / 以上皆非」
    // ==========================================

    const forbiddenAnswerPatterns = [
        /以上皆是/,
        /以上皆非/,
        /以上皆對/,
        /以上皆錯/,
        /以上選項皆/
    ];

    const allAnswerTexts = [
        question.correct,
        ...(Array.isArray(question.wrong)
            ? question.wrong
            : [])
    ];

    for (const answer of allAnswerTexts) {
        if (
            typeof answer === "string" &&
            forbiddenAnswerPatterns.some(
                pattern => pattern.test(answer)
            )
        ) {
            issues.push(
                "選項包含禁止使用的「以上皆是／以上皆非」類型"
            );
            break;
        }
    }

    // ==========================================
    // 6. 題目格式問題
    // ==========================================

    if (
        typeof question.q === "string" &&
        /```/.test(question.q)
    ) {
        issues.push(
            "題目包含 Markdown code fence"
        );
    }

    if (
        typeof question.q === "string" &&
        /^\s*[{[]/.test(question.q)
    ) {
        issues.push(
            "題目可能殘留 JSON / 程式格式"
        );
    }

    // ==========================================
    // 7. 解析基本一致性
    // ==========================================

    if (
        typeof question.exp === "string" &&
        typeof question.correct === "string"
    ) {
        const explanation =
            question.exp.trim().toLowerCase();

        const answer =
            question.correct.trim().toLowerCase();

        /*
         * 不要求解析一定要逐字出現答案。
         *
         * 原本的：
         *
         * !explanation.includes(answer)
         *
         * 很容易誤判。
         *
         * 例如：
         *
         * correct = "B"
         * exp = "因為需求增加會使均衡價格上升，因此選擇 B。"
         *
         * 這種可以。
         *
         * 但如果答案是很長的一整句，
         * 解析不一定需要完整複製。
         */

        if (
            answer.length >= 2 &&
            answer.length <= 20 &&
            !explanation.includes(answer)
        ) {
            issues.push(
                "解析可能沒有明確對應正確答案"
            );
        }
    }

    // ==========================================
    // 8. 解析不可太像空白模板
    // ==========================================

    if (typeof question.exp === "string") {
        const genericExplanations = [
            "因為這是正確答案",
            "因此答案是此選項",
            "由題目可知",
            "依題意可知"
        ];

        const explanation =
            question.exp
                .replace(/\s+/g, "")
                .trim();

        if (
            genericExplanations.some(
                text =>
                    explanation ===
                    text.replace(/\s+/g, "")
            )
        ) {
            issues.push(
                "解析過於簡略，沒有實際說明判斷依據"
            );
        }
    }

    // ==========================================
    // 9. 最終結果
    // ==========================================

    return {
        passed: issues.length === 0,
        suspicious: issues.length > 0,
        issues
    };
}

// ==========================================
// Gemini 第二階段題目審核
// 只有程式檢查出可疑題目才會呼叫
// ==========================================

async function reviewQuizQuestion(
    question,
    expectedSubject,
    expectedTopic,
    basicIssues = []
) {
    const reviewPrompt = `
你是一名極度嚴格的臺灣國高中考題品質審核 AI。

你的任務是審核一題已經由其他 AI 產生、且被程式初步判定為可疑的四選一單選題。

你不是單純判斷格式，而是必須檢查：

1. 題目是否真的可以作答。
2. 是否只有一個合理答案。
3. 三個 wrong 是否真的錯誤。
4. 題目與答案是否存在歧義。
5. 是否有事實錯誤。
6. 是否有數學計算錯誤。
7. 是否有歷史、公民、地理、科學概念錯誤。
8. 是否符合指定學科。
9. 是否符合指定子題型。
10. 解析是否支持答案。
11. 是否是四選一單選題。
12. 是否存在「以上皆是」、「以上皆非」。
13. 是否存在明顯排版或 JSON 問題。

【指定學科】
${expectedSubject}

【指定題型】
${expectedTopic}

【程式初步檢查問題】
${JSON.stringify(basicIssues, null, 2)}

【原始題目】
${JSON.stringify(question, null, 2)}

━━━━━━━━━━━━━━━━━━
【審核規則】
━━━━━━━━━━━━━━━━━━

如果原題可以可靠修正：

- 修正原題。
- 不要無理由改變題目主題。
- 保留原題核心概念。
- 確保最後只有一個正確答案。
- 重新確認所有 wrong。
- 重新確認解析。

如果原題完全無法可靠修正：

- 可以重新設計一道相同 subject / sub_topic 的題目。

如果原題本身其實沒有真正錯誤：

- 可以保留原題。
- fixedQuestion 必須仍然回傳完整題目。

━━━━━━━━━━━━━━━━━━
【非常重要】
━━━━━━━━━━━━━━━━━━

你必須自行重新判斷：

A. 題目是否只有一個最佳答案？
B. wrong 是否真的錯？
C. 題目資訊是否足夠？
D. 是否符合指定題型？
E. 是否存在語意歧義？
F. 是否存在事實錯誤？
G. 解析是否正確？
H. 是否為四選一單選題？

不要因為程式檢查有問題，就盲目認定題目錯誤。

━━━━━━━━━━━━━━━━━━
【輸出格式】
━━━━━━━━━━━━━━━━━━

只能輸出 JSON。

不要輸出 Markdown。
不要輸出 ```json。
不要輸出任何額外文字。

格式：

{
    "approved": true,
    "confidence": 0.95,
    "reason": "簡短說明審核結果",
    "fixedQuestion": {
        "q": "題目",
        "correct": "正確答案",
        "wrong": [
            "錯誤答案1",
            "錯誤答案2",
            "錯誤答案3"
        ],
        "exp": "繁體中文解析",
        "subject": "${expectedSubject}",
        "sub_topic": "${expectedTopic}"
    }
}

【approved 定義】

true：
代表這題經過你的審核後，可以安全給玩家使用。

false：
代表這題即使修正後仍然無法可靠使用。

【confidence】

必須是 0 到 1 之間的數字。

0.95 = 非常確定
0.85 = 高度確定
0.75 = 可以接受
低於 0.75 = 不夠確定

即使原題完全沒問題，也必須回傳 fixedQuestion。

`;
    
    try {
        const result =
            await reviewModel.generateContent(
                reviewPrompt
            );

        let rawText =
            result.response
                .text()
                .trim();

        console.log(
            "[Review] Gemini Raw Response:",
            rawText.substring(0, 4000)
        );

        // ==========================================
        // 清理 Markdown
        // ==========================================

        rawText =
            rawText
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .replace(/^\uFEFF/, "")
                .trim();

        // ==========================================
        // 擷取 JSON
        // ==========================================

        const firstBrace =
            rawText.indexOf("{");

        const lastBrace =
            rawText.lastIndexOf("}");

        if (
            firstBrace === -1 ||
            lastBrace === -1 ||
            lastBrace <= firstBrace
        ) {
            throw new Error(
                "Gemini 審核結果找不到有效 JSON"
            );
        }

        rawText =
            rawText.substring(
                firstBrace,
                lastBrace + 1
            );

        let review;

        try {
            review = JSON.parse(rawText);
        } catch (parseError) {

            console.error(
                "[Review] JSON.parse 第一次失敗:",
                parseError.message
            );

            // 移除控制字元
            rawText =
                rawText.replace(
                    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
                    ""
                );

            review = JSON.parse(rawText);
        }

        // ==========================================
        // 基本格式驗證
        // ==========================================

        if (
            !review ||
            typeof review !== "object" ||
            Array.isArray(review)
        ) {
            throw new Error(
                "Gemini 審核結果不是有效物件"
            );
        }

        // ==========================================
        // approved
        // ==========================================

        const approved =
            review.approved === true;

        // ==========================================
        // confidence
        // ==========================================

        let confidence =
            Number(review.confidence);

        if (!Number.isFinite(confidence)) {
            confidence = 0;
        }

        confidence =
            Math.max(
                0,
                Math.min(1, confidence)
            );

        // ==========================================
        // fixedQuestion
        // ==========================================

        let fixedQuestion =
            review.fixedQuestion;

        if (
            !fixedQuestion ||
            typeof fixedQuestion !== "object" ||
            Array.isArray(fixedQuestion)
        ) {
            /*
             * 如果 Gemini 沒有回傳 fixedQuestion，
             * 但它認為原題可以使用，
             * 就使用原題作為 fallback。
             */

            if (approved) {
                fixedQuestion = {
                    ...question
                };
            } else {
                fixedQuestion = null;
            }
        }

        // ==========================================
        // 強制分類
        // ==========================================

        if (fixedQuestion) {
            fixedQuestion.subject =
                expectedSubject;

            fixedQuestion.sub_topic =
                expectedTopic;
        }

        // ==========================================
        // Gemini 回傳統一格式
        // ==========================================

        return {
            approved,
            confidence,
            reason:
                typeof review.reason === "string"
                    ? review.reason
                    : "",
            fixedQuestion
        };

    } catch (error) {

        console.error(
            "[Review] Gemini 審核失敗:",
            error.message
        );

        return {
            approved: false,
            confidence: 0,
            reason: "Gemini 審核失敗",
            fixedQuestion: null
        };
    }
}

// ==========================================
// API 2: 生成測驗題目
//
// 新版流程：
//
// Gemma 4 31B
//      ↓
// 程式自動品質檢查
//      ↓
// ┌────┴────┐
// ↓         ↓
// 通過      可疑
// ↓         ↓
// 返回    Gemini 審核
//            ↓
//       ┌────┴────┐
//       ↓         ↓
//     通過       不通過
//       ↓         ↓
//      返回    Gemma 重新生成
//
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
    // 1. 決定科目
    // ==========================================

    if (!subject || !SUBJECT_SCHEMA[subject]) {
        const allSubjects = Object.keys(SUBJECT_SCHEMA);
        subject = getRandomItem(allSubjects);
    }

    // ==========================================
    // 2. 決定子題型
    // ==========================================

    if (
        !targetTopic ||
        !SUBJECT_SCHEMA[subject] ||
        !SUBJECT_SCHEMA[subject].includes(targetTopic)
    ) {
        targetTopic = getRandomItem(
            SUBJECT_SCHEMA[subject]
        );
    }

    if (!targetTopic) {
        targetTopic = "綜合測驗";
    }

    // ==========================================
    // 3. 取得題型說明
    // ==========================================

    const topicDescription =
        SUBJECT_DETAILS[subject]?.[targetTopic] || "";

    // ==========================================
    // 4. 玩家能力診斷
    // ==========================================

    let diagnosticInfo = "";

    if (
        knowledgeMap &&
        knowledgeMap[subject] &&
        knowledgeMap[subject][targetTopic]
    ) {
        const stats =
            knowledgeMap[subject][targetTopic];

        const total = Number(stats.total || 0);
        const correct = Number(stats.correct || 0);

        const accuracy =
            total > 0
                ? ((correct / total) * 100).toFixed(1)
                : 0;

        diagnosticInfo =
            `[玩家數據] 「${subject}-${targetTopic}」`
            + `正確率 ${accuracy}%`
            + `，已練習 ${total} 題。`;

        if (total >= 4 && accuracy < 40) {
            difficulty = "easy";
        }

        if (total >= 6 && accuracy > 80) {
            difficulty = "hard";
        }
    }

    // ==========================================
    // 5. 安全預設值
    // ==========================================

    level = level || "高中";
    rank = rank || "一般";
    difficulty = difficulty || "medium";

    // ==========================================
    // 6. 防止同一次請求產生完全相同題目
    // ==========================================

    const randomSeed =
        `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    // ==========================================
    // 7. 最多進行幾次 Gemma 重新生成
    // ==========================================

    const MAX_GENERATION_ATTEMPTS = 2;

    for (
        let attempt = 1;
        attempt <= MAX_GENERATION_ATTEMPTS;
        attempt++
    ) {

        try {

            console.log(
                `[Quiz] ${subject} > ${targetTopic}`
                + ` | difficulty=${difficulty}`
                + ` | generation=${attempt}/${MAX_GENERATION_ATTEMPTS}`
            );

            // ==========================================
            // 8. Gemma 出題 Prompt
            // ==========================================

            const generationPrompt = `
你是專業的臺灣國高中考題設計 AI。

請產生「一道」高品質、可直接讓學生作答的四選一單選題。

【基本設定】

學科：
${subject}

題型：
${targetTopic}

題型要求：
${topicDescription}

程度：
${level}

段位：
${rank}

難度：
${difficulty}

玩家診斷：
${diagnosticInfo || "目前沒有足夠玩家資料。"}

本次生成識別碼：
${randomSeed}-${attempt}

━━━━━━━━━━━━━━━━━━
【出題原則】
━━━━━━━━━━━━━━━━━━

1. 題目必須符合「${subject}」。
2. 題目必須符合「${targetTopic}」。
3. 必須只有一個最佳答案。
4. 必須有三個合理但錯誤的干擾選項。
5. 四個選項不可重複。
6. 不可出現兩個都可以被判定為正確的答案。
7. 題目本身必須提供足夠資訊解題。
8. 不可以要求學生猜測出題者想法。
9. 不可以用模糊或沒有明確定義的敘述。
10. 解析必須真正解釋為什麼正確答案正確。
11. 三個錯誤選項也要有合理的干擾性。
12. 不要把答案直接寫在題幹。
13. 不要把正確答案的文字直接複製成題目提示。
14. 不要出多選題。
15. 不要出「以上皆是」。
16. 不要出「以上皆非」。
17. 不要讓正確答案因為文字長度、語氣或格式特別突出。
18. 避免無意義的純記憶題，除非該題型本身就是知識記憶。
19. 如果是數學題，必須確認計算結果。
20. 如果是科學題，必須確認概念與因果關係。
21. 如果是歷史、公民、地理題，不可以虛構史實、法規或地理資料。
22. 英文題解析使用繁體中文。
23. 解析不可只是重複答案，必須說明判斷依據。

━━━━━━━━━━━━━━━━━━
【題目品質自我檢查】
━━━━━━━━━━━━━━━━━━

生成前請自行檢查：

A. 題目是否只有一個答案？
B. 三個干擾選項是否真的錯？
C. 題目資訊是否足夠？
D. 是否符合指定題型？
E. 解析是否支持答案？
F. 是否存在語意歧義？
G. 是否存在事實錯誤？

如果任一項無法確認，請重新設計題目。

━━━━━━━━━━━━━━━━━━
【輸出規則】
━━━━━━━━━━━━━━━━━━

只能輸出一個 JSON object。

第一個字元必須是 {
最後一個字元必須是 }

不要輸出 Markdown。
不要輸出任何說明文字。
不要輸出 JSON code fence。
不要增加其他欄位。

JSON 結構必須如下：

{
    "q": "題目",
    "correct": "正確答案",
    "wrong": [
        "錯誤答案1",
        "錯誤答案2",
        "錯誤答案3"
    ],
    "exp": "繁體中文解析",
    "subject": "${subject}",
    "sub_topic": "${targetTopic}"
}
`;

            // ==========================================
            // 9. 第一階段：Gemma 4 31B IT 出題
            // ==========================================

            const genResult =
                await gemmaModel.generateContent(
                    generationPrompt
                );

            const rawText =
                genResult.response
                    .text()
                    .trim();

            console.log(
                `[Quiz] Gemma Raw Response:`
                + ` ${rawText.substring(0, 3000)}`
            );

            // ==========================================
            // 10. 安全解析 Gemma JSON
            // ==========================================

            let cleanedText = rawText;

            cleanedText = cleanedText
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .replace(/^\uFEFF/, "")
                .trim();

            const firstBrace =
                cleanedText.indexOf("{");

            const lastBrace =
                cleanedText.lastIndexOf("}");

            if (
                firstBrace === -1 ||
                lastBrace === -1 ||
                lastBrace <= firstBrace
            ) {
                throw new Error(
                    "Gemma 回應中找不到完整 JSON"
                );
            }

            cleanedText =
                cleanedText.substring(
                    firstBrace,
                    lastBrace + 1
                );

            let question;

            try {

                question =
                    JSON.parse(cleanedText);

            } catch (parseError) {

                console.error(
                    "[Quiz] Gemma JSON.parse 第一次失敗:",
                    parseError.message
                );

                console.error(
                    "[Quiz] Gemma 原始回應:",
                    rawText
                );

                // 移除 JSON 不允許的控制字元
                cleanedText =
                    cleanedText.replace(
                        /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
                        ""
                    );

                try {

                    question =
                        JSON.parse(cleanedText);

                } catch (secondParseError) {

                    console.error(
                        "[Quiz] Gemma JSON.parse 第二次仍然失敗:",
                        secondParseError.message
                    );

                    console.error(
                        "[Quiz] 嘗試解析的內容:",
                        cleanedText
                    );

                    throw new Error(
                        "Gemma JSON 解析失敗"
                    );
                }
            }

            // ==========================================
            // 11. 確保資料是物件
            // ==========================================

            if (
                !question ||
                typeof question !== "object" ||
                Array.isArray(question)
            ) {
                throw new Error(
                    "Gemma 回傳的 JSON 不是有效物件"
                );
            }

            // ==========================================
            // 12. 強制補回系統分類
            // ==========================================

            question.subject = subject;
            question.sub_topic = targetTopic;

            // ==========================================
            // 13. 第一階段：Node.js 自動品質檢查
            // ==========================================

            const validation =
                validateQuizQuestion(
                    question,
                    subject,
                    targetTopic
                );

            console.log(
                `[Quiz Check] passed=${validation.passed}`,
                validation.issues
            );

            // ==========================================
            // 14. 完全通過
            //
            // 不浪費 Gemini API
            // ==========================================

            if (validation.passed) {

                console.log(
                    "[Quiz] ✓ 通過自動品質檢查"
                );

                return res.json({
                    text: JSON.stringify(question),
                    quality: {
                        status: "passed",
                        reviewer: "program",
                        corrected: false
                    }
                });
            }

            // ==========================================
            // 15. 可疑題目
            //
            // 只有這裡才呼叫 Gemini
            // ==========================================

            console.log(
                "[Quiz] ⚠ 可疑題目，送 Gemini 審核",
                validation.issues
            );

            const review =
                await reviewQuizQuestion(
                    question,
                    subject,
                    targetTopic,
                    validation.issues
                );

            console.log(
                `[Quiz Review] approved=${review.approved}`
                + ` confidence=${review.confidence}`
            );

            // ==========================================
            // 16. Gemini 判定通過
            // ==========================================

            if (
                review.approved &&
                review.confidence >= 0.75
            ) {

                // ------------------------------------------
                // Gemini 有提供修正版
                // ------------------------------------------

                if (review.fixedQuestion) {

                    const fixed =
                        review.fixedQuestion;

                    fixed.subject = subject;
                    fixed.sub_topic = targetTopic;

                    const fixedValidation =
                        validateQuizQuestion(
                            fixed,
                            subject,
                            targetTopic
                        );

                    // ------------------------------------------
                    // 修正版再次經過 Node.js 檢查
                    // ------------------------------------------

                    if (fixedValidation.passed) {

                        console.log(
                            "[Quiz] ✓ Gemini 修正後通過"
                        );

                        return res.json({
                            text: JSON.stringify(fixed),
                            quality: {
                                status: "reviewed",
                                reviewer: "gemini",
                                corrected: true
                            }
                        });
                    }

                    console.log(
                        "[Quiz] Gemini 修正版仍有問題",
                        fixedValidation.issues
                    );

                } else {

                    // ------------------------------------------
                    // Gemini 認為原題可以直接使用
                    // ------------------------------------------

                    console.log(
                        "[Quiz] ✓ Gemini 審核通過"
                    );

                    return res.json({
                        text: JSON.stringify(question),
                        quality: {
                            status: "reviewed",
                            reviewer: "gemini",
                            corrected: false
                        }
                    });
                }
            }

            // ==========================================
            // 17. Gemini 判定不通過
            //
            // 不把可疑題目送給玩家
            // 下一輪重新叫 Gemma 出題
            // ==========================================

            console.log(
                "[Quiz] ✗ Gemini 判定不通過"
                + " → Gemma 重新生成"
            );

        } catch (error) {

            console.error(
                `[Quiz] Generation attempt ${attempt} failed:`,
                error.message
            );

            // ==========================================
            // 最後一次失敗
            // ==========================================

            if (
                attempt === MAX_GENERATION_ATTEMPTS
            ) {

                console.error(
                    "[Quiz] 所有生成嘗試均失敗"
                );

                return res.status(500).json({
                    error: "生成失敗",
                    message:
                        "AI 題目品質管線多次嘗試後仍無法產生合格題目。"
                });
            }

            // ==========================================
            // 尚未達到最大次數
            // 下一輪重新生成
            // ==========================================

            console.log(
                `[Quiz] 將進行下一次生成：`
                + `${attempt + 1}/${MAX_GENERATION_ATTEMPTS}`
            );
        }
    }

    // ==========================================
    // 理論上不應該走到這裡
    // ==========================================

    return res.status(500).json({
        error: "生成失敗",
        message: "AI 題目生成流程結束但沒有取得有效題目。"
    });
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
        const result = await model.generateContent(prompt);
        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(responseText);
        res.json(json);
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
