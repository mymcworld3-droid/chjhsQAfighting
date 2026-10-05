'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../public/cultivation/opportunity-rules.js');
const api = require('../opportunity-api.cjs').__test;
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const target = { subject: '數學', level: '國中一年級', path: '數學/七上/翰林/代數', detail: '一元一次方程式', topics: ['等量公理'], difficulty: 'medium' };
const player = () => ({ uid: 'u1', profile: { educationLevel: '高中職' }, gameSettings: { sourceMode: 'focused', difficulty: 'medium', focusedUnits: [{ path: target.path, detail: target.detail, sub_topics: target.topics }] }, stats: { gold: 20, totalScore: 30 } });
function rawPack(title = '青雲水庫手札') {
  const paragraphs = [
    '青雲水庫的管理人記下每日供水量，並提醒弟子先辨認未知數，再將同一天的進水與出水列成等式。',
    '第一組弟子觀察水位變化，發現開啟閘門後水量逐時減少，於是提出以一元一次方程式計算剩餘水量。',
    '第二組弟子記錄居民需求，將固定消耗與每戶用量分開，並強調資料不能混用不同時間與單位的數值。',
    '兩組交換紀錄後重新檢查條件，指出單一觀察不足以確定原因，決策必須同時比較用水需求與供水能力。'
  ].map((s, i) => s + `第${i + 1}段補充紀錄：` + '管理人要求所有計算皆保存單位，逐步說明每個等式的意義，最後以原始條件檢驗所得結果。'.repeat(4));
  return { title, paragraphs, questions: rules.SKILLS.map((skill, i) => ({ skill, concept: target.detail,
    q: ['管理人首先要求弟子辨認哪一項資訊？', '根據兩組紀錄，整理等式應注意哪些條件？', '從水量逐時減少可以合理推論什麼結論？', '若再增加用水戶數，應如何建立新的方程式？', '比較兩組觀察，哪一種決策理由最充分？'][i],
    correct: '依據原文核對未知數與單位', wrong: ['只比較數字，不需要單位', '忽略資料的測量時間', '不用原始條件檢查結果'],
    exp: '應先依照原文辨認未知數與每筆資料的單位，再將相同時段的資訊整理成等式，逐步求解並代回原始條件確認。只看數字、混用時間或省略驗算都會失去合理的判斷依據，因此不能作為正確的解題方法。',
    evidence: [{ paragraph: 'P1', quote: '先辨認未知數，再將同一天的進水與出水列成等式' }, ...(['integrate', 'evaluate'].includes(skill) ? [{ paragraph: 'P3', quote: '資料不能混用不同時間與單位的數值' }] : [])]
  })) };
}
function review(pack, valid = true) { return { data: { scopeValid: valid, passageValid: true, reason: valid ? '通過' : '未考查選定單元', questions: pack.questions.map((q, i) => ({ id: `Q${i + 1}`, valid, correct: q.correct })) } }; }
function fakeDb(initial = player()) {
  const docs = new Map([['users/u1', structuredClone(initial)]]); let queue = Promise.resolve();
  const snap = key => ({ exists: docs.has(key), data: () => structuredClone(docs.get(key)) });
  function merge(source, patch) {
    const result = structuredClone(source || {});
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'), leaf = parts.pop(); let current = result;
      for (const p of parts) current = current[p] ||= {};
      current[leaf] = structuredClone(value);
    }
    return result;
  }
  return { docs,
    collection(name) { return { doc(id) { const key = name + '/' + id; return { key, get: async () => snap(key) }; } }; },
    runTransaction(worker) {
      const result = queue.then(async () => {
        let writing = false; const writes = new Map();
        const tx = {
          get: async ref => { assert.equal(writing, false, 'Firestore reads precede writes'); return snap(ref.key); },
          create(ref, value) { writing = true; assert.ok(!docs.has(ref.key)); writes.set(ref.key, structuredClone(value)); },
          update(ref, value) { writing = true; assert.ok(docs.has(ref.key)); writes.set(ref.key, merge(docs.get(ref.key), value)); },
          set(ref, value, opts) { writing = true; writes.set(ref.key, opts?.merge ? merge(docs.get(ref.key), value) : structuredClone(value)); }
        };
        const output = await worker(tx); for (const [key, value] of writes) docs.set(key, value); return output;
      }); queue = result.catch(() => {}); return result;
    }
  };
}
const now = 1800000000000;
async function begin(db, requestId = 'test-request-001') { return api.startRun(db, 'u1', requestId, api.normalizePack(rawPack(), target), rules.scopeKey(db.docs.get('users/u1')), now); }
const response = () => ({ statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return body; } });

test('scope honors focused and comprehensive units, course level and canonical order', () => {
  const p = player(), s = rules.normalizeScope(p);
  assert.equal(s.units[0].level, '國中一年級'); assert.equal(rules.chooseTarget(s, [], () => 0).detail, target.detail);
  p.gameSettings.sourceMode = 'random'; p.gameSettings.comprehensiveUnits = [{ path: '英文/八上/文法', detail: '現在完成式' }];
  assert.equal(rules.chooseTarget(rules.normalizeScope(p), [], () => 0).subject, '英文');
  p.gameSettings.sourceMode = 'focused'; p.gameSettings.focusedUnits.push({ path: '英文/八上/文法', detail: '現在完成式' });
  const key = rules.scopeKey(p); p.gameSettings.focusedUnits.reverse(); assert.equal(rules.scopeKey(p), key);
  p.gameSettings.focusedUnits = []; assert.throws(() => rules.chooseTarget(rules.normalizeScope(p)), /儲存有效/);
});
test('bank scope stays in its selected subject and younger course overrides older profile', () => {
  const p = player(); p.gameSettings = { sourceMode: 'bank', source: '自然/八上/力學.json' };
  const t = rules.chooseTarget(rules.normalizeScope(p), [], () => 0);
  assert.equal(t.subject, '自然'); assert.equal(t.level, '國中二年級');
});
test('unit weighting reduces recent repetitions within the saved range', () => {
  const s = rules.normalizeScope(player()); s.units.push({ ...s.units[0], path: '數學/七上/幾何', detail: '幾何' });
  const history = Array.from({ length: 12 }, () => ({ path: s.units[0].path, detail: s.units[0].detail }));
  assert.equal(rules.chooseTarget(s, history, () => 0.15).detail, '幾何');
});
test('encounter intervals cover every integer from 20 through 30, including both endpoints', () => {
  const all = Array.from({ length: 11 }, (_, i) => rules.drawInterval(() => (i + .5) / 11));
  assert.deepEqual(all, Array.from({ length: 11 }, (_, i) => i + 20));
  assert.equal(rules.drawInterval(() => 0), 20); assert.equal(rules.drawInterval(() => .999999), 30);
  assert.equal(rules.drawInterval(() => -10), 20); assert.equal(rules.drawInterval(() => 2), 30);
});
function intervalStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), values };
}
test('minimum and maximum cycles become due on exactly the twentieth and thirtieth steps', () => {
  const randoms = [0, .999999], schedule = rules.createEncounterSchedule(intervalStorage(), () => randoms.shift());
  for (let i = 1; i < 20; i++) assert.equal(schedule.step('u1').due, false, 'not before step ' + i);
  assert.equal(schedule.step('u1').due, true);
  assert.equal(schedule.reset('u1').interval, 30);
  for (let i = 1; i < 30; i++) assert.equal(schedule.step('u1').due, false, 'not before step ' + i);
  assert.equal(schedule.step('u1').due, true);
});
test('remaining interval survives reload and different accounts keep independent progress', () => {
  const storage = intervalStorage(), first = rules.createEncounterSchedule(storage, () => 5.5 / 11);
  for (let i = 0; i < 3; i++) first.step('u1');
  assert.equal(first.peek('u1').remaining, 22);
  const reloaded = rules.createEncounterSchedule(storage, () => .999999);
  assert.equal(reloaded.peek('u1').interval, 25); assert.equal(reloaded.peek('u1').remaining, 22);
  assert.equal(reloaded.step('u2').remaining, 29); assert.equal(reloaded.peek('u1').remaining, 22);
  for (let i = 0; i < 21; i++) assert.equal(reloaded.step('u1').due, false);
  assert.equal(reloaded.step('u1').due, true);
});
test('saved legacy intervals below 20 are replaced, while compliant progress remains intact', () => {
  for (let old = 2; old < 20; old++) {
    const storage = intervalStorage();
    storage.setItem('qingyunOpportunityIntervalV2:u1', JSON.stringify({ version: 2, interval: old, remaining: 1, revision: 17 }));
    const schedule = rules.createEncounterSchedule(storage, () => 0);
    assert.equal(schedule.peek('u1').interval, 20); assert.equal(schedule.step('u1').remaining, 19);
    assert.equal(rules.createEncounterSchedule(storage, () => .999999).peek('u1').remaining, 19, 'updated countdown survives another reload');
  }
  for (let interval = 20; interval <= 30; interval++) {
    const storage = intervalStorage(), prior = { version: 2, interval, remaining: 1, revision: 17 };
    storage.setItem('qingyunOpportunityIntervalV2:u1', JSON.stringify(prior));
    const schedule = rules.createEncounterSchedule(storage, () => 0);
    assert.deepEqual(schedule.peek('u1'), prior); assert.equal(schedule.step('u1').due, true);
  }
});
test('due state is retained for retries, while corrupt or blocked storage remains usable', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const memory = rules.createEncounterSchedule(blocked, () => 0);
  for (let i = 0; i < 19; i++) assert.equal(memory.step('u1').due, false);
  assert.equal(memory.step('u1').due, true);
  assert.equal(memory.step('u1').remaining, 0, 'generation failure must not redraw a long interval');
  const storage = intervalStorage(); storage.setItem('qingyunOpportunityIntervalV2:u1', '{broken');
  const fresh = rules.createEncounterSchedule(storage, () => 0); assert.equal(fresh.step('u1').remaining, 19);
  storage.setItem('qingyunOpportunityIntervalV2:u2', JSON.stringify({ version: 2, interval: 1, remaining: -4, revision: 0 }));
  assert.equal(fresh.step('u2').remaining, 19);
  const stale = intervalStorage(), fallback = rules.createEncounterSchedule(stale, () => 0);
  fallback.step('u1'); stale.setItem = () => { throw Error('cannot write'); };
  for (let i = 0; i < 18; i++) assert.equal(fallback.step('u1').due, false);
  assert.equal(fallback.step('u1').due, true); assert.equal(fallback.peek('u1').remaining, 0, 'stale persisted state cannot erase memory progress');
});
test('browser counts each completed next only once, retains progress across scopes and counts during pending requests', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/opportunity-dongtian.js'), 'utf8');
  const start = source.indexOf('  window.maybeEncounterOpportunity =');
  const hook = source.slice(start, source.indexOf('    owner = account; inflight', start)) + '\nreturn true;\n};';
  const schedule = rules.createEncounterSchedule(intervalStorage(), () => 0), p = player(), rolled = new WeakSet();
  const context = vm.createContext({ window: { isOpportunityActive: () => false }, rolled, uid: () => 'u1', data: () => p, $: () => null,
    rules, schedule, inflight: false, restoring: false });
  vm.runInContext(hook, context);
  const first = {}; assert.equal(await context.window.maybeEncounterOpportunity({ quiz: first }), false);
  assert.equal(await context.window.maybeEncounterOpportunity({ quiz: first }), false); assert.equal(schedule.peek('u1').remaining, 19);
  p.gameSettings.focusedUnits[0].detail = '分數';
  for (let i = 0; i < 18; i++) assert.equal(await context.window.maybeEncounterOpportunity({ quiz: {} }), false);
  assert.equal(await context.window.maybeEncounterOpportunity({ quiz: {} }), true, 'scope changes keep the countdown');
  schedule.reset('u1'); context.inflight = true;
  assert.equal(await context.window.maybeEncounterOpportunity({ quiz: {} }), false); assert.equal(schedule.peek('u1').remaining, 19);
  for (let i = 0; i < 19; i++) assert.equal(await context.window.maybeEncounterOpportunity({ quiz: {} }), false);
  assert.equal(schedule.peek('u1').remaining, 0);
  context.inflight = false;
  assert.equal(await context.window.maybeEncounterOpportunity({ quiz: {} }), true, 'a due cycle retries after pending request finishes');
});
test('restoring a server-created encounter resets a due interval once after interrupted start', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/opportunity-dongtian.js'), 'utf8');
  const start = source.indexOf('  async function restore()');
  const restore = source.slice(start, source.indexOf('  function reconcile()', start));
  let random = 0, opens = 0;
  const schedule = rules.createEncounterSchedule(intervalStorage(), () => random), p = player();
  for (let i = 0; i < 20; i++) schedule.step('u1');
  random = 0.999;
  const context = vm.createContext({ window: { isOpportunityActive: () => false }, uid: () => 'u1', data: () => p, $: () => null,
    rules, schedule, inflight: false, restoring: false, restoredAccount: '', serial: 0,
    request: async () => ({ run: { scope: rules.scopeKey(p) } }), openRun: () => { opens++; }, console });
  vm.runInContext(restore + '\nthis.restoreCall = restore;', context);
  await context.restoreCall(); assert.equal(opens, 1); assert.equal(schedule.peek('u1').remaining, 30);
  context.restoredAccount = ''; random = 0;
  await context.restoreCall(); assert.equal(opens, 2); assert.equal(schedule.peek('u1').remaining, 30, 'resume does not reroll an already reset interval');
});
test('exactly five independent skills and verbatim passage evidence are required', () => {
  const p = api.normalizePack(rawPack(), target); assert.equal(p.questions.length, 5);
  for (const mutate of [
    r => r.questions.pop(), r => r.questions.push(r.questions[0]), r => r.questions[2].skill = 'retrieve',
    r => r.questions[0].wrong[0] = r.questions[0].correct,
    r => r.questions[0].evidence[0].quote = '並不存在於原文的證據',
    r => r.questions[1].evidence.pop(), r => r.paragraphs[1] = r.paragraphs[0],
    r => r.questions[4].q = r.questions[0].q
  ]) { const raw = rawPack(); mutate(raw); assert.throws(() => api.normalizePack(raw, target)); }
});
test('independent reviewer rejection regenerates, and permanently bad packs never reach play', async () => {
  const raw = rawPack(); let calls = 0;
  const result = await api.generatePack(target, [], async () => {
    calls++; return calls % 2 ? { data: raw } : review(raw, calls === 4);
  });
  assert.equal(result.title, raw.title); assert.equal(calls, 4);
  await assert.rejects(api.generatePack(target, [], async () => ({ data: { questions: [] } })), /品質檢查/);
});
test('matching-scope generation is shared and bounded cache cannot return already visited text', async () => {
  let calls = 0; const raw = rawPack();
  const generator = api.createGenerator(async () => { calls++; return calls % 2 ? { data: raw } : review(raw); }, () => now);
  const [a, b] = await Promise.all([generator(target, []), generator(target, [])]);
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(calls, 2);
  await generator(target, []); assert.equal(calls, 2);
  await assert.rejects(generator(target, [{ fingerprint: a.fingerprint, title: a.title }]), /品質檢查/);
});
test('public run hides every unanswered solution; stored answer order survives retry', async () => {
  const db = fakeDb(), run = await begin(db), publicBefore = api.publicRun(run);
  assert.equal(publicBefore.questions.length, 5);
  assert.ok(publicBefore.questions.every(q => !('answer' in q) && !('correct' in q) && !('feedback' in q) && !('exp' in q)));
  const selected = run.questions[0].answer;
  const first = await api.updateRun(db, 'u1', run.id, 'answer', { index: 0, selected }, now);
  assert.equal(first.feedback.isCorrect, true); assert.equal(first.run.answered, 1);
  const repeated = await api.updateRun(db, 'u1', run.id, 'answer', { index: 0, selected }, now);
  assert.deepEqual(first.run.questions, repeated.run.questions);
  assert.ok(repeated.run.questions.slice(1).every(q => !q.feedback));
  await assert.rejects(api.updateRun(db, 'u1', run.id, 'answer', { index: 0, selected: (selected + 1) % 4 }, now), /不能修改/);
  await assert.rejects(api.updateRun(db, 'u1', run.id, 'answer', { index: 2, selected: 0 }, now), /依序/);
  await assert.rejects(api.updateRun(db, 'u2', run.id, 'answer', { index: 1, selected: 0 }, now), /找不到/);
});
test('duplicate starts share one persistent run, changed scopes reject late generation', async () => {
  const db = fakeDb(), [a, b] = await Promise.all([begin(db), begin(db)]);
  assert.equal(a.id, b.id); assert.equal(db.docs.get('opportunityStates/u1').history.length, 1);
  assert.equal((await api.currentRun(db, 'u1', now)).id, a.id);
  const scope = rules.scopeKey(db.docs.get('users/u1'));
  db.docs.get('users/u1').gameSettings.focusedUnits[0].detail = '整數';
  await assert.rejects(api.startRun(db, 'u1', 'different-request', a.pack, scope, now), /範圍已變更/);
});
test('all five answers are required and simultaneous settlement awards only once', async () => {
  const db = fakeDb(), run = await begin(db);
  await assert.rejects(api.updateRun(db, 'u1', run.id, 'settle', {}, now), /全部五題/);
  for (let i = 0; i < 5; i++) await api.updateRun(db, 'u1', run.id, 'answer', { index: i, selected: run.questions[i].answer }, now);
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => api.updateRun(db, 'u1', run.id, 'settle', { goldAdded: 999999 }, now)));
  assert.equal(outcomes.filter(r => r.applied).length, 1);
  const p = db.docs.get('users/u1'); assert.equal(p.stats.totalScore, 35); assert.equal(p.stats.gold, 170); assert.equal(p.questProgress.totals.dongtian, 1);
  assert.equal(db.docs.get('opportunityStates/u1').active, null); assert.equal(outcomes[0].run.reward.correct, 5);
});
test('nascent soul rewards apply correct-answer and equipped cave bonus without client authority', () => {
  const p = player(); p.stats.totalScore = 68; p.cultivationTraining = { equippedCore: { type: 'gold' } }; p.nascentSoulTree = { paths: { gold: { nodes: { rightFarBottom: 4 } } } };
  const questions = api.makeQuestions(api.normalizePack(rawPack(), target), () => 0), run = { questions, answers: questions.map(q => q.answer) };
  assert.deepEqual(api.rewardFor(run, p), { correct: 5, total: 5, goldAdded: 150, cultivationAdded: 9, soulCultivationAdded: 4, spiritAdded: 5 });
  p.cultivationTraining.coreEnabled = false; assert.equal(api.rewardFor(run, p).cultivationAdded, 5);
});
test('abandoned and expired runs cannot be answered or farm rewards', async () => {
  const db = fakeDb(), run = await begin(db);
  await api.updateRun(db, 'u1', run.id, 'abandon', {}, now);
  assert.equal(await api.currentRun(db, 'u1', now), null);
  await assert.rejects(api.updateRun(db, 'u1', run.id, 'answer', { index: 0, selected: 0 }, now), /已結束/);
  await assert.rejects(begin(db, 'another-request'), /已參悟/);
  const db2 = fakeDb(), run2 = await begin(db2);
  assert.equal(await api.currentRun(db2, 'u1', run2.expiresAt + 1), null);
  await assert.rejects(api.updateRun(db2, 'u1', run2.id, 'settle', {}, run2.expiresAt + 1), /已結束/);
});
test('API requires main-project identity and trusts only the saved learning range', async () => {
  const db = fakeDb(); let generates = 0;
  const handlers = api.createHandlers({ now: () => now, resolveA: () => ({ db, auth: { verifyIdToken: async () => ({ uid: 'u1', aud: PROJECT_IDS.A, iss: 'https://securetoken.google.com/' + PROJECT_IDS.A }) } }),
    generate: async t => { generates++; assert.equal(t.detail, target.detail); return api.normalizePack(rawPack(), t); }, logger: { warn() {} } });
  const res = response(); await handlers.start({ body: {}, get: () => '' }, res); assert.equal(res.statusCode, 401);
  const bad = response(); await handlers.start({ body: { requestId: 'valid-request-001', scope: 'forged' }, get: () => 'Bearer token' }, bad); assert.equal(bad.statusCode, 409); assert.equal(generates, 0);
  const good = response(); await handlers.start({ body: { requestId: 'valid-request-001', scope: rules.scopeKey(player()) }, get: () => 'Bearer token' }, good);
  assert.equal(good.statusCode, 200); assert.equal(good.body.run.questions.length, 5); assert.equal(generates, 1);
});
test('question reports retain shared passage and evidence, update one record and reject another account', async () => {
  const db = fakeDb(), run = await begin(db);
  await assert.rejects(api.reportQuestion(db, 'u1', { runId: run.id, index: 0, reason: '解析與條件不一致' }, now), /先參閱/);
  await api.updateRun(db, 'u1', run.id, 'answer', { index: 0, selected: 0 }, now);
  const first = await api.reportQuestion(db, 'u1', { runId: run.id, index: 0, reason: '解析與條件不一致' }, now);
  const second = await api.reportQuestion(db, 'u1', { runId: run.id, index: 0, reason: '補充：引用段落無法推出結論' }, now + 1);
  assert.equal(first.reportId, second.reportId);
  const report = db.docs.get('opportunityReports/' + first.reportId);
  assert.equal(report.paragraphs.length, 4); assert.ok(report.question.evidence.length); assert.equal(report.createdAt, now);
  await assert.rejects(api.reportQuestion(db, 'u2', { runId: run.id, index: 0, reason: '解析與條件不一致' }, now), /找不到/);
  assert.equal(db.docs.get('users/u1').stats.gold, 20, 'a pending report cannot mint compensation');
});
test('solo next rolls once on answered questions and never clears a question resumed by cancellation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
  const start = source.indexOf('let soloNextBusy = false;'), end = source.indexOf('\nasync function handleAnswer', start);
  const answered = new WeakSet(), quiz = {}, fresh = {}; answered.add(quiz);
  let resolve, rolls = 0, starts = 0;
  const w = { currentActiveQuiz: quiz, isOpportunityActive: () => false,
    maybeEncounterOpportunity: () => { rolls++; return new Promise(r => { resolve = r; }); },
    startQuizFlow: async () => { starts++; w.currentActiveQuiz = fresh; } };
  const ctx = vm.createContext({ window: w, auth: { currentUser: { uid: 'u1' } }, answeredSoloQuizzes: answered, document: { getElementById: () => null }, console });
  vm.runInContext(source.slice(start, end), ctx);
  const first = w.nextQuestion(); await w.nextQuestion(); assert.equal(rolls, 1);
  await w.startQuizFlow(); resolve(true); await first;
  assert.equal(w.currentActiveQuiz, fresh); assert.equal(starts, 1);
  await w.nextQuestion(); assert.equal(rolls, 1, 'unanswered fresh question cannot roll');
});
