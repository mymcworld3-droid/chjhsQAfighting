const { GoogleGenerativeAI } = require('@google/generative-ai');
const aiRouter = require('./ai-router');

const LEVELS = [
  '國小中年級',
  '國小高年級',
  '國中一年級',
  '國中二年級',
  '國中三年級',
  '高中職',
  '大學以上'
];
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const MAX_IMAGES = 8;
const MAX_IMAGE_BASE64 = 2_800_000;
const MAX_TEXT = 16000;
const MIN_QUESTIONS = 10;
const QUESTION_BATCH_SIZE = 5;
const MAX_QUESTIONS = 30;
const QUESTION_COUNT_CHOICES = Object.freeze(Array.from(
  { length: MAX_QUESTIONS - MIN_QUESTIONS + 1 }, (_, i) => MIN_QUESTIONS + i
));
// Each amount is an inclusive integer range; not a set of multiples of five.
const QUESTION_AMOUNT_PRESETS = Object.freeze({
  low: Object.freeze([10, 14]),
  medium: Object.freeze([15, 20]),
  high: Object.freeze([21, 30])
});
const MAX_REPORT_REASON = 1200;
const MAX_REVISION_HINT = 1600;

function cleanText(value, max = 4000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeDifficulty(value, fallback = 'medium') {
  const raw = String(value || '').toLowerCase().trim();
  if (DIFFICULTIES.has(raw)) return raw;
  if (/簡|easy/.test(raw)) return 'easy';
  if (/難|hard/.test(raw)) return 'hard';
  return fallback;
}

function normalizeLevel(value, fallback = '國中一年級') {
  const text = cleanText(value, 30);
  if (LEVELS.includes(text)) return text;
  if (/大學|成人|社會人士/.test(text)) return '大學以上';
  if (/高中|高職/.test(text)) return '高中職';
  if (/國中.*三|九年級/.test(text)) return '國中三年級';
  if (/國中.*二|八年級/.test(text)) return '國中二年級';
  if (/國中|七年級/.test(text)) return '國中一年級';
  if (/國小.*高|五年級|六年級/.test(text)) return '國小高年級';
  if (/國小|三年級|四年級/.test(text)) return '國小中年級';
  return LEVELS.includes(fallback) ? fallback : '國中一年級';
}

function validateImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, MAX_IMAGES).map((image, index) => {
    const mimeType = String(image?.mimeType || '').toLowerCase();
    const data = String(image?.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(mimeType)) throw new Error(`第 ${index + 1} 張圖片格式不支援`);
    if (!data || data.length > MAX_IMAGE_BASE64) throw new Error(`第 ${index + 1} 張圖片過大`);
    return { mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data };
  });
}

function normalizeQuestionAmount(value) {
  const amount = String(value || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(QUESTION_AMOUNT_PRESETS, amount) ? amount : 'medium';
}

function allowedQuestionCounts(amount) {
  return QUESTION_AMOUNT_PRESETS[normalizeQuestionAmount(amount)];
}

function normalizePlannedQuestionCount(value, amount = null) {
  const [min, max] = amount ? allowedQuestionCounts(amount) : [MIN_QUESTIONS, MAX_QUESTIONS];
  const candidate = Number(value);
  const requested = Number.isFinite(candidate) && candidate > 0 ? Math.ceil(candidate) : min;
  return Math.max(min, Math.min(max, requested));
}

function normalizeDongtianPlan(raw, creatorLevel, questionAmount = null) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const level = normalizeLevel(data.level, creatorLevel);
  const difficulty = normalizeDifficulty(data.difficulty);
  const subject = cleanText(data.subject || '綜合', 24) || '綜合';
  const questionCount = normalizePlannedQuestionCount(data.questionCount, questionAmount);
  const knowledgePoints = Array.isArray(data.knowledgePoints)
    ? [...new Set(data.knowledgePoints.map((x) => cleanText(x, 180)).filter(Boolean))].slice(0, 50)
    : [];
  const sourceBlueprints = Array.isArray(data.questionBlueprints) ? data.questionBlueprints : [];
  const questionBlueprints = [];

  for (let i = 0; i < questionCount; i++) {
    const rawBlueprint = sourceBlueprints[i] || {};
    const fallbackFocus = knowledgePoints[i % Math.max(1, knowledgePoints.length)] || `素材重點 ${i + 1}`;
    const ratio = questionCount <= 1 ? 0 : i / (questionCount - 1);
    const fallbackDifficulty = ratio < 0.34 ? 'easy' : (ratio < 0.72 ? 'medium' : 'hard');
    questionBlueprints.push({
      index: i + 1,
      focus: cleanText(rawBlueprint.focus || fallbackFocus, 220) || fallbackFocus,
      skill: cleanText(rawBlueprint.skill || (ratio < 0.34 ? '基礎辨識' : (ratio < 0.72 ? '理解' : '應用整合')), 120),
      difficulty: normalizeDifficulty(rawBlueprint.difficulty, fallbackDifficulty),
      subject: cleanText(rawBlueprint.subject || subject, 24) || subject
    });
  }

  return {
    name: cleanText(data.name, 40) || '無名洞天',
    level,
    levelOrder: LEVELS.indexOf(level),
    difficulty,
    subject,
    knowledgePoints,
    coverageSummary: cleanText(data.coverageSummary, 1000),
    questionCount,
    questionStructure: {
      type: 'single_choice',
      selectionMode: 'single',
      optionsPerQuestion: 4,
      correctAnswersPerQuestion: 1,
      ordering: 'foundation_to_application'
    },
    questionBlueprints
  };
}

function buildPlanningPrompt(text, creatorLevel, imageCount, questionAmount = 'medium') {
  const amount = normalizeQuestionAmount(questionAmount);
  const allowedCounts = allowedQuestionCounts(amount);
  const amountLabel = ({ low:'少量', medium:'中量', high:'大量' })[amount];
  return `
[任務]
你是「洞天」學習關卡規劃師。先分析使用者提供的所有文字與 ${imageCount} 張圖片，只做「題量與題目結構規劃」，此階段不要實際出題。

[規劃要求]
1. 盡可能完整辨認素材中所有可獨立學習／考核的知識點。
2. 使用者選擇的題量偏好是「${amountLabel}」。本次 questionCount 應為 ${allowedCounts[0]}～${allowedCounts[1]} 之間任一整數，依素材實際可考核知識點選出合適的題數，不要湊成 5 的倍數或無故補題。
3. 無論使用者選哪一種題量，每個洞天至少 ${MIN_QUESTIONS} 題；後續每批最多 ${QUESTION_BATCH_SIZE} 題，最後一批僅生成剩餘題數（可為 1～${QUESTION_BATCH_SIZE} 題）。
4. 題目結構固定為「四選一單選題」：每題只能選一個答案、恰好一個 correct、恰好三個 wrong；禁止複選題、多選題、複數正解。
5. questionBlueprints 必須恰好有 questionCount 筆，依實際遊玩順序規劃每一題要考的 focus、skill、difficulty、subject。
6. 題序由基礎辨識 → 理解 → 應用／整合，避免規劃同義重複題。
7. 程度只能從以下值選一個：${LEVELS.join('、')}。建立者目前程度是「${cleanText(creatorLevel, 30) || '未提供'}」，僅供參考。
8. difficulty 只能是 easy / medium / hard。subject 優先使用：國文、英文、數學、公民、歷史、地理、物理、化學、生物；跨多科或無法歸入單科時用「綜合」。
9. 洞天名稱要像修仙世界中的秘境名稱，簡短、有記憶點，並暗示素材主題。

[使用者文字]
${cleanText(text, MAX_TEXT) || '（沒有額外文字，主要依圖片內容規劃）'}

[輸出 JSON Only]
{
  "name": "洞天名稱",
  "level": "上述程度之一",
  "difficulty": "easy|medium|hard",
  "subject": "主要科目或綜合",
  "knowledgePoints": ["知識點1", "知識點2"],
  "coverageSummary": "規劃如何涵蓋素材",
  "questionCount": ${Math.ceil((allowedCounts[0] + allowedCounts[1]) / 2)},
  "questionStructure": {
    "type": "single_choice",
    "selectionMode": "single",
    "optionsPerQuestion": 4
  },
  "questionBlueprints": [
    {
      "focus": "本題要考的知識點",
      "skill": "基礎辨識|理解|應用整合",
      "difficulty": "easy|medium|hard",
      "subject": "科目"
    }
  ]
}
不要輸出 markdown，不要實際生成題目，不要加入 JSON 以外的文字。`;
}

function questionFingerprint(value) {
  return cleanText(value, 2500).toLowerCase().replace(/\s+/g, ' ').replace(/[，。！？、,.!?;；:："'「」『』（）()]/g, '').slice(0, 500);
}

function buildQuestionBatchPrompt(text, creatorLevel, imageCount, plan, generatedQuestions, startIndex, batchSize) {
  const endIndex = startIndex + batchSize;
  const blueprints = plan.questionBlueprints.slice(startIndex, endIndex);
  return `
[任務]
你是「洞天」題目生成師。洞天規劃已完成。現在只生成第 ${startIndex + 1}～${endIndex} 題，共恰好 ${batchSize} 題。
這是分批生成流程，每批最多 ${QUESTION_BATCH_SIZE} 題；本批只生成剩餘所需的 ${batchSize} 題，最後一批可少於 ${QUESTION_BATCH_SIZE} 題；不得額外湊題。

[洞天規劃]
${JSON.stringify({
    name: plan.name,
    level: plan.level,
    difficulty: plan.difficulty,
    subject: plan.subject,
    knowledgePoints: plan.knowledgePoints,
    coverageSummary: plan.coverageSummary,
    questionCount: plan.questionCount,
    questionStructure: plan.questionStructure
  })}

[本批題目藍圖]
${JSON.stringify(blueprints)}

[先前已生成的全部題目]
${generatedQuestions.length ? JSON.stringify(generatedQuestions) : '[]'}

[重要規則]
1. 你必須閱讀「先前已生成的全部題目」，本批不得重複或近義改寫任何已生成題目，也不要再次考完全相同的切入角度。
2. 題目必須依照本批藍圖順序生成，並與素材內容有直接依據。
3. 每題只能是四選一單選題，不可複選：correct 必須是單一字串，wrong 必須恰好三個不同字串。
4. correct 與三個 wrong 彼此不可重複，且只能有一個明確正確答案。
5. exp 必須解釋為何正確，必要時說明其他選項錯在哪裡。
6. id 依全洞天題序使用 DT-001、DT-002……，不得重號。
7. 不要輸出已生成過的題目，只輸出本批 ${batchSize} 題。

[建立者程度]
${cleanText(creatorLevel, 30) || '未提供'}

[使用者文字]
${cleanText(text, MAX_TEXT) || '（沒有額外文字，主要依圖片內容出題；本請求另附 ' + imageCount + ' 張圖片）'}

[輸出 JSON Only]
{
  "questions": [
    {
      "id": "DT-001",
      "difficulty": "easy|medium|hard",
      "q": "題目",
      "correct": "唯一正確選項",
      "wrong": ["錯誤選項1", "錯誤選項2", "錯誤選項3"],
      "exp": "解析",
      "subject": "科目標籤"
    }
  ]
}
不要輸出 markdown，不要加入 JSON 以外的文字。`;
}

function normalizeQuestionBatch(raw, plan, existingQuestions, startIndex, expectedCount) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const fingerprints = new Set((existingQuestions || []).map((item) => questionFingerprint(item.q)).filter(Boolean));
  const normalized = [];

  for (const item of questions) {
    if (normalized.length >= expectedCount) break;
    if (Array.isArray(item?.correct) || item?.multiple === true || item?.multiSelect === true) continue;
    const q = cleanText(item?.q, 2500);
    const correct = cleanText(item?.correct, 800);
    const wrong = Array.isArray(item?.wrong) ? item.wrong.map((x) => cleanText(x, 800)).filter(Boolean) : [];
    const exp = cleanText(item?.exp, 3500);
    if (!q || !correct || wrong.length !== 3 || !exp) continue;
    const uniqueWrong = [...new Set(wrong.filter((x) => x !== correct))];
    if (uniqueWrong.length !== 3) continue;
    const fp = questionFingerprint(q);
    if (!fp || fingerprints.has(fp)) continue;
    fingerprints.add(fp);
    const globalIndex = startIndex + normalized.length;
    const blueprint = plan.questionBlueprints[globalIndex] || {};
    normalized.push({
      id: `DT-${String(globalIndex + 1).padStart(3, '0')}`,
      difficulty: normalizeDifficulty(item?.difficulty, blueprint.difficulty || plan.difficulty),
      q,
      correct,
      wrong: uniqueWrong,
      exp,
      subject: cleanText(item?.subject || blueprint.subject || plan.subject, 24) || plan.subject
    });
  }

  if (normalized.length !== expectedCount) {
    throw new Error(`本批需要 ${expectedCount} 題有效單選題，AI 僅產生 ${normalized.length} 題；將重新嘗試`);
  }
  return normalized;
}

// Backward-compatible export name for older tests/tools: buildPrompt now means the planning pass.
function buildPrompt(text, creatorLevel, imageCount, questionAmount = 'medium') {
  return buildPlanningPrompt(text, creatorLevel, imageCount, questionAmount);
}

async function callGemini(provider, prompt, images) {
  const genAI = new GoogleGenerativeAI(provider.key);
  const model = genAI.getGenerativeModel({
    model: provider.model,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 16384
    }
  });
  const parts = [{ text: prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } }))];
  const result = await model.generateContent(parts);
  return result.response.text();
}

async function callOpenAICompatible(provider, prompt, images) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const content = [
      { type: 'text', text: prompt },
      ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))
    ];
    const response = await fetch(`${String(provider.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key}`,
        ...(provider.headers || {})
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: 'Return valid JSON only. Analyze every supplied image and the text together.' },
          { role: 'user', content }
        ],
        max_tokens: 12000
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 220)}`);
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Vision provider returned no content');
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

async function generateMultimodalJSON(prompt, images) {
  if (!images.length) return aiRouter.generateJSON(prompt, { timeoutMs: 70000 });
  // Match the shared router's round-robin/random strategy instead of always using model 1.
  const providers = aiRouter.orderedProviders(aiRouter.buildProviders());
  if (!providers.length) throw new Error('No AI provider configured');
  const errors = [];
  for (const provider of providers) {
    try {
      const raw = provider.type === 'gemini'
        ? await Promise.race([
            callGemini(provider, prompt, images),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timeout')), 70000))
          ])
        : await callOpenAICompatible(provider, prompt, images);
      const text = aiRouter.extractJsonText(raw);
      const data = JSON.parse(text);
      aiRouter.recordAttempt(provider, 'success');
      console.log(`[AI Router multimodal] ${provider.name}/${provider.model} success`);
      return { data, provider: provider.name, model: provider.model };
    } catch (error) {
      aiRouter.recordAttempt(provider, 'failed', error);
      console.warn(`[AI Router multimodal] ${provider.name}/${provider.model} failed: ${error?.message || error}`);
      errors.push(`${provider.name}: ${error?.message || error}`);
    }
  }
  throw new Error(`All multimodal providers failed: ${errors.join(' | ')}`);
}

function normalizeResult(raw, creatorLevel) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const level = normalizeLevel(data.level, creatorLevel);
  const difficulty = normalizeDifficulty(data.difficulty);
  const subject = cleanText(data.subject || '綜合', 24) || '綜合';
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const normalizedQuestions = [];
  const fingerprints = new Set();

  for (const item of questions.slice(0, MAX_QUESTIONS)) {
    const q = cleanText(item?.q, 2500);
    const correct = cleanText(item?.correct, 800);
    const wrong = Array.isArray(item?.wrong) ? item.wrong.map((x) => cleanText(x, 800)).filter(Boolean) : [];
    const exp = cleanText(item?.exp, 3500);
    if (!q || !correct || wrong.length < 3 || !exp) continue;
    const uniqueWrong = [...new Set(wrong.filter((x) => x !== correct))].slice(0, 3);
    if (uniqueWrong.length !== 3) continue;
    const fp = q.toLowerCase().replace(/\s+/g, ' ').slice(0, 220);
    if (fingerprints.has(fp)) continue;
    fingerprints.add(fp);
    normalizedQuestions.push({
      id: `DT-${String(normalizedQuestions.length + 1).padStart(3, '0')}`,
      difficulty: normalizeDifficulty(item?.difficulty, difficulty),
      q,
      correct,
      wrong: uniqueWrong,
      exp,
      subject: cleanText(item?.subject || subject, 24) || subject
    });
  }

  if (normalizedQuestions.length < MIN_QUESTIONS) throw new Error(`AI 產生的有效題目不足 ${MIN_QUESTIONS} 題，請增加素材後重試`);
  const knowledgePoints = Array.isArray(data.knowledgePoints)
    ? [...new Set(data.knowledgePoints.map((x) => cleanText(x, 180)).filter(Boolean))].slice(0, 50)
    : [];

  return {
    name: cleanText(data.name, 40) || '無名洞天',
    level,
    levelOrder: LEVELS.indexOf(level),
    difficulty,
    subject,
    knowledgePoints,
    coverageSummary: cleanText(data.coverageSummary, 1000),
    questions: normalizedQuestions,
    questionCount: normalizedQuestions.length
  };
}



function buildDongtianDoubleCheckPrompt(dongtian) {
  return `
[任務]
你是第二位獨立的洞天品質審核員。這份洞天已由另一個 AI 生成，請逐題重新檢查，而不是假設它正確。

[洞天 JSON]
${JSON.stringify(dongtian)}

[必查項目]
1. 每一題題幹事實、數學與邏輯是否成立。
2. correct 是否唯一正確，三個 wrong 是否確實錯誤且不重複。
3. exp 是否和正解一致，計算與推理無誤。
4. 題目程度、難度、科目是否合理。
5. 題組是否有明顯重複、互相矛盾，題序是否由基礎到理解／應用。
6. 洞天名稱、主要科目與程度是否和整組題目相符。

[判定規則]
- 逐題確實檢查；若所有題目正確且符合上列條件，approved=true、confidence 給 0～1 的實際信心值，issues 必須為 []。
- 僅在能指明真實、可驗證的錯誤時填入 issues，每筆必須對應洞天內真實存在的 questionId 並清楚說明錯誤。
- 沒有具體錯誤時，不要為了符合輸出範例而編造 issues；不得複製範例的 confidence 數字。
- 若有任何實質錯題，approved=false；單純個人風格偏好不應被列為實質錯誤。

[輸出 JSON Only，以下只是格式示例：沒有發現錯誤時]
{
  "approved": true,
  "confidence": 0.95,
  "summary": "逐題檢查後未發現明確錯誤",
  "issues": []
}`;
}

function normalizeDongtianDoubleCheck(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const issues = Array.isArray(data.issues) ? data.issues.map((item) => ({
    questionId: cleanText(item?.questionId, 40),
    issue: cleanText(item?.issue, 800)
  })).filter((item) => item.issue).slice(0, 30) : [];
  return {
    approved: data.approved === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1200),
    issues
  };
}

async function verifyGeneratedDongtian(dongtian) {
  const run = await aiRouter.generateJSON(buildDongtianDoubleCheckPrompt(dongtian), { timeoutMs: 60000 });
  const review = normalizeDongtianDoubleCheck(run.data);
  review.passed = review.approved && review.confidence >= 0.8 && review.issues.length === 0;
  return { review, provider: run.provider, model: run.model };
}

function normalizeQuestionSnapshot(input) {
  const item = input && typeof input === 'object' ? input : {};
  const wrong = Array.isArray(item.wrong) ? item.wrong.map((x) => cleanText(x, 800)).filter(Boolean).slice(0, 3) : [];
  return {
    id: cleanText(item.id, 40),
    difficulty: normalizeDifficulty(item.difficulty),
    q: cleanText(item.q, 2500),
    correct: cleanText(item.correct, 800),
    wrong,
    exp: cleanText(item.exp, 3500),
    subject: cleanText(item.subject || '綜合', 24) || '綜合'
  };
}

function buildQuestionReviewPrompt(question, reason, dongtian = {}) {
  const q = normalizeQuestionSnapshot(question);
  return `
[任務]
你是洞天題目品質審核員。玩家回報一題可能有錯，請保守、嚴格判定，不要因為玩家質疑就迎合。

[只有下列情況才算確實有誤]
- 題幹有事實、數學、語意或邏輯錯誤，導致題目不成立。
- 標示的 correct 並非唯一正確答案，或 wrong 中也存在合理正解。
- 題目資訊不足、條件矛盾或關鍵歧義，使合理作答者無法唯一判定。
- 解析與題目／答案明顯矛盾。
- 程度或科目標籤本身不是錯誤，除非會造成知識內容實質錯置。
單純「太難、太簡單、不喜歡措辭」不能判為有誤。

[洞天]
名稱：${cleanText(dongtian.name, 60)}
程度：${cleanText(dongtian.level, 30)}
難度：${cleanText(dongtian.difficulty, 20)}
科目：${cleanText(dongtian.subject, 30)}

[原題 JSON]
${JSON.stringify(q)}

[玩家回報]
${cleanText(reason, MAX_REPORT_REASON)}

[輸出 JSON Only]
{
  "hasError": true,
  "confidence": 0.0,
  "errorTypes": ["answer_mismatch|ambiguity|factual|logic|explanation|other"],
  "summary": "簡短判定",
  "evidence": "具體指出錯在哪裡；若無錯則說明為何原題仍成立"
}`;
}

function normalizeQuestionReview(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
  return {
    hasError: data.hasError === true,
    confidence,
    errorTypes: Array.isArray(data.errorTypes) ? data.errorTypes.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 6) : [],
    summary: cleanText(data.summary, 600),
    evidence: cleanText(data.evidence, 1800)
  };
}

function buildQuestionReviewVerificationPrompt(question, reason, firstReview, dongtian = {}) {
  return `
[任務]
你是第二位獨立審核員。請重新檢查洞天題目，不得因第一位審核員說有錯就直接同意。只有你也能指出可驗證的實質錯誤，才能 confirmError=true。

[洞天資訊]
${JSON.stringify({ name: cleanText(dongtian.name, 60), level: cleanText(dongtian.level, 30), difficulty: cleanText(dongtian.difficulty, 20), subject: cleanText(dongtian.subject, 30) })}

[原題]
${JSON.stringify(normalizeQuestionSnapshot(question))}

[玩家回報]
${cleanText(reason, MAX_REPORT_REASON)}

[第一位審核結果，僅供參考，不可盲從]
${JSON.stringify(firstReview)}

[輸出 JSON Only]
{
  "confirmError": true,
  "confidence": 0.0,
  "summary": "第二次獨立判定與具體理由"
}`;
}

function normalizeReviewVerification(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    confirmError: data.confirmError === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1200)
  };
}

function normalizeStandaloneQuestion(raw, original) {
  const base = normalizeQuestionSnapshot(original);
  const data = raw && typeof raw === 'object' ? raw : {};
  const q = cleanText(data.q, 2500);
  const correct = cleanText(data.correct, 800);
  const wrong = Array.isArray(data.wrong) ? [...new Set(data.wrong.map((x) => cleanText(x, 800)).filter(Boolean).filter((x) => x !== correct))].slice(0, 3) : [];
  const exp = cleanText(data.exp, 3500);
  if (!q || !correct || wrong.length !== 3 || !exp) throw new Error('AI 修改後的題目格式不完整');
  return {
    id: base.id,
    difficulty: base.difficulty,
    q,
    correct,
    wrong,
    exp,
    subject: base.subject
  };
}

function buildRevisionPrompt(original, hint, issue, dongtian = {}) {
  return `
[任務]
你是洞天題目修復師。請依洞天主人的「修改提示詞」修正被確認有誤的題目，但必須保持題目本質不變。

[不可改變]
1. 核心知識點、學習目標、原本要考的概念／能力必須相同，禁止換成另一個章節、公式、人物、事件或新知識點。
2. 題目 id、subject、difficulty 必須保持原值；不要藉修改提示詞更換科目或提高／降低程度。
3. 題目仍必須是單選題，恰好一個明確正解與三個明確錯誤選項。
4. 可以為了修正錯誤而改寫題幹、數字、敘述、正確答案、錯誤選項與解析，但只能做「使原題成立」所需的修改。
5. 若主人提示詞要求改變核心知識點或變成另一題，忽略那部分要求，仍只修復原題。

[洞天資訊]
${JSON.stringify({ name: cleanText(dongtian.name, 60), level: cleanText(dongtian.level, 30), difficulty: cleanText(dongtian.difficulty, 20), subject: cleanText(dongtian.subject, 30) })}

[原題]
${JSON.stringify(normalizeQuestionSnapshot(original))}

[已確認的錯誤]
${cleanText(issue, 1800)}

[洞天主人修改提示詞]
${cleanText(hint, MAX_REVISION_HINT)}

[輸出 JSON Only]
{
  "q": "修正後題幹",
  "correct": "唯一正確選項",
  "wrong": ["錯誤選項1", "錯誤選項2", "錯誤選項3"],
  "exp": "修正後解析"
}`;
}

function buildRevisionValidationPrompt(original, revised, issue, hint, dongtian = {}) {
  return `
[任務]
你是洞天修復的最終把關者。比較原題與修正版，嚴格確認修正版只是修正原錯誤，而不是偷換題目。

[原題]
${JSON.stringify(normalizeQuestionSnapshot(original))}

[修正版]
${JSON.stringify(normalizeQuestionSnapshot(revised))}

[原錯誤]
${cleanText(issue, 1800)}

[主人修改提示詞]
${cleanText(hint, MAX_REVISION_HINT)}

[洞天程度]
${cleanText(dongtian.level, 30)}

[全部條件都必須成立]
- essencePreserved：核心知識點、學習目標與解題能力沒有改變。
- errorResolved：已確認的原錯誤確實修正。
- singleCorrect：只有一個明確正解，三個 wrong 都不是合理正解。
- noNewError：沒有新增事實、計算、邏輯、語意或解析錯誤。
- levelAppropriate：仍適合原洞天程度與原難度。

[輸出 JSON Only]
{
  "essencePreserved": true,
  "errorResolved": true,
  "singleCorrect": true,
  "noNewError": true,
  "levelAppropriate": true,
  "confidence": 0.0,
  "summary": "最終審核理由"
}`;
}

function normalizeRevisionValidation(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const result = {
    essencePreserved: data.essencePreserved === true,
    errorResolved: data.errorResolved === true,
    singleCorrect: data.singleCorrect === true,
    noNewError: data.noNewError === true,
    levelAppropriate: data.levelAppropriate === true,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    summary: cleanText(data.summary, 1400)
  };
  result.accepted = result.essencePreserved && result.errorResolved && result.singleCorrect && result.noNewError && result.levelAppropriate && result.confidence >= 0.8;
  return result;
}

// A failed whole-cave review must not discard every already-generated question
// before we have checked whether the reviewer produced an inconclusive judgment
// or identified a small number of repairable, concrete mistakes.
async function reviewAndRepairGeneratedDongtian(dongtian) {
  const initial = await verifyGeneratedDongtian(dongtian);
  if (initial.review.passed) {
    return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs: [] };
  }

  const issues = initial.review.issues;
  const repairs = [];
  let candidate = dongtian;

  if (issues.length > 0 && issues.length <= 3) {
    const ids = new Set(dongtian.questions.map((question) => question.id));
    const uniqueIssues = new Map();
    for (const issue of issues) {
      if (!ids.has(issue.questionId)) {
        // A fabricated or unidentifiable issue is inconclusive, not proof of a safe cave.
        return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs, blocked: 'unknown_question_id' };
      }
      uniqueIssues.set(issue.questionId, [
        uniqueIssues.get(issue.questionId), issue.issue
      ].filter(Boolean).join('；'));
    }
    candidate = { ...dongtian, questions: dongtian.questions.map((question) => ({ ...question })) };
    for (const [questionId, issue] of uniqueIssues) {
      const index = candidate.questions.findIndex((question) => question.id === questionId);
      const original = candidate.questions[index];
      const hint = '只修正審核員指出的實質錯誤，維持原題的核心知識點、學習目標、難度和單選題結構。';
      try {
        const rewrite = await aiRouter.generateJSON(
          buildRevisionPrompt(original, hint, issue, candidate), { timeoutMs: 60000 }
        );
        const revised = normalizeStandaloneQuestion(rewrite.data, original);
        const validationRun = await aiRouter.generateJSON(
          buildRevisionValidationPrompt(original, revised, issue, hint, candidate), { timeoutMs: 60000 }
        );
        const validation = normalizeRevisionValidation(validationRun.data);
        repairs.push({ questionId, validated: validation.accepted, model: validationRun.model });
        if (!validation.accepted) {
          return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs, blocked: 'revision_validation' };
        }
        const revisedFingerprint = questionFingerprint(revised.q);
        if (candidate.questions.some((question, i) => i !== index && questionFingerprint(question.q) === revisedFingerprint)) {
          return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs, blocked: 'duplicate_after_revision' };
        }
        candidate.questions[index] = revised;
      } catch (error) {
        console.warn('[Dongtian auto-repair] failed', questionId, error);
        return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs, blocked: 'revision_error' };
      }
    }
  } else if (issues.length > 3) {
    return { dongtian, doubleCheck: initial, initialDoubleCheck: initial, repairs, blocked: 'too_many_issues' };
  }

  // Recheck independently after every accepted repair, or once when the initial
  // reviewer rejected without identifying any actual question error.
  const final = await verifyGeneratedDongtian(candidate);
  return { dongtian: candidate, doubleCheck: final, initialDoubleCheck: initial, repairs };
}

module.exports = function registerDongtianApi(app) {
  app.post('/api/review-dongtian-question', async (req, res) => {
    try {
      const question = normalizeQuestionSnapshot(req.body?.question);
      const reason = cleanText(req.body?.reason, MAX_REPORT_REASON);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!question.q || !question.correct || question.wrong.length !== 3 || !reason) {
        return res.status(400).json({ error: '回報資料不完整' });
      }

      const first = await aiRouter.generateJSON(buildQuestionReviewPrompt(question, reason, dongtian), { timeoutMs: 50000 });
      const review = normalizeQuestionReview(first.data);
      let verification = { confirmError: false, confidence: 0, summary: '第一階段未達複核門檻' };
      let secondProvider = null;
      let secondModel = null;
      if (review.hasError && review.confidence >= 0.65) {
        const second = await aiRouter.generateJSON(buildQuestionReviewVerificationPrompt(question, reason, review, dongtian), { timeoutMs: 50000 });
        verification = normalizeReviewVerification(second.data);
        secondProvider = second.provider;
        secondModel = second.model;
      }
      const confirmed = review.hasError && review.confidence >= 0.75 && verification.confirmError && verification.confidence >= 0.75;
      res.json({
        confirmed,
        review,
        verification,
        audit: {
          firstProvider: first.provider,
          firstModel: first.model,
          secondProvider,
          secondModel
        }
      });
    } catch (error) {
      console.error('[Dongtian question review]', error);
      res.status(500).json({ error: error?.message || '題目審核失敗' });
    }
  });

  app.post('/api/revise-owned-dongtian-question', async (req, res) => {
    try {
      const original = normalizeQuestionSnapshot(req.body?.originalQuestion);
      const hint = cleanText(req.body?.hint, MAX_REVISION_HINT);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!original.q || !original.correct || original.wrong.length !== 3 || hint.length < 8) {
        return res.status(400).json({ error: '修改提示詞必須具體指出原題哪裡錯誤、不精確或有歧義' });
      }

      const first = await aiRouter.generateJSON(buildQuestionReviewPrompt(original, hint, dongtian), { timeoutMs: 50000 });
      const review = normalizeQuestionReview(first.data);
      let verification = { confirmError: false, confidence: 0, summary: '' };
      if (review.hasError && review.confidence >= 0.65) {
        const second = await aiRouter.generateJSON(buildQuestionReviewVerificationPrompt(original, hint, review, dongtian), { timeoutMs: 50000 });
        verification = normalizeReviewVerification(second.data);
      }
      const issueConfirmed = review.hasError && review.confidence >= 0.75 && verification.confirmError && verification.confidence >= 0.75;
      if (!issueConfirmed) {
        return res.status(422).json({
          error: 'AI 無法確認提示詞所指出的是原題的實質錯誤；請明確說明錯誤答案、歧義、條件不足、計算或事實問題',
          review,
          verification
        });
      }

      const issue = [review.summary, review.evidence, verification.summary].filter(Boolean).join('；');
      const rewrite = await aiRouter.generateJSON(buildRevisionPrompt(original, hint, issue, dongtian), { timeoutMs: 60000 });
      const revised = normalizeStandaloneQuestion(rewrite.data, original);
      const validationRun = await aiRouter.generateJSON(buildRevisionValidationPrompt(original, revised, issue, hint, dongtian), { timeoutMs: 60000 });
      const validation = normalizeRevisionValidation(validationRun.data);
      if (!validation.accepted) {
        return res.status(422).json({ error: '主動修改未通過最終審核：不得改變原題本質', validation });
      }
      res.json({ revised, review, verification, validation });
    } catch (error) {
      console.error('[Dongtian owner revision]', error);
      res.status(500).json({ error: error?.message || '主人題目修改失敗' });
    }
  });

  app.post('/api/revise-dongtian-question', async (req, res) => {
    try {
      const original = normalizeQuestionSnapshot(req.body?.originalQuestion);
      const hint = cleanText(req.body?.hint, MAX_REVISION_HINT);
      const issue = cleanText(req.body?.issue, 1800);
      const dongtian = req.body?.dongtian && typeof req.body.dongtian === 'object' ? req.body.dongtian : {};
      if (!original.q || !original.correct || original.wrong.length !== 3 || !hint) {
        return res.status(400).json({ error: '修復資料不完整' });
      }

      const rewrite = await aiRouter.generateJSON(buildRevisionPrompt(original, hint, issue, dongtian), { timeoutMs: 60000 });
      const revised = normalizeStandaloneQuestion(rewrite.data, original);
      const validationRun = await aiRouter.generateJSON(buildRevisionValidationPrompt(original, revised, issue, hint, dongtian), { timeoutMs: 60000 });
      const validation = normalizeRevisionValidation(validationRun.data);
      if (!validation.accepted) {
        return res.status(422).json({
          error: '修改未通過最終審核：必須保持原題本質且完整修正錯誤',
          validation
        });
      }
      res.json({
        revised,
        validation,
        audit: {
          rewriteProvider: rewrite.provider,
          rewriteModel: rewrite.model,
          validationProvider: validationRun.provider,
          validationModel: validationRun.model
        }
      });
    } catch (error) {
      console.error('[Dongtian question revision]', error);
      res.status(500).json({ error: error?.message || '題目修復失敗' });
    }
  });

  app.post('/api/generate-dongtian', async (req, res) => {
    try {
      const text = cleanText(req.body?.text, MAX_TEXT);
      const creatorLevel = normalizeLevel(req.body?.creatorLevel, '國中一年級');
      const questionAmount = normalizeQuestionAmount(req.body?.questionAmount);
      const images = validateImages(req.body?.images);
      if (!text && !images.length) return res.status(400).json({ error: '請至少提供文字或一張圖片' });

      // Pass 1: only identify required question count, metadata and ordered single-choice structure.
      const planningRun = await generateMultimodalJSON(buildPlanningPrompt(text, creatorLevel, images.length, questionAmount), images);
      const plan = normalizeDongtianPlan(planningRun.data, creatorLevel, questionAmount);

      // Pass 2+: generate up to five questions per batch; final batch uses the exact remainder.
      // Every batch prompt includes every question already generated so the model can avoid repetition.
      const generatedQuestions = [];
      const batchAudit = [];
      for (let startIndex = 0; startIndex < plan.questionCount; startIndex += QUESTION_BATCH_SIZE) {
        const expectedCount = Math.min(QUESTION_BATCH_SIZE, plan.questionCount - startIndex);
        let batch = null;
        let lastError = null;
        let successfulRun = null;

        for (let attempt = 1; attempt <= 2 && !batch; attempt++) {
          try {
            const prompt = buildQuestionBatchPrompt(
              text, creatorLevel, images.length, plan, generatedQuestions, startIndex, expectedCount
            );
            const routed = await generateMultimodalJSON(prompt, images);
            batch = normalizeQuestionBatch(routed.data, plan, generatedQuestions, startIndex, expectedCount);
            successfulRun = routed;
          } catch (error) {
            lastError = error;
          }
        }

        if (!batch) throw lastError || new Error(`第 ${startIndex / QUESTION_BATCH_SIZE + 1} 批題目生成失敗`);
        generatedQuestions.push(...batch);
        batchAudit.push({
          start: startIndex + 1,
          end: startIndex + batch.length,
          count: batch.length,
          priorQuestionCountInPrompt: startIndex,
          provider: successfulRun?.provider || null,
          model: successfulRun?.model || null
        });
      }

      const dongtian = normalizeResult({ ...plan, questions: generatedQuestions }, creatorLevel);
      if (dongtian.questions.length !== plan.questionCount) {
        throw new Error(`洞天規劃 ${plan.questionCount} 題，但完成後只有 ${dongtian.questions.length} 題`);
      }

      const checked = await reviewAndRepairGeneratedDongtian(dongtian);
      const doubleCheck = checked.doubleCheck;
      if (!doubleCheck.review.passed) {
        console.warn('[Dongtian API] quality review rejected cave', {
          initial: checked.initialDoubleCheck.review,
          final: doubleCheck.review,
          repairs: checked.repairs,
          blocked: checked.blocked || null
        });
        return res.status(422).json({
          error: '洞天品質複核未通過，已嘗試重新審核或修復可辨認的錯題；本次不予建立。',
          doubleCheck: doubleCheck.review,
          initialDoubleCheck: checked.initialDoubleCheck.review,
          repairAttempts: checked.repairs,
          reasonCode: checked.blocked || 'quality_review'
        });
      }
      res.json({
        dongtian: checked.dongtian,
        generationPlan: {
          questionAmount,
          questionCount: plan.questionCount,
          questionStructure: plan.questionStructure
        },
        planningProvider: planningRun.provider,
        planningModel: planningRun.model,
        batches: batchAudit,
        doubleCheck: doubleCheck.review,
        doubleCheckProvider: doubleCheck.provider,
        doubleCheckModel: doubleCheck.model,
        repairAttempts: checked.repairs
      });
    } catch (error) {
      console.error('[Dongtian API]', error);
      res.status(500).json({ error: error?.message || '洞天生成失敗' });
    }

  });
};

module.exports.__test = { LEVELS, MIN_QUESTIONS, QUESTION_BATCH_SIZE, QUESTION_COUNT_CHOICES, QUESTION_AMOUNT_PRESETS, normalizeLevel, normalizeDifficulty, normalizeQuestionAmount, allowedQuestionCounts, normalizePlannedQuestionCount, normalizeDongtianPlan, normalizeQuestionBatch, normalizeResult, buildPrompt, buildPlanningPrompt, buildQuestionBatchPrompt, validateImages, normalizeQuestionSnapshot, buildQuestionReviewPrompt, normalizeQuestionReview, buildRevisionPrompt, buildRevisionValidationPrompt, normalizeStandaloneQuestion, normalizeRevisionValidation, normalizeDongtianDoubleCheck, buildDongtianDoubleCheckPrompt, verifyGeneratedDongtian, reviewAndRepairGeneratedDongtian };
