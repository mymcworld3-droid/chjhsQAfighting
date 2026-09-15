const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '../public', name), 'utf8');
const main = read('main-legacy.js');
const theme = read('cultivation-theme.js');

// Run the actual answer handler, UI updater, reward rules and both panel
// renderers with in-memory Firebase and DOM doubles (no live account writes).
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
      innerText: '', textContent: '', innerHTML: '', style: {},
      classList: { add() {}, remove() {} }, remove() {}
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
  const context = vm.createContext({
    console, Math, Date, Number, WeakSet,
    document: {
      readyState: 'complete',
      getElementById: id => nodes.get(id) || null,
      querySelectorAll: () => [],
      createElement: element,
      body: { appendChild() {} }
    },
    window: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      dispatchEvent(event) { listeners.get(event.type)?.(event); }
    },
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    },
    navigator: {}, setTimeout() {}, db: {},
    auth: { currentUser: { uid: 'test-user', email: 'test@example.com' } },
    doc: (_, ...parts) => parts.join('/'),
    collection: (_, path) => path,
    updateDoc: async (path, data) => writes.push({ path, data: structuredClone(data) }),
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
    'const answeredSoloQuizzes = new WeakSet();' +
    'window.getCurrentUserData = () => currentUserData;' +
    read('cultivation-rules.js').replace(/export /g, '') +
    section(main, 'const REALMS = [', '// 綁定全域函式') +
    section(main, 'function updateUIStats() {', 'function buildPathTree(') +
    section(main, 'async function handleAnswer(', 'async function generateVisualAid(') +
    section(theme, '  function score() {', '  function toast(') +
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
    return context.handleAnswer(userIdx, correctIdx, 'Question', 'Explanation');
  }
  newQuiz();
  return { context, nodes, writes, logs, newQuiz, answer };
}

test('correct answer updates saved stats and the top panel immediately', async () => {
  const h = setup(4);
  const pending = h.answer();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '5 修為');
  assert.equal(h.nodes.get('xiuxian-realm').textContent, '煉氣');
  assert.equal(h.nodes.get('xiuxian-sub').textContent, '一層');
  assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');
  assert.equal(h.nodes.get('xiuxian-next').textContent, '5 修為');
  await pending;
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.stats.totalScore, 5);
  assert.equal(h.writes[0].data.stats.rankLevel, 1);
  assert.equal(h.writes[0].data.stats.totalCorrect, 1);
  assert.equal(h.logs.length, 1);
  // The theme's periodic render must not replace the reward with stale state.
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '5 修為');
  // Simulate signing in again from persisted Firebase data.
  h.context.currentUserData = { uid: 'test-user', ...h.writes[0].data };
  h.context.updateUIStats();
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '5 修為');
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
  assert.equal(h.context.currentUserData.stats.cultivationShield, true);
  h.context.render();
  assert.equal(h.nodes.get('xiuxian-score').textContent, '4 修為');
  assert.equal(h.nodes.get('xiuxian-progress').style.width, '80%');
});

test('wrong and skipped answers preserve cultivation and reset the streak', async () => {
  const h = setup(25);
  h.context.currentUserData.stats.currentStreak = 4;
  h.context.currentUserData.stats.cultivationShield = true;
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 25);
  assert.equal(h.context.currentUserData.stats.currentStreak, 0);
  assert.equal(h.context.currentUserData.stats.cultivationShield, false);
  h.newQuiz();
  await h.answer(-1, -2);
  assert.equal(h.writes[1].data.stats.totalScore, 25);
  assert.equal(h.writes[1].data.stats.totalAnswered, 2);
  assert.equal(h.nodes.get('xiuxian-score').textContent, '25 修為');
});

test('legacy missing or string scores become numeric cultivation totals', async () => {
  for (const [initial, expected] of [[undefined, 1], ['30', 31]]) {
    const h = setup();
    h.context.currentUserData.stats.totalScore = initial;
    await h.answer();
    assert.equal(h.writes[0].data.stats.totalScore, expected);
    assert.equal(h.nodes.get('xiuxian-score').textContent, expected + ' 修為');
  }
});
