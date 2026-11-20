'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

function harness(initial = {}) {
  const store = new Map(Object.entries(initial)), listeners = new Map(), timers = new Map();
  const nodes = new Map(), children = new Map();
  let current = 'page-home', owner = 'new-account', layer = null, nextId = 0, launched = 0;
  function element(id = '') {
    return { id, style: {}, textContent: '', hidden: false, isConnected: true,
      getClientRects() { return this.hidden ? [] : [{}]; },
      closest() { return null; },
      getBoundingClientRect() { return { left: 20, top: 120, right: 190, bottom: 165, height: 50 }; },
      setAttribute() {}, focus() {}, remove() { if (layer === this) layer = null; },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element(selector));
        return children.get(selector);
      },
      querySelectorAll(selector) {
        return selector === '.fag-mask' ? Array.from({ length: 4 }, (_, i) =>
          this.querySelector('.fag-mask-' + i)) : [];
      }
    };
  }
  for (const id of ['page-home', 'page-quiz', 'quiz-container', 'tactical-combat',
    'btn-home-start', 'btn-giveup', 'options-container', 'option-btn-0']) nodes.set('#' + id, element(id));
  for (const name of ['#tactical-combat [data-quiz]',
    '#tactical-combat [data-wheel-action="move"], #tactical-combat [data-action="move"]',
    '#tactical-combat [data-wheel-action="attack-ring"], #tactical-combat [data-action="attack"]',
    '#tactical-combat [data-end]', '#tactical-combat canvas', '#options-container button:not(:disabled)'])
    nodes.set(name, element(name));
  const blocked = { value: false };
  const document = {
    documentElement: { clientWidth: 390, clientHeight: 844 },
    querySelector(selector) {
      if (selector.startsWith('#first-visit-layer,')) return blocked.value ? {} : null;
      const node = nodes.get(selector);
      if (!node) return null;
      if (selector === '#page-home') node.hidden = current !== 'page-home';
      if (selector === '#page-quiz' || selector === '#quiz-container') node.hidden = current !== 'page-quiz';
      if (selector === '#tactical-combat') node.hidden = current !== 'battle';
      return node;
    },
    createElement() { return element('guide'); },
    body: { append(node) { layer = node; } },
    addEventListener(name, callback) { listeners.set('doc:' + name, callback); }
  };
  const window = {
    getCurrentUserData: () => ({ uid: owner }),
    addEventListener(name, callback) { listeners.set(name, callback); },
    showToast() { launched++; }
  };
  const ctx = vm.createContext({
    document, window, localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, val) => store.set(key, val)
    },
    setInterval(fn) { const id = ++nextId; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  vm.runInContext(read('cultivation/first-answer-guide.js'), ctx);
  return {
    window, store, timers, layer: () => layer, notices: () => launched,
    page(value) { current = value; },
    owner(value) { owner = value; },
    block(value) { blocked.value = value; },
    tick() { for (const cb of timers.values()) cb(); },
    event(kind, origin = '', uid = owner, details = {}) {
      listeners.get('qingyun:tactical-tutorial')({ detail: { kind, origin, uid,
        roomId: 'arena-newbie', stage: 1, ...details } });
    }
  };
}
const key = uid => 'qingyun:tactical-first-turn:v2:' + uid;
test('new accounts begin at the real trial entry, without submitting a demo question', () => {
  const h = harness();
  h.window.scheduleFirstAnswerGuide('new-account', false);
  assert.equal(h.layer(), null);
  h.window.scheduleFirstAnswerGuide('new-account', true);
  assert.match(h.layer().querySelector('h2').textContent, /進入問道試煉/);
  h.block(true); h.tick(); assert.equal(h.layer(), null);
  h.block(false); h.tick(); assert.ok(h.layer());
});
test('only the exact attack-selection, single-step move and rightward strike complete the eight steps', () => {
  const h = harness(); h.window.scheduleFirstAnswerGuide('new-account', true);
  h.event('attacked'); assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 0);
  h.event('entered'); h.page('battle'); h.tick();
  assert.match(h.layer().querySelector('h2').textContent, /答題充能/);
  h.event('question'); h.page('page-quiz'); h.tick();
  assert.match(h.layer().querySelector('h2').textContent, /學習範圍/);
  h.event('scope-saved', 'page-settings');
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 2);
  h.event('scope-saved', 'page-quiz');
  assert.match(h.layer().querySelector('h2').textContent, /完成第一題/);
  h.event('answered'); h.page('battle'); h.tick();
  assert.match(h.layer().querySelector('h2').textContent, /攻擊按鈕/);
  h.event('moved', '', 'new-account', {x:2,y:3});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 4);
  h.event('attack-selected');assert.match(h.layer().querySelector('h2').textContent, /向右移動一格/);
  h.event('moved', '', 'new-account', {x:3,y:3});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 5);
  h.event('moved', '', 'new-account', {x:2,y:3});
  assert.match(h.layer().querySelector('h2').textContent, /再次選擇攻擊/);
  h.event('attack-selected');assert.match(h.layer().querySelector('h2').textContent, /選擇靈狼方向/);
  h.event('attacked', '', 'new-account', {x:3,y:3});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 7);
  h.event('attacked', '', 'new-account', {x:4,y:3});
  assert.equal(h.layer(), null);
  assert.equal(JSON.parse(h.store.get(key('new-account'))).status, 'done');
  assert.equal(h.notices(), 1);
  h.window.scheduleFirstAnswerGuide('new-account', true);
  assert.equal(h.timers.size, 0);
});
test('account changes and interrupted attempts never cross-complete another account', () => {
  const h = harness(); h.window.scheduleFirstAnswerGuide('new-account', true);
  h.event('entered', '', 'different'); assert.equal(JSON.parse(h.store.get(key('new-account'))).step, 0);
  h.event('entered'); h.owner('different'); h.tick();
  assert.equal(h.timers.size, 0);
  assert.equal(JSON.parse(h.store.get(key('new-account'))).status, 'pending');
  h.owner('new-account'); h.page('page-home');
  h.window.scheduleFirstAnswerGuide('new-account', false);
  assert.match(h.layer().querySelector('h2').textContent, /進入問道試煉/);
});
test('scope editor retains its opener instead of always navigating to settings', () => {
  const legacy = read('main-legacy.js');
  const segment = legacy.slice(legacy.indexOf('window.openQuizScopeSettings ='),
    legacy.indexOf('// 問道題目錯誤回報'));
  const calls = [], quiz = { data: { q: '題目' }, answered: false };
  const ctx = vm.createContext({
    isAnswering: false, trialQuestionSession: null, document: {
      querySelector: () => ({ id: 'page-quiz' })
    },
    window: { currentActiveQuiz: quiz, openCurriculumStudio: arg => calls.push(arg) }
  });
  vm.runInContext(segment, ctx);
  assert.equal(ctx.window.openQuizScopeSettings(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ returnPage: 'page-quiz' }]);
  assert.equal(quiz.answered, false);
  ctx.isAnswering = true;
  assert.equal(ctx.window.openQuizScopeSettings(), false);
  assert.equal(calls.length, 1);
  const studio = read('cultivation/scope-fullscreen.js');
  assert.match(studio, /returnPage = options\?\.returnPage \|\| activePage/);
  assert.match(studio, /kind: 'scope-saved', origin/);
  assert.match(studio, /scopeChanged && origin === 'page-quiz'/);
  assert.match(read('cultivation/curriculum-pages.js'), /curriculumStudioReturnPage/);
});
test('tutorial listens to confirmed move/attack and first validated answer', () => {
  const src = read('cultivation/tactical-combat.js');
  assert.match(src, /tutorialEvent\('entered'\)/);
  assert.match(src, /tutorialEvent\('question'\)/);
  assert.match(src, /tutorialEvent\('answered'\)/);
  assert.match(src, /committed\.revision>request\.revision/);
  for (const stage of ['moved','attacked']) assert.match(src,new RegExp("tutorialEvent\\('"+stage+"'"));
  assert.match(src, /tutorialEvent\('attack-selected'\)/);
  assert.match(src, /selectWheel\('attack-ring',true\)/);
  assert.match(src, /if\(prior===4&&tutorialStep\(\)===5\)selectWheel\('move',true\)/);
});

test('only the learner’s real first guided question is rearranged to A, and remains scoped to the account', () => {
  const h=harness();h.window.scheduleFirstAnswerGuide('new-account',true);
  const quiz={data:{q:'1+1=?',opts:['3','4','2','5'],ans:2,exp:'2'}};
  assert.equal(h.window.arrangeFirstGuideAnswerA('new-account',quiz),false,'no battle entered');
  h.event('entered');h.page('battle');h.event('question');
  assert.equal(h.window.arrangeFirstGuideAnswerA('other-account',quiz),false);
  assert.equal(h.window.arrangeFirstGuideAnswerA('new-account',quiz),true);
  assert.deepEqual(quiz.data.opts,['2','4','3','5']);
  assert.equal(quiz.data.ans,0);
  h.event('scope-saved','page-quiz');h.event('answered');
  assert.equal(h.window.arrangeFirstGuideAnswerA('new-account',quiz),false,'no further question reordering during action tutorial');
});
test('the first stage guide ignores events from unrelated rooms or later stages', () => {
  const h=harness();h.window.scheduleFirstAnswerGuide('new-account',true);
  h.event('entered','', 'new-account',{roomId:'other-room',stage:2});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step,0);
  h.event('entered');h.event('question','', 'new-account',{roomId:'other-room'});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step,1);
  h.event('question');h.event('scope-saved','page-quiz');h.event('answered');h.page('battle');
  h.event('attack-selected','', 'new-account',{stage:2});
  assert.equal(JSON.parse(h.store.get(key('new-account'))).step,4);
});
