'use strict';
const crypto = require('node:crypto');
const aiRouter = require('./ai-router');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { questionQualityIssue, removeUnstableOptionLabels } = require('./question-quality.cjs');
const { recordEvent } = require('./public/cultivation/quest-rules.js');
const rules = require('./public/cultivation/opportunity-rules.js');
const RUNS = 'opportunityRuns', STATES = 'opportunityStates', TTL = 24 * 60 * 60 * 1000;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const clean = (v, n = 600) => String(v || '').trim().slice(0, n);

function normalizePack(raw, target) {
  if (!raw || typeof raw !== 'object') throw fail('機緣題組格式不完整', 502);
  const title = clean(raw.title, 80), paragraphs = raw.paragraphs;
  if (!title || !Array.isArray(paragraphs) || paragraphs.length < 4 || paragraphs.length > 10) throw fail('長文需要四至十個完整段落', 502);
  const article = paragraphs.map((p, i) => ({ id: `P${i + 1}`, text: clean(p?.text ?? p, 1800) }));
  if (article.some(p => p.text.length < 35 || /<\/?(?:script|iframe|img)\b/i.test(p.text))) throw fail('長文段落無效', 502);
  if (new Set(article.map(p => rules.signature(p.text))).size !== article.length) throw fail('長文不能用重複段落充字數', 502);
  const length = article.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  const minimum = target.subject === '英文' ? 900 : /國小/.test(target.level) ? 400 : /國中/.test(target.level) ? 650 : 850;
  if (length < minimum || length > 6500) throw fail('共用文本長度不符合程度', 502);
  if (!Array.isArray(raw.questions) || raw.questions.length !== 5) throw fail('機緣洞天必須恰好五題', 502);
  const stems = new Set();
  const questions = raw.questions.map((q, i) => {
    if (q.skill !== rules.SKILLS[i]) throw fail('題組認知層次或題序不完整', 502);
    const stem = clean(q.q, 600), correct = clean(q.correct, 350), wrong = (Array.isArray(q.wrong) ? q.wrong : []).map(v => clean(v, 350));
    const exp = removeUnstableOptionLabels(clean(q.exp, 1800));
    const evidence = (Array.isArray(q.evidence) ? q.evidence : []).map(e => ({ paragraph: clean(e?.paragraph, 4), quote: clean(e?.quote, 500) }));
    if (stem.length < 12 || !correct || wrong.length !== 3 || wrong.some(v => !v) || exp.length < 60 || !clean(q.concept, 100)) throw fail('題目、選項或解析不完整', 502);
    const key = rules.signature(stem).replace(/\d+/g, '#');
    if (stems.has(key) || new Set([correct, ...wrong].map(rules.signature)).size !== 4) throw fail('題目或選項重複', 502);
    stems.add(key);
    if (!evidence.length || evidence.length > 4 || evidence.some(e => e.quote.length < 8 || !article.find(p => p.id === e.paragraph)?.text.includes(e.quote))) throw fail('解析缺少可核對的文本依據', 502);
    if (['integrate', 'evaluate'].includes(q.skill) && new Set(evidence.map(e => e.paragraph)).size < 2) throw fail('整合與評估題必須引用不同段落', 502);
    const issue = questionQualityIssue({ q: stem, correct, wrong, exp });
    if (issue) throw fail(issue, 502);
    return { id: `Q${i + 1}`, q: stem, correct, wrong, exp, skill: q.skill, concept: clean(q.concept, 100), evidence };
  });
  const fingerprint = hash(rules.signature(article.map(p => p.text).join('')));
  return { title, paragraphs: article, questions, fingerprint, target };
}
function generationPrompt(target, history, repair = '') {
  return `你是台灣課綱素養題編寫者。生成「機緣洞天」：一篇原創、連貫、有充足資訊的長文，五題共用全文。\n` +
    `嚴格範圍=${JSON.stringify(target)}。學科、選定單元與細項是真正考點；不得只把章節名貼進一般閱讀題，不得超綱。國小400至750字、國中650至1200字、高中以上850至1600字；英文科使用該年級可讀的英文250至550 words。` +
    `文章4至10段，包含情境、觀察、資料、因果或不同觀點；不要依赖附圖。可以融入修仙世界，但概念與數據必須正確，不可讓故事妨礙理解。` +
    `五題依序技能=${JSON.stringify(rules.SKILLS)}，分別擷取、跨段整合、推論、應用、評估。每題都必須依本文才可作答，彼此獨立、不洩漏其他題答案。後兩題需結合單元知識，但本文仍是必要條件。` +
    `每題四個不重複選項，唯一正解，三個有合理迷思的錯誤選項。解析至少80中文字，提供推理步驟與錯誤選項原因；不能以選項字母或順序稱呼答案。` +
    `近期文章與考點=${JSON.stringify(history.slice(-8))}。避免相同情境、資料與推理骨架，不能只換數字或人名。${repair ? '\n上次未通過原因：' + repair : ''}\n` +
    `只輸出JSON：{"title":"文本標題","paragraphs":["第一段全文","第二段全文","第三段全文","第四段全文"],"questions":[{"skill":"retrieve","concept":"選定範圍的具體考點","q":"題目","correct":"正解內容","wrong":["錯誤1","錯誤2","錯誤3"],"exp":"完整解析","evidence":[{"paragraph":"P1","quote":"該段原文逐字引用"}]}]}。questions必須5個且技能順序完全符合規格。`;
}
async function generatePack(target, history, generate = aiRouter.generateJSON) {
  let issue = '';
  const deadline = Date.now() + 75000;
  async function call(prompt) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw fail('機緣洞天生成逾時', 504);
    let timer;
    try { return await Promise.race([generate(prompt, { timeoutMs: Math.min(22000, remaining) }), new Promise((_, reject) => { timer = setTimeout(() => reject(fail('機緣洞天生成逾時', 504)), remaining); })]); }
    finally { clearTimeout(timer); }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await call(generationPrompt(target, history, issue));
      const pack = normalizePack(result.data, target);
      if (history.some(h => h.fingerprint === pack.fingerprint || rules.signature(h.title) === rules.signature(pack.title))) throw fail('新文章與近期機緣重複', 502);
      const review = await call(`獨立審核以下素養題組，從原文自行解題，不要盲信標示正解。严格驗證每題是否真的使用原文、唯一正解、無錯誤、依據逐字存在、解析成立、沒有互相洩題，且每題具體考查指定學科單元。評估推論是否過度、數據是否矛盾、年級是否適當。範圍=${JSON.stringify(target)}\n題組=${JSON.stringify(pack)}\n只輸出JSON：{"scopeValid":true,"passageValid":true,"reason":"審核理由","questions":[{"id":"Q1","valid":true,"correct":"自行求出的正解內容"}]}，questions必須涵蓋Q1至Q5。不合格應valid:false。`);
      const r = review.data;
      if (r?.scopeValid !== true || r?.passageValid !== true || !Array.isArray(r.questions) || r.questions.length !== 5 ||
          pack.questions.some(q => r.questions.filter(v => v.id === q.id && v.valid === true && rules.signature(v.correct) === rules.signature(q.correct)).length !== 1)) {
        throw fail(clean(r?.reason, 400) || '獨立複核未通過', 502);
      }
      return pack;
    } catch (e) { issue = clean(e.message, 400); if (e.status === 504) throw e; }
  }
  throw fail('機緣題組未通過品質檢查，已保留原本問道進度', 502);
}
// Bounded cache and single-flight generation prevent simultaneous users regenerating the same scope.
function createGenerator(generate = aiRouter.generateJSON, now = Date.now) {
  const cache = new Map(), pending = new Map();
  return async (target, history) => {
    const key = hash(JSON.stringify(target)), existing = cache.get(key);
    if (existing && existing.until > now() && !history.some(h => h.fingerprint === existing.pack.fingerprint)) return existing.pack;
    if (!pending.has(key)) {
      if (pending.size >= 3) throw fail('機緣洞天正在凝成，請稍後繼續問道', 503);
      const task = generatePack(target, history, generate).then(pack => {
        cache.delete(key); cache.set(key, { pack, until: now() + 8 * 60 * 60 * 1000 });
        while (cache.size > 64) cache.delete(cache.keys().next().value);
        return pack;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
    }
    const pack = await pending.get(key);
    if (history.some(h => h.fingerprint === pack.fingerprint)) throw fail('尚未凝成新的機緣文本，請繼續問道', 503);
    return pack;
  };
}
function makeQuestions(pack, random = Math.random) {
  return pack.questions.map(q => {
    const options = [q.correct, ...q.wrong];
    for (let i = 3; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
    return { ...q, options, answer: options.indexOf(q.correct) };
  });
}
function feedback(q, answer) {
  return { selected: answer, correct: q.answer, isCorrect: answer === q.answer, exp: q.exp, evidence: q.evidence };
}
function publicRun(run) {
  return { id: run.id, status: run.status, title: run.pack.title, target: run.pack.target, paragraphs: run.pack.paragraphs,
    scope: run.scope, createdAt: run.createdAt, expiresAt: run.expiresAt,
    questions: run.questions.map((q, i) => ({ id: q.id, q: q.q, options: q.options, skill: q.skill,
      ...(Number.isInteger(run.answers[i]) ? { feedback: feedback(q, run.answers[i]) } : {}) })),
    answered: run.answers.length, ...(run.reward ? { reward: run.reward } : {}) };
}
function rewardFor(run, player) {
  const correct = run.questions.filter((q, i) => q.answer === run.answers[i]).length;
  const score = Math.max(0, Number(player.stats?.totalScore) || 0), training = player.cultivationTraining || {}, type = training.equippedCore?.type;
  const soul = score >= 68 && training.coreEnabled !== false && type && correct > 0
    ? Math.min(10, Math.max(0, Math.floor(Number(player.nascentSoulTree?.paths?.[type]?.nodes?.rightFarBottom) || 0))) : 0;
  return { correct, total: 5, goldAdded: 50 + 20 * correct, cultivationAdded: correct + soul, soulCultivationAdded: soul, spiritAdded: score >= 68 ? correct : 0 };
}
async function currentRun(db, uid, now = Date.now()) {
  const state = await db.collection(STATES).doc(uid).get();
  if (!state.exists || !state.data()?.active) return null;
  const snap = await db.collection(RUNS).doc(state.data().active).get();
  const run = snap.exists ? snap.data() : null;
  return run?.uid === uid && ['active', 'ready'].includes(run.status) && run.expiresAt > now ? run : null;
}
async function startRun(db, uid, requestId, pack, scope, now = Date.now()) {
  const id = hash(uid + ':' + requestId), stateRef = db.collection(STATES).doc(uid), runRef = db.collection(RUNS).doc(id);
  return db.runTransaction(async tx => {
    const [stateSnap, oldSnap, userSnap] = await Promise.all([tx.get(stateRef), tx.get(runRef), tx.get(db.collection('users').doc(uid))]);
    const user = userSnap.data() || {};
    if (!userSnap.exists || rules.scopeKey(user) !== scope) throw fail('修習範圍已變更，請繼續原本問道');
    if (oldSnap.exists) {
      const old = oldSnap.data();
      if (!['active', 'ready'].includes(old.status) || old.expiresAt <= now) throw fail('此機緣已完成或結束');
      return old;
    }
    const state = stateSnap.data() || {};
    if (state.active) {
      const prior = await tx.get(db.collection(RUNS).doc(state.active));
      if (prior.exists && prior.data().expiresAt > now && ['active', 'ready'].includes(prior.data().status)) return prior.data();
    }
    const history = (Array.isArray(state.history) ? state.history : []).slice(-23);
    if (history.some(h => h.fingerprint === pack.fingerprint)) throw fail('這篇機緣文本已參悟過');
    const run = { id, uid, status: 'active', scope, pack, questions: makeQuestions(pack), answers: [], createdAt: now, expiresAt: now + TTL };
    history.push({ fingerprint: pack.fingerprint, title: pack.title, path: pack.target.path, detail: pack.target.detail, at: now });
    tx.create(runRef, run); tx.set(stateRef, { active: id, history }, { merge: true });
    return run;
  });
}
async function updateRun(db, uid, id, action, body, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw fail('機緣識別碼無效', 400);
  const runRef = db.collection(RUNS).doc(id), stateRef = db.collection(STATES).doc(uid), userRef = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists || runSnap.data().uid !== uid) throw fail('找不到此機緣洞天', 404);
    const run = runSnap.data();
    if (action === 'settle' && run.status === 'completed') return { run: publicRun(run), applied: false };
    if (run.expiresAt <= now || !['active', 'ready'].includes(run.status)) throw fail('機緣已結束，請繼續問道');
    if (action === 'answer') {
      const index = body.index, selected = body.selected;
      if (!Number.isInteger(index) || index < 0 || index > 4 || !Number.isInteger(selected) || selected < 0 || selected > 3) throw fail('作答格式無效', 400);
      if (index > run.answers.length) throw fail('請依序完成五題');
      if (index < run.answers.length) {
        if (run.answers[index] !== selected) throw fail('此題已作答，不能修改答案');
        return { run: publicRun(run), feedback: feedback(run.questions[index], selected) };
      }
      run.answers.push(selected); if (run.answers.length === 5) run.status = 'ready';
      tx.update(runRef, { answers: run.answers, status: run.status });
      return { run: publicRun(run), feedback: feedback(run.questions[index], selected) };
    }
    const stateSnap = await tx.get(stateRef);
    if (action === 'abandon') {
      run.status = 'abandoned'; tx.update(runRef, { status: run.status });
      if (stateSnap.data()?.active === id) tx.set(stateRef, { active: null }, { merge: true });
      return { run: publicRun(run) };
    }
    if (action !== 'settle' || run.answers.length !== 5) throw fail('請先完成全部五題');
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw fail('玩家資料不存在', 404);
    const player = userSnap.data(), reward = rewardFor(run, player);
    const balances = { gold: Math.max(0, Number(player.stats?.gold) || 0) + reward.goldAdded,
      totalScore: Math.max(0, Number(player.stats?.totalScore) || 0) + reward.cultivationAdded,
      nascentSoulSpirit: Math.max(0, Number(player.stats?.nascentSoulSpirit) || 0) + reward.spiritAdded };
    tx.update(userRef, { 'stats.gold': balances.gold, 'stats.totalScore': balances.totalScore,
      'stats.nascentSoulSpirit': balances.nascentSoulSpirit, questProgress: recordEvent(player.questProgress, 'dongtian') });
    run.status = 'completed'; run.reward = { ...reward, balances };
    tx.update(runRef, { status: run.status, reward: run.reward, completedAt: now });
    if (stateSnap.data()?.active === id) tx.set(stateRef, { active: null }, { merge: true });
    return { run: publicRun(run), applied: true };
  });
}
async function reportQuestion(db, uid, body, now = Date.now()) {
  const id = String(body.runId || ''), index = body.index, reason = clean(body.reason, 1200);
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isInteger(index) || index < 0 || index > 4 || reason.length < 5) throw fail('請說明題目問題，至少五個字', 400);
  const snap = await db.collection(RUNS).doc(id).get(), run = snap.data();
  if (!snap.exists || run?.uid !== uid) throw fail('找不到此機緣洞天', 404);
  if (!Number.isInteger(run.answers[index])) throw fail('請先參閱本題解析再回報');
  const reportId = hash(uid + ':' + id + ':' + index), ref = db.collection('opportunityReports').doc(reportId);
  await db.runTransaction(async tx => {
    const old = await tx.get(ref);
    tx.set(ref, { uid, runId: id, index, reason, title: run.pack.title, target: run.pack.target,
      paragraphs: run.pack.paragraphs, question: run.questions[index], selected: run.answers[index],
      status: 'pending', createdAt: old.data()?.createdAt || now, updatedAt: now });
  });
  return { reportId, saved: true };
}
function createHandlers({ resolveA = () => playerRepository.resolve(), generate = createGenerator(), now = Date.now, logger = console } = {}) {
  const pending = new Map(), limits = new Map();
  const route = handler => async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
      if (!bearer) throw fail('請先登入後再參悟機緣', 401);
      const a = resolveA(); let identity;
      try { identity = await a.auth.verifyIdToken(bearer[1], true); } catch (_) { throw fail('登入狀態已失效', 401); }
      if (!identity?.uid || identity.aud !== PROJECT_IDS.A || identity.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) throw fail('登入身分驗證失敗', 401);
      return res.json({ ok: true, ...await handler(req, a.db, identity.uid) });
    } catch (e) { if (!e.status || e.status >= 500) logger.warn('[Opportunity]', e.message); return res.status(e.status || 503).json({ ok: false, error: e.status ? e.message : '機緣洞天連線尚未完成，請稍後重試' }); }
  };
  return {
    current: route(async (_req, db, uid) => ({ run: (r => r ? publicRun(r) : null)(await currentRun(db, uid, now())) })),
    start: route(async (req, db, uid) => {
      const requestId = req.body?.requestId;
      if (!/^[A-Za-z0-9_-]{12,80}$/.test(String(requestId || ''))) throw fail('機緣請求識別碼無效', 400);
      const trustedUser = await db.collection('users').doc(uid).get();
      if (!trustedUser.exists) throw fail('玩家資料不存在', 404);
      const trustedScope = rules.scopeKey(trustedUser.data());
      if (req.body.scope !== trustedScope) throw fail('修習範圍已變更，請繼續原本問道');
      const active = await currentRun(db, uid, now());
      if (active?.scope === trustedScope) return { run: publicRun(active) };
      if (active) await updateRun(db, uid, active.id, 'abandon', {}, now());
      if (!pending.has(uid)) {
        const task = (async () => {
          const [userSnap, stateSnap] = await Promise.all([db.collection('users').doc(uid).get(), db.collection(STATES).doc(uid).get()]);
          if (!userSnap.exists) throw fail('玩家資料不存在', 404);
          const player = userSnap.data(), scope = rules.scopeKey(player), normalized = rules.normalizeScope(player);
          if (req.body.scope !== scope) throw fail('修習範圍已變更，請繼續原本問道');
          const history = stateSnap.data()?.history || [];
          const recent = history.filter(h => h.at > now() - 60 * 60 * 1000);
          if (recent.length >= 8) throw fail('已參悟多次機緣，先繼續問道再尋新篇', 429);
          // Failed generations are bounded too. Entries expire instead of growing forever.
          for (const [key, value] of limits) if (value.until <= now()) limits.delete(key);
          if (!limits.has(uid) && limits.size >= 2000) throw fail('機緣服務繁忙，請繼續問道', 503);
          const limit = limits.get(uid) || { count: 0, until: now() + 60 * 60 * 1000 };
          if (limit.count >= 12) throw fail('機緣凝成較頻繁，請稍後再試', 429);
          limit.count++; limits.set(uid, limit);
          const target = rules.chooseTarget(normalized, history);
          const pack = await generate(target, history);
          return startRun(db, uid, requestId, pack, scope, now());
        })().finally(() => pending.delete(uid));
        pending.set(uid, task);
      }
      return { run: publicRun(await pending.get(uid)) };
    }),
    answer: route(async (req, db, uid) => updateRun(db, uid, req.body?.runId, 'answer', req.body, now())),
    settle: route(async (req, db, uid) => updateRun(db, uid, req.body?.runId, 'settle', req.body, now())),
    abandon: route(async (req, db, uid) => updateRun(db, uid, req.body?.runId, 'abandon', req.body, now())),
    report: route(async (req, db, uid) => reportQuestion(db, uid, req.body || {}, now()))
  };
}
module.exports = app => {
  const h = createHandlers();
  app.get('/api/opportunity/current', h.current);
  for (const action of ['start', 'answer', 'settle', 'abandon', 'report']) app.post('/api/opportunity/' + action, h[action]);
};
module.exports.__test = { RUNS, STATES, normalizePack, generationPrompt, generatePack, createGenerator, makeQuestions, publicRun, rewardFor, currentRun, startRun, updateRun, reportQuestion, createHandlers };
