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
const MAX_QUESTIONS = 30;

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

function buildPrompt(text, creatorLevel, imageCount) {
  return `
[任務]
你是「洞天」學習關卡設計師。請一次分析使用者提供的所有文字與 ${imageCount} 張圖片，建立一個完整、可依序遊玩的知識洞天。

[核心要求]
1. 先盡可能完整擷取素材中的「所有可獨立學習／考核的知識點」，不要只挑最顯眼的幾個。
2. 題目要覆蓋不同知識點，避免同義改寫、重複考同一概念。
3. 題量由素材資訊密度決定：通常每個核心知識點至少被有效考到一次；素材很少可 3–5 題，中等素材約 6–12 題，內容豐富可 13–30 題。總題數最多 ${MAX_QUESTIONS} 題。
4. questions 陣列順序就是玩家實際遊玩順序：先基礎辨識，再理解，再應用／整合；不要隨機排列。
5. 每題都是單選題，只有一個明確正確答案；wrong 必須剛好三個，且不能與 correct 重複。
6. 解析 exp 必須說明「為什麼正確」並在適當時指出其他選項錯在哪裡。
7. 請估計整個素材最適合的程度，只能從以下值選一個：${LEVELS.join('、')}。建立者目前程度是「${cleanText(creatorLevel, 30) || '未提供'}」，僅供參考，不要因此硬套程度。
8. difficulty 只能是 easy / medium / hard。subject 優先使用：國文、英文、數學、公民、歷史、地理、物理、化學、生物；跨多科或無法歸入單科時用「綜合」。
9. 洞天名稱要像修仙世界中的秘境名稱，簡短、有記憶點，並能暗示素材主題，例如「星軌算境」「細胞青蘿谷」，不要直接叫「XX測驗」。
10. id 依順序使用 DT-001、DT-002……；每題仍需保留自己的 difficulty 與 subject。

[使用者文字]
${cleanText(text, MAX_TEXT) || '（沒有額外文字，主要依圖片內容建立）'}

[輸出 JSON Only]
{
  "name": "洞天名稱",
  "level": "上述程度之一",
  "difficulty": "easy|medium|hard",
  "subject": "主要科目或綜合",
  "knowledgePoints": ["知識點1", "知識點2"],
  "coverageSummary": "簡短說明這組題目如何涵蓋素材",
  "questions": [
    {
      "id": "DT-001",
      "difficulty": "easy|medium|hard",
      "q": "題目",
      "correct": "正確選項",
      "wrong": ["錯誤選項", "錯誤選項", "錯誤選項"],
      "exp": "解析",
      "subject": "科目標籤"
    }
  ]
}
不要輸出 markdown，不要加入 JSON 以外的文字。`;
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
  const providers = aiRouter.buildProviders();
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
      return { data: JSON.parse(text), provider: provider.name, model: provider.model };
    } catch (error) {
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

  if (normalizedQuestions.length < 3) throw new Error('AI 產生的有效題目不足，請增加素材後重試');
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

module.exports = function registerDongtianApi(app) {
  app.post('/api/generate-dongtian', async (req, res) => {
    try {
      const text = cleanText(req.body?.text, MAX_TEXT);
      const creatorLevel = normalizeLevel(req.body?.creatorLevel, '國中一年級');
      const images = validateImages(req.body?.images);
      if (!text && !images.length) return res.status(400).json({ error: '請至少提供文字或一張圖片' });

      const prompt = buildPrompt(text, creatorLevel, images.length);
      const routed = await generateMultimodalJSON(prompt, images);
      const dongtian = normalizeResult(routed.data, creatorLevel);
      res.json({ dongtian, provider: routed.provider, model: routed.model });
    } catch (error) {
      console.error('[Dongtian API]', error);
      res.status(500).json({ error: error?.message || '洞天生成失敗' });
    }
  });
};

module.exports.__test = { LEVELS, normalizeLevel, normalizeDifficulty, normalizeResult, buildPrompt, validateImages };
