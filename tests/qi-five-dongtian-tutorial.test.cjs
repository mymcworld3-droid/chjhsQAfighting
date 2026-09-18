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

test('Qi-five Dongtian tutorial unlocks at five cultivation and does not teleport the player to Dongfu', () => {
  assert.match(tutorial, /SCORE_REQUIRED = 5/);
  assert.match(tutorial, /phase === 'settings'/);
  assert.match(tutorial, /\[data-target="page-settings"\]/);
  assert.match(tutorial, /請自己點擊底部導覽的「洞府」/);
  assert.doesNotMatch(tutorial, /switchToPage/);
});

test('tutorial carefully explains creation, amount, single-choice batching and previous-question de-duplication', () => {
  assert.match(tutorial, /圖片、文字都可以煉成題庫/);
  assert.match(tutorial, /少＝10 題/);
  assert.match(tutorial, /中＝15～20 題/);
  assert.match(tutorial, /多＝25～30 題/);
  assert.match(tutorial, /四選一單選/);
  assert.match(tutorial, /每 5 題一批/);
  assert.match(tutorial, /後一批會讀取前面所有已生成題目/);
});

test('tutorial creates a private sample, requires actual play, then requires actual deletion', () => {
  assert.match(tutorial, /window\.ensureDongtianTutorialSample/);
  assert.match(tutorial, /phase = 'play'/);
  assert.match(tutorial, /data-dt-play/);
  assert.match(tutorial, /dongtian:completed/);
  assert.match(tutorial, /dongtian:session-closed/);
  assert.match(tutorial, /phase = 'delete'/);
  assert.match(tutorial, /data-dt-delete/);
  assert.match(tutorial, /dongtian:deleted/);
  assert.match(tutorial, /sampleDeleted:true/);
  assert.match(dongtian, /name: '引道小洞天'/);
  assert.match(dongtian, /tutorialOnly: true/);
  assert.match(dongtian, /status: 'tutorial'/);
});

test('Dongtian first completion grants cultivation from correct answers as well as spirit stones', () => {
  assert.match(dongtian, /FIRST_COMPLETION_CULTIVATION_CORRECT_STEP = 5/);
  assert.match(dongtian, /function firstCompletionCultivation\(correctCount\)/);
  assert.match(dongtian, /'stats\.totalScore': increment\(cultivationReward\)/);
  assert.match(dongtian, /cultivationAdded: cultivationReward/);
  assert.match(dongtian, /每答對 \$\{FIRST_COMPLETION_CULTIVATION_CORRECT_STEP\} 題 \+1/);
});

test('Qi-five tutorial module loads after normal newbie tutorial and after Dongtian', () => {
  const dongtianIndex = main.indexOf("'./cultivation/dongtian.js'");
  const newbieIndex = main.indexOf("'./cultivation/newbie-tutorial-v2.js'");
  const layoutIndex = main.indexOf("'./cultivation/newbie-tutorial-layout-fix.js'");
  const qiFiveIndex = main.indexOf("'./cultivation/qi-five-dongtian-tutorial.js'");
  assert.ok(dongtianIndex >= 0 && newbieIndex > dongtianIndex);
  assert.ok(layoutIndex > newbieIndex && qiFiveIndex > layoutIndex);
});
