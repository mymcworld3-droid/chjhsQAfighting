const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const source=readFileSync('public/cultivation/five-immortals.js','utf8');
const server=readFileSync('immortal-challenge-api.cjs','utf8');
test('Five Immortals retains realm gate and school-cohort board',()=>{
  assert.match(source,/const TRIBULATION_SCORE = 1268/);
  assert.match(source,/currentScore\(\) >= TRIBULATION_SCORE/);
  assert.match(source,/fs\.where\('cohort', '==', cohort\)/);
  assert.match(server,/cohort==='elementary'\?'國小高年級':'國中三年級'/);
});
test('challenge submits choices and tactics, never locally awards an immortal seat',()=>{
  assert.match(source,/authenticatedMainFetch/);
  assert.match(source,/quizMode: 'immortal-avatar'/);
  assert.match(source,/\/api\/immortals\/challenge\/answer/);
  assert.match(source,/tactic:run\.tactic/);
  assert.doesNotMatch(source,/fs\.runTransaction|challengeScore:|streak/);
  assert.match(server,/outcome\.won/);
});
test('battle presents health, real build, telegraphed intent, tactics and round review',()=>{
  for(const label of ['fi-hp','fi-build','fi-intent','data-tactic','fi-review','fi-next'])assert.ok(source.includes(label));
  assert.match(source,/答錯僅失去該回合出手/);
  assert.match(source,/24 回合/);
  assert.match(source,/再次問鼎/);
});
test('offline defender can be updated with a stored build and a selected style',()=>{
  assert.match(source,/管理化身/);assert.match(source,/更新守擂化身/);
  assert.match(source,/\/api\/immortals\/challenge\/configure/);
  assert.match(source,/仙主離線也會自動守擂/);
  assert.match(source,/recentDefenses/);
});
test('help is collapsed, keyboard-accessible and explains one-seat and True Immortal rules',()=>{
  assert.match(source,/id="five-immortals-help"/);assert.match(source,/id="five-immortals-guide"[^>]*hidden/);
  assert.match(source,/guide\.hidden = !guide\.hidden/);assert.match(source,/aria-expanded/);
  assert.match(source,/每名修士同時只能據有一席仙位/);assert.match(source,/1868 修為並在榜/);
  assert.match(source,/aria-modal="true"/);assert.match(source,/event\.key === 'Escape'/);
  assert.match(source,/event\.key !== 'Tab'/);
});
