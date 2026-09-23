const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const tutorial = read('public/cultivation/qi-five-dongtian-tutorial.js');
const dongtian = read('public/cultivation/dongtian.js');
const main = read('public/main.js');

test('Qi-five Dongtian tutorial unlocks at five cultivation and never teleports to Dongfu', () => {
  assert.match(tutorial, /SCORE_REQUIRED = 5/);
  assert.match(tutorial, /phase === 'settings'/);
  assert.match(tutorial, /\[data-target="page-settings"\]/);
  assert.match(tutorial, /請自己點擊底部導覽的「洞府」/);
  assert.doesNotMatch(tutorial, /switchToPage/);
});

test('Qi-five tutorial carefully explains source material, amount, single-choice batches and de-duplication', () => {
  assert.match(tutorial, /圖片、文字都可以煉成洞天/);
  assert.match(tutorial, /少＝10～14 題/);
  assert.match(tutorial, /中＝15～20 題/);
  assert.match(tutorial, /多＝21～30 題/);
  assert.match(tutorial, /四選一/);
  assert.match(tutorial, /每批最多 5 題，末批依剩餘題數/);
  assert.match(tutorial, /後一批會帶入前面全部題目/);
});

test('Qi-five tutorial reuses the one-question private Dongtian demo, requiring play, return, then deletion', () => {
  assert.match(tutorial, /window\.prepareNewbieDongtianDemo/);
  assert.match(tutorial, /newbie:dongtian-demo-started/);
  assert.match(tutorial, /newbie:dongtian-demo-completed/);
  assert.match(tutorial, /newbie:dongtian-demo-returned/);
  assert.match(tutorial, /newbie:dongtian-demo-deleted/);
  assert.match(tutorial, /phase='delete'/);
  assert.match(tutorial, /data-dt-tutorial-play/);
  assert.match(tutorial, /data-dt-tutorial-delete/);
  assert.match(dongtian, /id: 'newbie-private-dongtian-demo'/);
  assert.match(dongtian, /tutorialOnly: true/);
  assert.match(dongtian, /private: true/);
  assert.match(dongtian, /TUTORIAL-DT-001/);
  assert.match(dongtian, /教學體驗 1 題/);
  assert.match(tutorial, /請完成這 1 題、閱讀解析/);
});

test('formal Dongtian first completion grants cultivation from correct answers as well as spirit stones', () => {
  assert.doesNotMatch(dongtian, /FIRST_COMPLETION_CULTIVATION_CORRECT_STEP/);
  assert.match(dongtian, /function firstCompletionCultivation\(correctCount\)/);
  assert.match(dongtian, /'stats\.totalScore': increment\(cultivationReward\)/);
  assert.match(dongtian, /cultivationAdded: cultivationReward/);
  assert.match(dongtian, /每答對 1 題 \+1 修為/);
  assert.doesNotMatch(dongtian, /答對至少 1 題保底 \+1/);
});

test('private tutorial cave has no formal rewards while teaching the real formal reward rule', () => {
  const finish = dongtian.slice(dongtian.indexOf('async function finishDongtian'), dongtian.indexOf('async function completeProgress'));
  const tutorialBranch = finish.slice(finish.indexOf('if (s.tutorialOnly)'), finish.indexOf('const firstCompletionReward'));
  assert.match(tutorialBranch, /教學範例不發正式獎勵/);
  assert.doesNotMatch(tutorialBranch, /completeProgress\(/);
  assert.match(tutorialBranch, /正式洞天首次通關每題 100 靈石/);
  assert.match(tutorialBranch, /每答對 1 題 \+1 修為/);
});

test('legacy Qi-five Dongtian tutorial is no longer auto-loaded because onboarding is part of the main newbie tutorial', () => {
  const dongtianIndex = main.indexOf("'./cultivation/dongtian.js'");
  const newbieIndex = main.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  const qiFiveIndex = main.indexOf("'./cultivation/qi-five-dongtian-tutorial.js'");
  assert.ok(dongtianIndex >= 0 && newbieIndex > dongtianIndex);
  assert.equal(qiFiveIndex, -1);
});
