const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const rulesSource = readFileSync(join(__dirname, '../public/cultivation/daily-meditation-rules.js'), 'utf8');
const context = vm.createContext({ Date, Intl, Math, Number, Object, String });
vm.runInContext(rulesSource.replace(/^export /gm, '') +
  '\nglobalThis.rules = { meditationDateKey, nextMeditationStreak, meditationReward };', context);
const { meditationDateKey, nextMeditationStreak, meditationReward } = context.rules;

test('daily meditation always resets at midnight in Taiwan', () => {
  assert.equal(meditationDateKey(new Date('2026-09-21T15:59:59Z')), '2026-09-21');
  assert.equal(meditationDateKey(new Date('2026-09-21T16:00:00Z')), '2026-09-22');
});

test('streak advances across month boundaries, breaks after missed day', () => {
  assert.equal(nextMeditationStreak('', 0, '2026-09-22'), 1);
  assert.equal(nextMeditationStreak('2026-09-21', 6, '2026-09-22'), 7);
  assert.equal(nextMeditationStreak('2026-08-31', 29, '2026-09-01'), 30);
  assert.equal(nextMeditationStreak('2024-02-28', 2, '2024-02-29'), 3);
  assert.equal(nextMeditationStreak('2026-09-20', 27, '2026-09-22'), 1);
  assert.equal(nextMeditationStreak('2026-09-22', 7, '2026-09-22'), 7);
  assert.equal(nextMeditationStreak('2026-09-23', 7, '2026-09-22'), 1);
});

test('early streak rewards start on day two, cultivation bonus on day three', () => {
  assert.equal(meditationReward(28, 1, 3).cultivation, 3);
  assert.equal(meditationReward(28, 1, 3).gold, 30);
  assert.equal(meditationReward(28, 2, 3).gold, 40);
  assert.equal(meditationReward(28, 3, 3).cultivation, 4);
  assert.equal(meditationReward(28, 3, 3).gold, 45);
  assert.equal(meditationReward(28, 7, 3).cultivation, 5);
  assert.equal(meditationReward(28, 7, 3).gold, 70);
});

test('every realm uses its own reward threshold', () => {
  const expected = [
    [0, 1, 10], [9, 1, 10], [10, 2, 20], [27, 2, 20],
    [28, 3, 30], [68, 4, 45], [188, 5, 60], [428, 6, 80],
    [788, 7, 100], [1268, 8, 130], [1868, 9, 160], [2588, 10, 200]
  ];
  for (const [score, cultivation, gold] of expected) {
    const reward = meditationReward(score, 1, 3);
    assert.equal(reward.cultivation, cultivation, 'cultivation at ' + score);
    assert.equal(reward.gold, gold, 'spirit stones at ' + score);
  }
});

test('two correct answers grant half base plus full streak; poor results grant only five stones', () => {
  const partial = meditationReward(28, 7, 2);
  assert.equal(partial.cultivation, 4);
  assert.equal(partial.gold, 55);
  for (const count of [0, 1]) {
    const reward = meditationReward(2588, 90, count);
    assert.equal(reward.cultivation, 0);
    assert.equal(reward.gold, 5);
  }
});

test('streak bonus is capped from day ninety onwards', () => {
  assert.equal(meditationReward(2588, 90, 3).cultivation, 16);
  assert.equal(meditationReward(2588, 90, 3).gold, 400);
  assert.equal(meditationReward(2588, 10000, 3).cultivation, 16);
  assert.equal(meditationReward(2588, 10000, 3).gold, 400);
});

test('meditation challenge is registered and local check-in is no longer used', () => {
  const read = path => readFileSync(join(__dirname, '../public', path), 'utf8');
  const loader = read('main.js');
  const legacy = read('main-legacy.js');
  const theme = read('cultivation/cultivation-theme.js');
  const html = read('index.html');
  const meditation = read('cultivation/daily-meditation.js');
  assert.match(loader, /cultivation\/daily-meditation\.js/);
  assert.match(legacy, /window\.fetchDailyMeditationQuestion = fetchOneQuestion/);
  assert.match(theme, /window\.openDailyMeditation\?\.\(\)/);
  assert.doesNotMatch(theme, /localStorage\.setItem\(KEY/);
  assert.match(html, /id="xiuxian-meditation-streak"/);
  assert.match(meditation, /runTransaction/);
  assert.match(meditation, /const totalCultivation = reward\.cultivation \+ soulCultivationAdded/);
  assert.match(meditation, /'stats\.totalScore': increment\(totalCultivation\)/);
});


const mistakeSource = readFileSync(join(__dirname, '../public/cultivation/daily-meditation-mistakes.js'), 'utf8');
const mistakeContext = vm.createContext({ Math, Number, Object, Set, String, Map, Array });
vm.runInContext(mistakeSource.replace(/^export /gm, '') +
  '\nglobalThis.mistakes = { buildMeditationMistakePool, chooseMeditationMistakes };', mistakeContext);
const { buildMeditationMistakePool, chooseMeditationMistakes } = mistakeContext.mistakes;
const example = (q, correct, mode = 'infinite') => ({
  mode, question: q, options: ['第一項', '第二項', '第三項'],
  correctIdx: 1, userIdx: correct ? 1 : 0, isCorrect: correct, explanation: '錯題解析'
});

test('daily meditation draws wrong answers from solo and dongtian, not unrelated logs', () => {
  const logs = [
    { mode: 'dongtian', dongtianAnswers: [
      { q: '洞天錯題一', options: ['A', 'B'], correctIdx: 1, userIdx: 0, isCorrect: false, exp: '解析一' },
      { q: '洞天答對題', options: ['A', 'B'], correctIdx: 1, userIdx: 1, isCorrect: true }
    ] },
    example('問道錯題一', false),
    example('問道錯題二', false),
    example('問道答對題', true),
  ];
  const pool = buildMeditationMistakePool(logs);
  assert.equal(pool.total, 3);
  const picked = chooseMeditationMistakes(pool, 3, () => 0.5);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map(q => q.key)).size, 3);
  assert.ok(picked.some(q => q.source === '洞天錯題'));
  assert.ok(picked.every(q => q.data.ans >= 0));
});

test('previously wrong but later corrected questions are fallback only', () => {
  const logs = [
    example('修正題', true),
    example('未修正題', false),
    example('修正題', false),
    { ...example('缺少選項', false), options: [] },
    { ...example('跳過題', false), userIdx: -1 },
    { ...example('沒有正解', false), correctIdx: -1 }
  ];
  const pool = buildMeditationMistakePool(logs);
  assert.equal(pool.total, 2);
  assert.equal(pool.unresolved.length, 1);
  assert.equal(pool.reviewed.length, 1);
  assert.equal(chooseMeditationMistakes(pool, 3, () => 0).length, 2);
  assert.equal(chooseMeditationMistakes(pool, 1, () => 0)[0].data.q, '未修正題');
});

test('review logs support recurring wrong answers and mastered answers', () => {
  const logs = [
    { mode: 'daily-meditation', dailyMeditationAnswers: [
      { q: '再錯題', options: ['A', 'B'], correctIdx: 1, userIdx: 0, isCorrect: false },
      { q: '已掌握題', options: ['A', 'B'], correctIdx: 1, userIdx: 1, isCorrect: true }
    ] },
    { mode: 'dongtian', dongtianAnswers: [
      { q: '已掌握題', options: ['A', 'B'], correctIdx: 1, userIdx: 0, isCorrect: false }
    ] }
  ];
  const pool = buildMeditationMistakePool(logs);
  assert.equal(pool.total, 2);
  assert.equal(pool.unresolved[0].data.q, '再錯題');
  assert.equal(pool.reviewed[0].data.q, '已掌握題');
});

test('new meditation runner uses historical mistakes and rejects shortages', () => {
  const source = readFileSync(join(__dirname, '../public/cultivation/daily-meditation.js'), 'utf8');
  assert.match(source, /where\('uid', '==', id\), orderBy\('timestamp', 'desc'\), limit\(250\)/);
  assert.match(source, /chooseMeditationMistakes\(pool, QUESTION_TOTAL\)/);
  assert.match(source, /if \(selected.length < QUESTION_TOTAL\)/);
  assert.match(source, /dailyMeditationAnswers: current.answers.map/);
  assert.doesNotMatch(source, /await fn\(\)/);
});

test('daily meditation begins historical mistake prefetch before waiting for remote status', () => {
  const source = readFileSync(join(__dirname, '../public/cultivation/daily-meditation.js'), 'utf8');
  const opening = source.slice(source.indexOf('  async function open() {'), source.indexOf('  function typeset() {'));
  assert.ok(opening.indexOf('void prepareMistakes(id, date)') < opening.indexOf('await loadRemote()'));
  assert.match(source, /const \{ selected, available \} = await prepareMistakes\(id, date\)/);
  assert.match(source, /if \(record\(\)\.lastDate !== date && !\(session && session\.uid === id && session\.date === date\)\)/);
  assert.match(source, /invalidateMistakes\(\);\s*window\.updateUIStats\?\.\(\)/);
});

test('daily meditation prefetch shares pending Firestore query, caches result and invalidates across players', async () => {
  const source = readFileSync(join(__dirname, '../public/cultivation/daily-meditation.js'), 'utf8');
  const helper = source.slice(source.indexOf('  function invalidateMistakes() {'), source.indexOf('  function uid() {'));
  let resolveFirst, calls = 0, player = 'u1', day = '2026-09-22';
  const context = vm.createContext({
    Promise, console,
    mistakeKey: '', mistakeResult: null, mistakePending: null,
    uid: () => player, today: () => day,
    loadMistakes: () => {
      calls++;
      if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ selected: [{ key: 'fresh' }], available: 1 });
    }
  });
  vm.runInContext(helper, context);
  const first = vm.runInContext("prepareMistakes('u1', '2026-09-22')", context);
  const second = vm.runInContext("prepareMistakes('u1', '2026-09-22')", context);
  assert.equal(first, second, 'two starts reuse one pending query');
  assert.equal(calls, 1);
  resolveFirst({ selected: [{ key: 'first' }], available: 1 });
  assert.equal((await first).selected[0].key, 'first');
  assert.equal((await vm.runInContext("prepareMistakes('u1', '2026-09-22')", context)).selected?.[0]?.key, 'first');
  assert.equal(calls, 1);
  player = 'u2';
  const next = await vm.runInContext("prepareMistakes('u2', '2026-09-22')", context);
  assert.equal(next.selected[0].key, 'fresh');
  assert.equal(calls, 2);
  vm.runInContext('invalidateMistakes()', context);
  assert.equal(context.mistakeResult, null);
  assert.equal(context.mistakePending, null);
});
