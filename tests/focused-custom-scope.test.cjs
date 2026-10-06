'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { readFileSync } = require('node:fs');
const selector = readFileSync(require.resolve('../public/cultivation/curriculum-scope.js'), 'utf8');
const legacy = readFileSync(require.resolve('../public/main-legacy.js'), 'utf8');
const opportunity = require('../public/cultivation/opportunity-rules.js');

function customPicker() {
  const window = { soloSelectedUnits: [], soloComprehensiveUnits: [{ path: '英文', detail: '保留綜合範圍' }] };
  const context = vm.createContext({ window, grade: '國中二年級', subject: '數學',
    grades: ['國中二年級', '高中二年級', '國小三年級'], subjectOptions: () => ['數學', '數學A', '資訊科技', '藝術'],
    canonicalSubject: () => /^數學/.test(context.subject) ? '數學' : context.subject,
    selectedUnits: () => window.soloSelectedUnits, itemKey: u => JSON.stringify([u.path, u.detail, u.sub_topics]),
    notifySelectionList() { window.updated = true; } });
  const start = selector.indexOf('function addFocusedCustom('), end = selector.indexOf('function displayUnits(){', start);
  vm.runInContext(selector.slice(start, end) + '\nthis.addRange = addFocusedCustom;', context);
  return context;
}

test('focused custom ranges use the chosen course grade and preserve separate comprehensive scopes', () => {
  const picker = customPicker();
  assert.equal(picker.addRange('  一次函數的斜率  ').ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(picker.window.soloSelectedUnits[0])), {
    path: '數學/國中二年級/自訂/數學', detail: '一次函數的斜率', sub_topics: []
  });
  assert.equal(picker.window.updated, true); assert.equal(picker.window.soloComprehensiveUnits.length, 1);
  picker.grade = '高中二年級'; picker.subject = '數學A'; picker.addRange('向量');
  assert.equal(picker.window.soloSelectedUnits[1].path, '數學/高中二年級/自訂/數學A');
});

test('blank, overlong, duplicate and invalid custom ranges never change the selected list; capacity includes chapters', () => {
  const picker = customPicker();
  assert.equal(picker.addRange(' \n ').ok, false); assert.equal(picker.addRange('字'.repeat(91)).ok, false);
  picker.grade = '未知年級'; assert.equal(picker.addRange('範圍').ok, false); picker.grade = '國中二年級';
  picker.subject = '未選科目'; assert.equal(picker.addRange('範圍').ok, false); picker.subject = '數學';
  assert.equal(picker.window.soloSelectedUnits.length, 0);
  picker.addRange('一次函數'); assert.equal(picker.addRange(' 一次函數 ').ok, false);
  assert.equal(picker.window.soloSelectedUnits.length, 1);
  picker.window.soloSelectedUnits = Array.from({ length: 23 }, (_, i) => ({ path: '數學/八年級', detail: '章節' + i, sub_topics: [] }));
  assert.equal(picker.addRange('自訂末項').ok, true); assert.equal(picker.addRange('超出上限').ok, false);
  assert.equal(picker.window.soloSelectedUnits.length, 24);
});

test('saving focused custom ranges persists them and both solo quizzes and opportunity passages use their scope', async () => {
  const picker = customPicker(); picker.addRange('一次函數的斜率');
  const fields = Object.fromEntries(Object.entries({ 'set-display-name': '測試修士', 'set-level': '國中一年級',
    'set-strong': '數學', 'set-weak': '英文', 'set-source-mode': 'focused', 'set-source-final-value': 'ai', 'set-difficulty': 'medium' })
    .map(([key, value]) => [key, { value }]));
  const player = { profile: {}, stats: { rankLevel: 0, knowledgeMap: {} } }, writes = [], requests = [];
  const context = vm.createContext({ window: { ...picker.window, dispatchEvent() {} }, currentUserData: player, currentBankData: null,
    document: { getElementById: id => fields[id] || null, querySelector: () => null }, db: {}, auth: { currentUser: { uid: 'u1' } },
    doc: (_, collection, id) => ({ collection, id }), updateDoc: async (ref, value) => writes.push({ ref, value }),
    getCleanSubjects: async s => s, alert: () => { throw Error('unexpected validation error'); }, CustomEvent: class {},
    localStorage: { removeItem() {} }, syncSoloQuestionCache() {}, fillBuffer() {}, setTimeout() {},
    currentLang: 'zh', quizMetaFromRaw: () => ({}), console: { log() {}, error() {} },
    getRankName: () => '煉氣', getSmartDifficulty: () => 'medium', recentSoloQuestionContext: () => ({}), shuffleArray: a => a,
    fetch: async (_, options) => { requests.push(JSON.parse(options.body)); return { ok: true,
      json: async () => ({ text: JSON.stringify({ q: 'Q', correct: 'A', wrong: ['B', 'C', 'D'], exp: 'E' }) }) }; } });
  const saveStart = legacy.indexOf('window.saveProfile = async'), saveEnd = legacy.indexOf('async function switchToAI()', saveStart);
  vm.runInContext(legacy.slice(saveStart, saveEnd), context);
  assert.equal(await context.window.saveProfile(), true);
  assert.equal(writes.length, 1); assert.equal(writes[0].ref.id, 'u1');
  assert.equal(writes[0].value.gameSettings.focusedUnits[0].detail, '一次函數的斜率');
  assert.equal(writes[0].value.gameSettings.comprehensiveUnits, undefined, 'saving removes obsolete comprehensive custom ranges');
  const quizStart = legacy.indexOf('async function fetchOneQuestion() {'), quizEnd = legacy.indexOf('async function handleAnswer', quizStart);
  vm.runInContext(legacy.slice(quizStart, quizEnd) + '\nthis.fetchQuiz = fetchOneQuestion;', context);
  await context.fetchQuiz();
  assert.equal(requests[0].subject, '數學'); assert.equal(requests[0].specificTopic, '一次函數的斜率');
  assert.equal(requests[0].level, '國中二年級', 'selected grade overrides profile grade');
  const target = opportunity.chooseTarget(opportunity.normalizeScope(player), [], () => 0);
  assert.equal(target.detail, '一次函數的斜率'); assert.equal(target.level, '國中二年級');
});

test('opportunity passages retain every additional subject offered by the curriculum custom range controls', () => {
  for (const subject of ['自然科學', '藝術', '健康與體育', '本土語文', '綜合活動', '資訊科技', '綜合']) {
    const player = { profile: { educationLevel: '高中職' }, gameSettings: { sourceMode: 'focused',
      focusedUnits: [{ path: subject + '/國小三年級/自訂/' + subject, detail: '本課程的生活應用', sub_topics: [] }] } };
    const target = opportunity.chooseTarget(opportunity.normalizeScope(player), [], () => 0);
    assert.equal(target.subject, subject); assert.equal(target.level, '國小三年級'); assert.equal(target.detail, '本課程的生活應用');
  }
});
