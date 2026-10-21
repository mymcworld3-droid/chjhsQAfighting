const Growth = require('./public/cultivation/nascent-growth.js');
'use strict';
const crypto = require('node:crypto');
const aiRouter = require('./ai-router');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { questionQualityIssue, removeUnstableOptionLabels } = require('./question-quality.cjs');
const { recordEvent } = require('./public/cultivation/quest-rules.js');
const rules = require('./public/cultivation/opportunity-rules.js');
const Knowledge = require('./public/cultivation/knowledge-points.js');
const { answerKey } = require('./question-answer-integrity.cjs');
const { QUESTION_PRESENTATION_RULES, QUESTION_RELIABILITY_RULES, subjectReliabilityPrompt } = require('./quiz-answer-prompt.cjs');
const RUNS = 'opportunityRuns', STATES = 'opportunityStates', TTL = 24 * 60 * 60 * 1000;
const fail = (message, status = 409, details = {}) => Object.assign(new Error(message), { status, publicReason:message, ...details });
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const clean = (v, n = 600) => String(v || '').trim().slice(0, n);

function packFail(message, check, questionId) {
  return fail(message,502,{code:'opportunity-'+check,stage:'validation',...(questionId ? {questionId} : {})});
}
function diagnostic(error, stage = 'request') {
  if (error?.opportunityDiagnostic) return error.opportunityDiagnostic;
  stage = error?.stage || stage;
  let code = error?.code?.startsWith?.('opportunity-') ? error.code : 'opportunity-unavailable';
  let reason = error?.publicReason || '機緣服務暫時無法完成，請稍後重試';
  let retryable = ![400,401,403,409,429].includes(error?.status);
  if (error?.publicReason && code === 'opportunity-unavailable') {
    code = ({400:'opportunity-invalid-request',401:'opportunity-auth',403:'opportunity-permission',404:'opportunity-not-found',429:'opportunity-rate-limit'})[error.status] ||
      (error.status === 409 ? 'opportunity-state-changed' : code);
  }
  if (!error?.publicReason) {
    const attempts = error?.attempts || [];
    if (error?.name === 'AbortError' || /timeout|逾時/i.test(error?.message || '') || attempts.some(a => /timeout/.test(a.code || ''))) {
      code = 'opportunity-timeout'; reason = stage === 'storage' ? '儲存機緣進度逾時，請重試展卷' : '長文生成或複核逾時，請稍後重試';
    } else if (error?.code === 'refinery-ai-config') {
      code = 'opportunity-provider-config'; reason = '出題服務尚未完成設定，請回報管理員'; retryable = false;
    } else if (/quota|resource-exhausted/i.test(error?.code || '') || /D1 quota/i.test(error?.message || '') ||
        attempts.some(a => a.httpStatus === 429)) {
      code = 'opportunity-quota'; reason = '資料庫或出題服務用量暫時受限，請稍後重試';
    } else if (stage === 'generation' || stage === 'review') {
      code = 'opportunity-provider'; reason = '出題服務暫時無法回傳完整內容，請稍後重試';
    } else if (stage === 'storage') {
      code = 'opportunity-storage'; reason = '機緣已生成，但儲存進度暫時失敗，請重試展卷';
    }
  }
  return {code,stage:error?.stage || stage,reason,retryable,...(error?.questionId ? {questionId:error.questionId} : {})};
}
function articleLimits(target) {
  if (Knowledge.subject(target.subject) === '英文') return {unit:'英文單字',min:250,max:550};
  return /國小/.test(target.level) ? {unit:'非空白字元',min:400,max:750}
    : /國中/.test(target.level) ? {unit:'非空白字元',min:650,max:1200} : {unit:'非空白字元',min:850,max:1600};
}
function normalizePack(raw, target) {
  if (!raw || typeof raw !== 'object') throw packFail('機緣題組格式不完整','pack-format');
  const title = clean(raw.title,80), paragraphs = raw.paragraphs;
  if (!title || !Array.isArray(paragraphs) || paragraphs.length < 4 || paragraphs.length > 10) throw packFail('長文需要四至十個完整段落','paragraph-count');
  const article = paragraphs.map((p,i) => ({id:`P${i+1}`,text:clean(p?.text ?? p,1800)}));
  if (article.some(p => p.text.length < 35 || /<\/?(?:script|iframe|img)\b/i.test(p.text))) throw packFail('長文段落無效','paragraph-format');
  if (new Set(article.map(p => rules.signature(p.text))).size !== article.length) throw packFail('長文不能用重複段落充字數','duplicate-paragraph');
  const limits = articleLimits(target), body = article.map(p => p.text).join(' ');
  const length = limits.unit === '英文單字' ? (body.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || []).length : body.replace(/\s/g,'').length;
  // Keep the existing hard safety cap. The target range guides generation;
  // slightly overshooting its ideal length must not discard a valid pack.
  if (length < limits.min || body.replace(/\s/g,'').length > 6500) throw packFail(`共用文本長度不符合程度：至少需要 ${limits.min} ${limits.unit}，實際 ${length}，全文不得超過6500字元`,'article-length');
  if (!Array.isArray(raw.questions) || raw.questions.length !== 5) throw packFail('機緣洞天必須恰好五題','question-count');
  const stems = new Set();
  const questions = raw.questions.map((q,i) => {
    const id = `Q${i+1}`;
    if (q?.skill !== rules.SKILLS[i]) throw packFail('題組認知層次或題序不完整','skill-order',id);
    const stem = clean(q.q,600), correct = clean(q.correct,350), wrong = (Array.isArray(q.wrong) ? q.wrong : []).map(v => clean(v,350));
    const exp = removeUnstableOptionLabels(clean(q.exp,1800));
    const evidence = (Array.isArray(q.evidence) ? q.evidence : []).map(e => ({paragraph:clean(e?.paragraph,4),quote:clean(e?.quote,500)}));
    if (stem.length < 12 || !correct || wrong.length !== 3 || wrong.some(v => !v) || exp.length < 60 || !clean(q.concept,100)) throw packFail('題目、選項或解析不完整','question-format',id);
    const key = rules.signature(stem).replace(/\d+/g,'#');
    if (stems.has(key) || new Set([correct,...wrong].map(answerKey)).size !== 4) throw packFail('題目或選項重複','duplicate-choice',id);
    stems.add(key);
    if (!evidence.length || evidence.length > 4 || evidence.some(e => e.quote.length < 8 || !article.find(p => p.id === e.paragraph)?.text.includes(e.quote))) throw packFail('解析缺少可核對的文本依據','evidence',id);
    if (['integrate','evaluate'].includes(q.skill) && new Set(evidence.map(e => e.paragraph)).size < 2) throw packFail('整合與評估題必須引用不同段落','cross-paragraph-evidence',id);
    const issue = questionQualityIssue({q:stem,correct,wrong,exp});
    if (issue) throw packFail(issue,'question-quality',id);
    try { Knowledge.assertLabel(q,target.subject); }
    catch (_) { throw packFail('題目缺少指定科目的有效知識點標記','knowledge-label',id); }
    return {id,q:stem,correct,wrong,exp,skill:q.skill,concept:clean(q.concept,100),evidence,...Knowledge.metadata(q,target.subject)};
  });
  const fingerprint = hash(rules.signature(article.map(p => p.text).join('')));
  return {title,paragraphs:article,questions,fingerprint,target};
}
function generationPrompt(target, history, repair = '') {
  const limits = articleLimits(target);
  const points = Knowledge.points(target.subject), name = Knowledge.subject(target.subject);
  const label = points.length ? [{subject:name,id:'從本科固定清單選取',name:'對應知識點名稱'}] : [];
  const questions = rules.SKILLS.map((skill,i) => ({id:`Q${i+1}`,skill,concept:'實際考點',q:'完整題目，不含選項標記',
    correct:'唯一正解內容',wrong:['錯誤內容一','錯誤內容二','錯誤內容三'],exp:'至少80中文字的解析，說明原文依據與判斷理由',
    knowledge_points:label,evidence:[{paragraph:'P1',quote:'逐字引用P1中的連續原文'},
      ...(['integrate','evaluate'].includes(skill) ? [{paragraph:'P3',quote:'逐字引用P3中的連續原文'}] : [])]}));
  const schema = {title:'文本標題',paragraphs:[1,2,3,4].map(i => ({id:`P${i}`,text:`第${i}段完整原文`})),questions};
  return `你是台灣課綱素養題編寫者。生成「機緣洞天」：一篇原創、連貫、有充足資訊的長文，五題共用全文。\n` +
    `嚴格範圍=${JSON.stringify(target)}。學科、選定單元與細項是真正考點；不得只把章節名貼進一般閱讀題，不得超綱。全文只計正文，需要${limits.min}至${limits.max}${limits.unit}，寫完先自行計數。` +
    Knowledge.promptFor(target.subject) + '\n' + QUESTION_PRESENTATION_RULES + '\n' +
    QUESTION_RELIABILITY_RULES + '\n' + subjectReliabilityPrompt(target.subject,{examples:false}) + '\n' +
    `文章4至10段，用P1、P2依序編號，包含情境、觀察、資料或因果；不依賴附圖、不重複段落。修仙情境不能妨礙單元理解。` +
    `五題固定依序Q1 retrieve、Q2 integrate、Q3 infer、Q4 apply、Q5 evaluate。每題須依本文作答，彼此獨立、不洩漏其他題答案。` +
    `每題四個不同選項、唯一正解、至少80中文字解析及有效knowledge_points。Q2整合比較與Q5評估判斷的evidence各至少兩筆，必須來自兩個不同段落；其他題至少一筆。` +
    `每筆evidence須含實際存在的段落ID及連續逐字quote，不加省略號、不改寫；quote至少8字元，且完整存在於該段原文。` +
    `近期文章與考點=${JSON.stringify(history.slice(-8))}。避免相同情境、資料與推理骨架，不能只換數字或人名。${repair ? '\n上次未通過原因：'+repair : ''}\n` +
    `只輸出以下JSON結構，保留全部五題、各自技能、knowledge_points與引文數量；替換示意文字，不得省略欄位：\n${JSON.stringify(schema)}`;
}
async function generatePack(target, history, generate = aiRouter.generateJSON, {now = Date.now,budgetMs = 75000} = {}) {
  let issue = '';
  const deadline = now()+budgetMs, failures = [];
  async function call(prompt, stage) {
    const remaining = deadline-now();
    if (remaining <= 0) throw fail('機緣洞天生成逾時',504,{code:'opportunity-timeout',stage});
    const timeoutMs = Math.min(stage === 'generation' ? 45000 : 20000,remaining);
    let timer;
    try { return await Promise.race([generate(prompt,{timeoutMs}),new Promise((_,reject) => {
      timer = setTimeout(() => reject(fail('機緣洞天生成逾時',504,{code:'opportunity-timeout',stage})),timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let stage = 'generation';
    try {
      const result = await call(generationPrompt(target,history,issue),stage);
      stage = 'validation';
      const pack = normalizePack(result.data,target);
      if (history.some(h => h.fingerprint === pack.fingerprint || rules.signature(h.title) === rules.signature(pack.title))) throw packFail('新文章與近期機緣重複','duplicate-article');
      stage = 'review';
      const example = {scopeValid:true,passageValid:true,reason:'審核理由',questions:pack.questions.map(q => ({id:q.id,valid:true,correct:'自行求出的正解內容'}))};
      const review = await call(`獨立審核以下素養題組，從原文自行解題，不要盲信標示正解。驗證範圍、唯一正解、逐字原文依據、解析、跨題洩題與年級適當性。Q2與Q5必須各引用兩段不同原文。正負號、小數點、分數線不可省略；判斷每個wrong是否確實錯誤。範圍=${JSON.stringify(target)}\n題組=${JSON.stringify(pack)}\n只輸出JSON：${JSON.stringify(example)}。questions必須涵蓋Q1至Q5各一次；每題重新求解並將完整正解內容填入correct。不合格應valid:false。`,stage);
      const r = review.data;
      if (r?.scopeValid !== true || r?.passageValid !== true || !Array.isArray(r.questions) || r.questions.length !== 5 ||
          pack.questions.some(q => r.questions.filter(v => v.id === q.id && v.valid === true && answerKey(v.correct) === answerKey(q.correct)).length !== 1)) {
        throw fail('獨立複核未通過：範圍、題目或答案未獲確認',502,{code:'opportunity-review-rejected',stage});
      }
      return pack;
    } catch (error) {
      const failure = {...diagnostic(error,stage),attempt:attempt+1};
      failures.push(failure); issue = (failure.questionId ? failure.questionId+'：' : '')+failure.reason;
      if (!failure.retryable || error.status === 504 || attempt === 1) {
        const title = failure.stage === 'validation' ? '機緣題組未通過品質檢查' : failure.stage === 'review' ? '機緣題組複核未完成' : '機緣內容暫時無法生成';
        const result = fail(title+'，已保留原本問道進度：'+issue,error.status === 504 ? 504 : 502);
        result.opportunityDiagnostic = {...failure,attempts:failures}; throw result;
      }
    }
  }
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
      ...Knowledge.metadata(q,run.pack.target.subject),
      ...(Number.isInteger(run.answers[i]) ? { feedback: feedback(q, run.answers[i]) } : {}) })),
    answered: run.answers.length, ...(run.reward ? { reward: run.reward } : {}) };
}
function rewardFor(run, player) {
  const correct = run.questions.filter((q, i) => q.answer === run.answers[i]).length;
  const score = Math.max(0, Number(player.stats?.totalScore) || 0), training = player.cultivationTraining || {}, type = training.equippedCore?.type;
  const soul = correct > 0 ? Growth.cultivation(player,'cave') : 0;
  return { correct, total: 5, goldAdded: 50 + 20 * correct, cultivationAdded: correct + soul, soulCultivationAdded: soul, spiritAdded: 0 };
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
      totalScore: Math.max(0, Number(player.stats?.totalScore) || 0) + reward.cultivationAdded };
    const knowledge = run.questions.reduce((map,q,i) => Knowledge.record(map,q,run.answers[i]===q.answer),player.stats?.knowledgePointMapV1 || {});
    tx.update(userRef, { 'stats.gold': balances.gold, 'stats.totalScore': balances.totalScore,
      'stats.knowledgePointMapV1':knowledge,
      questProgress: recordEvent(player.questProgress, 'dongtian') });
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
    } catch (e) {
      const detail = {...diagnostic(e),requestId:/^[A-Za-z0-9_-]{12,80}$/.test(String(req.body?.requestId || '')) ? req.body.requestId : crypto.randomUUID()};
      if (!e.status || e.status >= 500) logger.warn('[Opportunity]', detail);
      return res.status(e.status || 503).json({ok:false,error:e.publicReason || detail.reason,diagnostic:detail});
    }
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
          try { return await startRun(db, uid, requestId, pack, scope, now()); }
          catch (error) { error.stage ||= 'storage'; throw error; }
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
module.exports.__test = { RUNS, STATES, normalizePack, generationPrompt, generatePack, articleLimits, diagnostic, createGenerator, makeQuestions, publicRun, rewardFor, currentRun, startRun, updateRun, reportQuestion, createHandlers };
