globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const readRoot = name => readFileSync(join(__dirname, '../public', name), 'utf8');
const read = name => readFileSync(join(__dirname, '../public/cultivation', name), 'utf8');
const main = readRoot('main-legacy.js');
const theme = read('cultivation-theme.js');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'production source section exists');
  return source.slice(a, b);
}

function setup(totalScore = 0) {
  const nodes = new Map();
  function element() {
    return {
      innerText: '', textContent: '', innerHTML: '', style: {}, dataset: {}, querySelector: () => null,
      classList: { add() {}, remove() {} }, remove() {}, appendChild() {}
    };
  }
  const ids = [
    'display-rank', 'display-stars', 'display-score', 'display-streak',
    'display-best-streak', 'display-accuracy', 'feedback-section',
    'feedback-title', 'feedback-icon', 'feedback-text', 'btn-giveup',
    'xiuxian-score', 'xiuxian-realm', 'xiuxian-sub', 'xiuxian-progress',
    'xiuxian-next', 'xiuxian-progress-label'
  ];
  ids.forEach(id => nodes.set(id, element()));
  const listeners = new Map();
  const writes = [];
  const logs = [];
  const feedback = [];
  let remoteUser = null;
  const context = vm.createContext({
    console, Math, Date, Number, WeakSet,
    QANascentGrowth:globalThis.QANascentGrowth,QACombatCombo:globalThis.QACombatCombo,
    QASoulTalents:require('../public/cultivation/soul-talents.js'),
    document: {
      readyState: 'complete',
      getElementById: id => nodes.get(id) || null,
      querySelectorAll: () => [],
      createElement: element,
      body: { appendChild() {} }
    },
    window: {
      QAKnowledgePoints:require('../public/cultivation/knowledge-points.js'),
      XianxiaQuestRules: require('../public/cultivation/quest-rules.js'),
      QAAnswerGoldRules: require('../public/cultivation/answer-gold-rules.js'),
      addEventListener(type, fn) { listeners.set(type, fn); },
      dispatchEvent(event) { listeners.get(event.type)?.(event); }
    },
    CustomEvent: class {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    navigator: {}, setTimeout() {}, db: {},
    beginSoloCultivationFeedback(options) {
      feedback.push({ type: 'begin', scoreBefore: options.scoreBefore });
      return {
        async play(reward) {
          feedback.push({ type: 'play', ...reward });
          await context.waitForCultivationFeedback?.();
        },
        cancel() { feedback.push({ type: 'cancel' }); }
      };
    },
    auth: { currentUser: { uid: 'test-user', email: 'test@example.com' } },
    doc: (_, ...parts) => parts.join('/'),
    collection: (_, path) => path,
    updateDoc: async (path, data) => writes.push({ path, data: structuredClone(data) }),
    runTransaction: async (_, worker) => worker({
      get: async () => ({ exists: () => true, data: () => structuredClone(remoteUser) }),
      update: (path, data) => {
        writes.push({ path, data: structuredClone(data) });
        remoteUser = { ...remoteUser, ...structuredClone(data) };
      }
    }),
    addDoc: async (_, data) => logs.push(structuredClone(data)),
    serverTimestamp: () => 123,
    t: key => key, parseMarkdownImages: text => text, fillBuffer() {},
    injectStyle() {}, addHomePanel() {}, rewriteLabels() {},
    state: { lastMeditation: '' },
    currentUserData: {
      uid: 'test-user',
      stats: {
        totalScore, currentStreak: 0, bestStreak: 0,
        totalAnswered: 0, totalCorrect: 0, rankLevel: 0, gold: 0
      }
    },
    soloSession: { active: false }
  });
  vm.runInContext(
    read('true-immortal.js') +
    'window.getRealmUserUid = () => auth.currentUser?.uid;' +
    'const answeredSoloQuizzes = new WeakSet();' +
    // This isolated reward harness does not mount the new browser-local quiz cache.
    'function syncSoloQuestionCache() {};' +
    'const soloQuestionCache = { getActive: () => null, consumeActive: () => false };' +
'const quizHelperState = { answered:false, selectedIndex:null, correctIndex:null, explanation:\"\", question:\"\", messages:[], busy:false, requestSerial:0 };' +
    'function renderQuizHelperConversation() {};' +
    'const extendedPracticeState = { active:false };' +
    read('nascent-soul-rules.js').replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm, '') +
    'window.getCurrentUserData = () => currentUserData;' +
    read('cultivation-rules.js').replace(/export /g, '') +
    section(main, 'const REALMS = [', '// 綁定全域函式') +
    section(main, 'function updateUIStats() {', 'function buildPathTree(') +
    section(main, 'async function handleAnswer(', 'async function generateVisualAid(') +
    section(theme, '  function score() {', '  function text(selector, value) {') +
    section(theme, '  function updateRankNode(', '  function openRealmAtlas()') +
    section(theme, '  function render() {', '  function boot()'),
    context
  );
  vm.runInContext(read('xiuxian-live-sync.js'), context);

  function newQuiz() {
    context.window.currentActiveQuiz = {
      data: { q: 'Same question may legitimately recur', ans: 0, opts: ['A', 'B'] },
      badge: '🎯 Math | Addition'
    };
  }
  async function answer(userIdx = 0, correctIdx = 0) {
    if (!remoteUser) remoteUser = structuredClone(context.currentUserData);
    return context.handleAnswer(userIdx, correctIdx, 'Question', 'Explanation');
  }
  newQuiz();
  return { context, nodes, writes, logs, feedback, newQuiz, answer,
    setRemoteStats(patch) {
      remoteUser ||= structuredClone(context.currentUserData);
      Object.assign(remoteUser.stats, patch);
    }
  };
}

test('solo answers aggregate explicit knowledge tags against saved totals without replacing curriculum scope', async () => {
  const h=setup(28),point={knowledge_subject:'國文',knowledge_point_id:'chinese-2',knowledge_point:'文言文'};
  h.context.window.QASoloLearningRules=require('../public/cultivation/solo-learning-rules.js');
  h.setRemoteStats({knowledgePointMapV1:{國文:{'chinese-2':{total:7,correct:4}}}});
  const tag=()=>Object.assign(h.context.window.currentActiveQuiz,{meta:{...point},learningSubject:'國文',learningTopic:'七上第一課'});
  tag();await h.answer();await h.answer();
  assert.deepEqual(h.writes.at(-1).data.stats.knowledgePointMapV1.國文['chinese-2'],{total:8,correct:5});
  assert.equal(h.logs[0].knowledgePoint,'文言文');assert.equal(h.logs[0].subTopic,'七上第一課');
  h.newQuiz();tag();await h.answer(1,0);
  assert.deepEqual(h.writes.at(-1).data.stats.knowledgePointMapV1.國文['chinese-2'],{total:9,correct:5});
});


test('failed answer persistence releases cultivation feedback and wrong answers create none', async () => {
  const h = setup(28);
  h.context.runTransaction = async () => { throw new Error('offline'); };
  await h.answer();
  assert.equal(h.feedback.at(-1).type, 'cancel');
  assert.equal(h.feedback.some(item => item.type === 'play'), false);
  const miss = setup(28);
  await miss.answer(1, 0);
  assert.equal(miss.feedback.length, 0);
});


test('correct answer updates saved stats and the top panel immediately', async () => {
  const h = setup(0);
  const pending = h.answer();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '1 修為');
  assert.equal(h.nodes.get('xiuxian-realm').textContent, '煉氣');
  assert.equal(h.nodes.get('xiuxian-sub').textContent, '一層');
  assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');
  assert.equal(h.nodes.get('xiuxian-next').textContent, '1 修為');
  await pending;
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.stats.totalScore, 1);
  assert.equal(h.writes[0].data.stats.rankLevel, 1);
  assert.equal(h.writes[0].data.stats.totalCorrect, 1);
  assert.equal(h.writes[0].data.stats.gold, 20, '問道答對一題應獲得 20 靈石');
  assert.equal(h.context.currentUserData.stats.gold, 20);
  assert.equal(h.logs.length, 1);
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '1 修為');
  h.context.currentUserData = { uid: 'test-user', ...h.writes[0].data };
  h.context.updateUIStats();
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '1 修為');
});

test('each new quiz awards once, including a repeated question', async () => {
  const h = setup();
  await Promise.all([h.answer(), h.answer()]);
  assert.equal(h.writes.length, 1);
  for (let i = 0; i < 3; i++) {
    h.newQuiz();
    await h.answer();
  }
  assert.equal(h.writes.length, 4);
  assert.equal(h.context.currentUserData.stats.totalScore, 4);
  assert.equal(h.context.currentUserData.stats.currentStreak, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(h.context.currentUserData.stats, 'cultivationShield'), false);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, undefined);
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '4 修為');
  assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');
});

test('wrong and skipped answers preserve cultivation below Golden Core and reset the streak', async () => {
  const h = setup(25);
  h.context.currentUserData.stats.currentStreak = 4;
  h.context.currentUserData.stats.cultivationShield = true;
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 25);
  assert.equal(h.context.currentUserData.stats.currentStreak, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(h.context.currentUserData.stats, 'cultivationShield'), false);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, false);
  h.newQuiz();
  await h.answer(-1, -2);
  assert.equal(h.writes.length, 0, 'neutral wrong/skip answers wait for a reward before stats persistence');
  assert.equal(h.context.currentUserData.stats.totalScore, 25);
  assert.equal(h.context.currentUserData.stats.totalAnswered, 2);
  assert.equal(h.nodes.get('xiuxian-score').textContent, '25 修為');
  h.newQuiz();
  await h.answer(0, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.stats.totalAnswered, 3, 'the next reward flushes prior local answer counts');
});

test('ordinary streaks never create Dao-heart shields or bonus cultivation', async () => {
  const h = setup();
  for (let i = 0; i < 10; i++) {
    if (i) h.newQuiz();
    await h.answer();
  }
  assert.equal(h.context.currentUserData.stats.totalScore, 10);
  assert.equal(h.context.currentUserData.stats.currentStreak, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(h.context.currentUserData.stats, 'cultivationShield'), false);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, undefined);
});

test('Golden Core realm gives +2 correct and never removes cultivation for wrong or skipped answers', async () => {
  const h = setup(27);

  await h.answer();
  assert.equal(h.context.currentUserData.stats.totalScore, 28);
  assert.equal(h.context.currentUserData.stats.gold, 25, 'the breakthrough answer uses the realm before this answer');

  h.newQuiz();
  await h.answer();
  assert.equal(h.context.currentUserData.stats.totalScore, 30);
  assert.equal(h.context.currentUserData.stats.gold, 55, 'the next answer receives Golden Core gold');

  h.newQuiz();
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 30);

  h.newQuiz();
  await h.answer(-1, -2);
  assert.equal(h.context.currentUserData.stats.totalScore, 30);

  h.newQuiz();
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 30);
});

test('Ningxin Dao-heart preserves one streak on a mistake and is consumed', async () => {
  const h = setup(28);
  h.context.currentUserData.stats.goldenCoreShield = true;
  h.context.currentUserData.stats.currentStreak = 5;
  h.context.window.resolveGoldenCoreCultivationReward = ({stats,isCorrect}) =>
    ({preserveStreak:!isCorrect && stats.goldenCoreShield && stats.currentStreak>0});
  await h.answer(1,0);
  assert.equal(h.context.currentUserData.stats.totalScore,28);
  assert.equal(h.context.currentUserData.stats.currentStreak,5);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield,false);
  h.newQuiz(); await h.answer(1,0);
  assert.equal(h.context.currentUserData.stats.totalScore,28);
  assert.equal(h.context.currentUserData.stats.currentStreak,0);
});

test('Golden Core alone may create its own Dao-heart state and cultivation bonus', async () => {
  const h = setup(28);
  h.context.window.resolveGoldenCoreCultivationReward = () => ({ bonusGain: 2, forceShield: true, message: '金丹生效' });
  await h.answer();
  assert.equal(h.context.currentUserData.stats.totalScore, 32);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, true);
  assert.equal(Object.prototype.hasOwnProperty.call(h.context.currentUserData.stats, 'cultivationShield'), false);
});

test('legacy missing or string scores become numeric cultivation totals', async () => {
  for (const [initial, expected] of [[undefined, 1], ['20', 21]]) {
    const h = setup();
    h.context.currentUserData.stats.totalScore = initial;
    await h.answer();
    assert.equal(h.writes[0].data.stats.totalScore, expected);
    assert.equal(h.nodes.get('xiuxian-score').textContent, expected + ' 修為');
  }
});

test('wrong-answer Golden Core Dao-heart can form without reducing cultivation', async () => {
  const h = setup(28);
  h.context.window.resolveGoldenCoreCultivationReward = () => ({ forceShield: true, message: '清心護體' });
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 28);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, true);
});


test('saved soul cultivation is applied by ordinary answer flow and persisted once', async () => {
  const h=setup(68);
  h.context.currentUserData.cultivationTraining={coreEnabled:true,equippedCore:{type:'sword'}};
  h.context.currentUserData.nascentSoulGrowth={version:1,branches:{cultivation:5}};
  await Promise.all([h.answer(),h.answer()]);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].data.stats.totalScore,73);
  assert.equal(h.writes[0].data.stats.nascentSoulSpirit,undefined);
  assert.equal(h.nodes.get('xiuxian-score').textContent,'73 修為');
});

test('saved disabled core suppresses soul cultivation in the real answer flow', async () => {
  const h=setup(68);
  h.context.currentUserData.cultivationTraining={coreEnabled:false,equippedCore:{type:'sword'}};
  h.context.currentUserData.nascentSoulGrowth={version:1,branches:{cultivation:5}};
  await h.answer();
  assert.equal(h.writes[0].data.stats.totalScore,70);
});


test('ordinary correct answers atomically update quest progress; duplicate clicks and wrong answers do not count', async () => {
  const h = setup();
  await Promise.all([h.answer(), h.answer()]);
  assert.equal(h.writes[0].data.questProgress.totals.solo, 1);
  h.newQuiz(); await h.answer(1, 0);
  assert.equal(h.writes.length, 1);
  h.newQuiz(); await h.answer();
  assert.equal(h.writes[1].data.questProgress.totals.solo, 2);
  assert.equal(h.writes[1].data.questProgress.daily.counts.solo, 2);
});

test('ordinary answer transactions preserve server quest rewards arriving before persistence', async () => {
  const h = setup(10);
  h.setRemoteStats({ totalScore: 12, gold: 80 });
  await h.answer();
  assert.equal(h.writes[0].data.stats.totalScore, 13);
  assert.equal(h.writes[0].data.stats.gold, 105, '保留遠端 80 靈石並加上築基每題 25 靈石');
  assert.equal(h.context.currentUserData.stats.gold, 105);
  assert.equal(h.context.currentUserData.stats.totalScore, 13);
});

test('real answer flow persists mistakes and awards correction variants exactly once',async()=>{
 const h=setup(28);h.context.window.QASoloLearningRules=require('../public/cultivation/solo-learning-rules.js');
 const origin=h.context.window.currentActiveQuiz.data.q;
 await h.answer(1,0);assert.equal(h.writes.length,1);assert.equal(h.context.currentUserData.stats.totalScore,28);
 h.newQuiz();h.context.window.currentActiveQuiz.data.q='A new variation';h.context.window.currentActiveQuiz.recoveryOrigin=origin;
 await h.answer();assert.equal(h.context.currentUserData.stats.totalScore,31);assert.equal(h.context.currentUserData.stats.gold,40);
 h.newQuiz();h.context.window.currentActiveQuiz.data.q='Another variation';h.context.window.currentActiveQuiz.recoveryOrigin=origin;
 await h.answer();assert.equal(h.context.currentUserData.stats.totalScore,33);assert.equal(h.context.currentUserData.stats.gold,70);
});
test('a second tab cannot claim an already corrected origin again',async()=>{
 const h=setup(28),rules=require('../public/cultivation/solo-learning-rules.js');h.context.window.QASoloLearningRules=rules;
 const origin='Old mistake',key=rules.key(origin);
 h.context.currentUserData.stats.soloLearningV1={version:1,mistakes:{[key]:{recovered:false}}};
 h.setRemoteStats({soloLearningV1:{version:1,mistakes:{[key]:{recovered:true}}}});
 h.context.window.currentActiveQuiz.recoveryOrigin=origin;
 await h.answer();assert.equal(h.context.currentUserData.stats.totalScore,30);assert.equal(h.context.currentUserData.stats.gold,30);
 assert.match(h.nodes.get('feedback-title').innerHTML,/\+2 修為/);
});
