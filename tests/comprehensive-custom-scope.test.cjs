'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { readFileSync } = require('node:fs');
const read = p => readFileSync(require.resolve('../public/' + p), 'utf8');
const legacy = read('main-legacy.js'), selector = read('cultivation/curriculum-scope.js');

test('random quizzes ignore saved custom ranges while focused quizzes still honor theirs', async () => {
  const selected = { path: '數學/國中二年級/自訂/數學', detail: '一次函數的斜率', sub_topics: [] };
  const requests = [], player = { gameSettings: { sourceMode: 'random', difficulty: 'medium', comprehensiveUnits: [selected],
    focusedUnits: [{ path: '歷史/七年級', detail: '歷史章節' }] },
    profile: { educationLevel: '國中一年級', weakSubjects: '' }, stats: { rankLevel: 0, knowledgeMap: {} } };
  const context = vm.createContext({ currentUserData: player, currentLang: 'zh', window: {}, quizMetaFromRaw: () => ({}), console: { log() {}, error() {} },
    getRankName: () => '煉氣', getSmartDifficulty: () => 'medium', recentSoloQuestionContext: () => ({}),
    shuffleArray: a => a, fetch: async (_, input) => { requests.push(JSON.parse(input.body)); return { ok: true,
      json: async () => ({ text: JSON.stringify({ q: 'Q', correct: 'A', wrong: ['B','C','D'], exp: 'E' }) }) }; } });
  const start = legacy.indexOf('async function fetchOneQuestion() {'), end = legacy.indexOf('async function handleAnswer', start);
  vm.runInContext(legacy.slice(start, end) + '\nthis.fetchQuiz = fetchOneQuestion;', context);
  await context.fetchQuiz();
  assert.equal(requests[0].specificTopic, undefined);
  assert.equal(requests[0].level, '國中一年級');
  assert.ok(requests[0].subject);
  const cacheSource = legacy.slice(legacy.indexOf('function soloQuestionScope() {'), legacy.indexOf('function syncSoloQuestionCache() {'));
  vm.runInContext(cacheSource + '\nthis.scope = soloQuestionScope;', context);
  const first = context.scope();
  assert.equal(JSON.parse(first).units.length, 0);
  player.gameSettings.comprehensiveUnits[0].detail = '英語時態';
  assert.equal(context.scope(), first, 'obsolete ranges no longer change the random cache identity');
  player.gameSettings.sourceMode = 'focused';
  await context.fetchQuiz();
  assert.equal(requests[1].subject, '歷史');
  assert.match(requests[1].specificTopic, /歷史章節/);
  assert.notEqual(context.scope(), first);
});

test('comprehensive practice has no custom controls and does not display focused selections', () => {
  assert.doesNotMatch(read('index.html'), /cs-custom-subject|cs-custom-message|隨機或自訂主題/);
  assert.doesNotMatch(selector, /cs-custom-panel|cs-add-custom|function addCustom\(/);
  const fields = { 'set-source-mode': { value: 'random' } };
  const focused = [{ path: '數學/七年級', detail: '原章節' }];
  const context = vm.createContext({ window: { soloSelectedUnits: focused }, el: id => fields[id], selectedUnits: () => focused });
  const start = selector.indexOf('function displayUnits(){'), end = selector.indexOf('function removeSelectedAt(', start);
  vm.runInContext(selector.slice(start, end), context);
  assert.equal(context.displayUnits().length, 0);
  fields['set-source-mode'].value = 'focused';
  assert.equal(context.displayUnits(), focused);
  fields['set-source-mode'].value = 'bank';
  assert.equal(context.displayUnits().length, 0);
});

test('obsolete comprehensive ranges cannot satisfy the scope quest', () => {
  const quest = require('../public/cultivation/quest-rules.js');
  const user = { stats: { totalScore: 0 }, gameSettings: { sourceMode: 'random', comprehensiveUnits: [{ path: '綜合', detail: '複習' }] } };
  const progress = { version: 2, pathClaimed: ['path-story-prologue-enter-sect'] };
  assert.equal(quest.view(user, progress).path.claimable, false);
  user.gameSettings.focusedUnits = [{ path: '數學', detail: '方程式' }];
  assert.equal(quest.view(user, progress).path.claimable, true);
});
