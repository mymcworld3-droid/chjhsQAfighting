const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const scopeSource = readFileSync(join(__dirname, '../public/cultivation/battle-question-scope.js'), 'utf8');
const battleSource = readFileSync(join(__dirname, '../public/cultivation/battle-mode-v2.js'), 'utf8');
const serverSource = readFileSync(join(__dirname, '../server.js'), 'utf8');

function loadScope() {
  const context = { console };
  const code = scopeSource.replace(/^export /gm, '') +
    '\nthis.__scope={normalizeBattleSubject,snapshotBattleKnowledge,resolveBattleKnowledge,pickBattleKnowledge};';
  vm.runInNewContext(code, context);
  return context.__scope;
}

test('battle knowledge comes from profile and actual focused game settings', () => {
  const s = loadScope();
  const player = s.snapshotBattleKnowledge({
    profile: { educationLevel: '國中二年級', weakSubjects: '數學，英文' },
    gameSettings: { sourceMode: 'focused', difficulty: 'hard', focusedUnits: [
      { path: '數學/八上/單元.json', detail: '一元一次方程式', sub_topics: ['移項', '應用'] }
    ] }
  });
  assert.equal(player.grade, 8);
  assert.equal(player.focused, true);
  assert.equal(player.difficulty, 'hard');
  assert.equal(player.units[0].subject, '數學');
  assert.match(player.units[0].topic, /一元一次方程式/);
  assert.equal(JSON.stringify(player.weakSubjects), JSON.stringify(['數學', '英文']));
});

test('two focused players share only actual overlapping units and lower grade', () => {
  const s = loadScope();
  const host = s.snapshotBattleKnowledge({ profile: { educationLevel: '國中三年級' }, gameSettings: {
    sourceMode: 'focused', difficulty: 'hard', focusedUnits: [
      { path: '數學/八上.json', detail: '函數' }, { path: '英文/八上.json', detail: '時態' }
    ] } });
  const guest = s.snapshotBattleKnowledge({ profile: { educationLevel: '國中二年級' }, gameSettings: {
    sourceMode: 'focused', difficulty: 'easy', focusedUnits: [{ path: '數學/八上.json', detail: '函數' }]
  } });
  const shared = s.resolveBattleKnowledge(host, guest);
  assert.equal(shared.level, '國中二年級');
  assert.equal(shared.policy, 'common-units');
  assert.equal(shared.units.length, 1);
  assert.equal(shared.difficulty, 'medium');
  const choice = s.pickBattleKnowledge(shared, 1);
  assert.equal(choice.subject, '數學');
  assert.equal(choice.specificTopic, '函數');
});

test('a shared upper-grade unit is excluded when the lower player has not reached it', () => {
  const s = loadScope();
  const selected = [{ path: '數學/八上/代數.json', detail: '一元一次方程式' }];
  const low = s.snapshotBattleKnowledge({ profile: { educationLevel: '國中一年級' }, gameSettings: {
    sourceMode: 'focused', focusedUnits: selected
  } });
  const high = s.snapshotBattleKnowledge({ profile: { educationLevel: '國中二年級' }, gameSettings: {
    sourceMode: 'focused', focusedUnits: selected
  } });
  const shared = s.resolveBattleKnowledge(low, high);
  assert.equal(shared.grade, 7);
  assert.equal(shared.units.length, 0);
  assert.equal(s.pickBattleKnowledge(shared, 1).specificTopic, '');
});

test('no mutual units switches to mutual subjects, then general subjects without borrowing a private unit', () => {
  const s = loadScope();
  const host = { grade: 7, focused: true, units: [{ subject: '數學', key: '數學:abc', topic: 'abc' }] };
  const guest = { grade: 9, focused: true, units: [{ subject: '數學', key: '數學:def', topic: 'def' }] };
  const shared = s.resolveBattleKnowledge(host, guest);
  assert.equal(shared.units.length, 0);
  assert.equal(s.pickBattleKnowledge(shared, 1).specificTopic, '');
  assert.equal(s.pickBattleKnowledge(shared, 1).subject, '數學');
  guest.units = [{ subject: '英文', key: '英文:def', topic: 'def' }];
  const general = s.resolveBattleKnowledge(host, guest);
  assert.equal(general.units.length, 0);
  assert.ok(general.subjects.length > 1);
});

test('battle rotates one shared question range per round and stores recent questions', () => {
  const s = loadScope();
  const choice = s.pickBattleKnowledge({ subjects: ['數學', '國文'], level: '國中一年級' }, 2);
  assert.equal(choice.subject, '國文');
  assert.match(battleSource, /questionHistory: \[\.\.\.\(Array\.isArray\(fresh\.questionHistory\)/);
  assert.match(battleSource, /avoidQuestions/);
  assert.match(serverSource, /isTooSimilarQuestion\(parsed\.q, previousQuestions\)/);
  assert.match(battleSource, /avoidQuestionMeta/);
  assert.match(battleSource, /template_id/);
  assert.match(serverSource, /不得跨科、超綱/);
});

test('PvP normalizes correct/wrong answer payloads and refuses unrelated arithmetic fallback', () => {
  assert.match(battleSource, /opts = \[source\.correct, \.\.\.source\.wrong\]/);
  assert.match(battleSource, /new Set\(choices\.map/);
  assert.match(battleSource, /retain(?:ing)? scope/);
  assert.doesNotMatch(battleSource, /function fallbackQuestion/);
  assert.match(serverSource, /wrong\.length !== 3/);
});
