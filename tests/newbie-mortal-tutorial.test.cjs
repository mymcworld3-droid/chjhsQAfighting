const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const tutorial = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-v2.js'), 'utf8');

test('mortal-stage tutorial teaches a real-looking sample quiz without awarding cultivation', () => {
  assert.match(tutorial, /const VERSION = 2;/);
  assert.match(tutorial, /const FOUNDATION_SCORE = 10;/);
  assert.match(tutorial, /EXAMPLE_QUESTION = '範例：2 \+ 3 = \?'/);
  assert.match(tutorial, /新手範例 · 不計修為/);
  assert.match(tutorial, /requiresAnswer: true/);
  assert.match(tutorial, /exampleAnswered = true/);
  assert.match(tutorial, /if\(\(Number\(data\.stats\.totalScore\)\|\|0\)>=FOUNDATION_SCORE\)/);
  assert.doesNotMatch(tutorial, /applyCultivationReward/);
  assert.doesNotMatch(tutorial, /updateDoc\([^\n]*stats\.totalScore/);
});

test('mortal-stage tutorial teaches the existing report button without submitting the sample', () => {
  assert.match(tutorial, /target: '#btn-report'/);
  assert.match(tutorial, /requiresReport: true/);
  assert.match(tutorial, /showReportDemo/);
  assert.match(tutorial, /event\.stopImmediatePropagation\(\)/);
  assert.match(tutorial, /這次範例不會送到伺服器/);
  assert.match(tutorial, /答案明顯錯誤/);
  assert.match(tutorial, /題目或選項有歧義/);
});


test('tutorial teaches where features live before changing pages instead of teleporting', () => {
  assert.match(tutorial, /function currentPageId\(\)/);
  assert.match(tutorial, /function routeForStep\(step\)/);
  assert.match(tutorial, /target: '#btn-home-start'/);
  assert.match(tutorial, /\[data-target="page-settings"\]/);
  assert.match(tutorial, /\[data-target="page-home"\]/);
  assert.match(tutorial, /請點亮起的入口/);
  assert.match(tutorial, /event\.stopImmediatePropagation\(\)/);
  assert.match(tutorial, /navigate\(route\.destination\)/);
  assert.doesNotMatch(tutorial, /\n\s*navigate\(step\.page\);/);
});

test('tutorial route gate intercepts the real quiz entry so the sample does not start a real session', () => {
  assert.match(tutorial, /route\.destination === 'page-quiz'/);
  assert.match(tutorial, /installExampleQuiz\(\)/);
  assert.match(tutorial, /攔截原本 onclick/);
  assert.match(tutorial, /這顆「問道試煉」就是正式答題的入口/);
});

test('Dongfu tutorial waits until the player clicks the bottom navigation before opening sections', () => {
  assert.match(tutorial, /if \(!route && step\.settingsSection/);
  assert.match(tutorial, /window\.openDongfuSettingsSection\(step\.settingsSection/);
  assert.match(tutorial, /範圍、難度與個人設定都在「洞府」/);
});


test('mortal tutorial leaves the full Dongtian practical lesson for Qi-five', () => {
  assert.doesNotMatch(tutorial, /kicker: '第十一步 · 洞天入口'/);
  assert.match(tutorial, /kicker: '第十一步 · 築基'/);
  assert.match(tutorial, /煉氣五層時，系統會另外帶你完整實作洞天/);
  assert.match(tutorial, /煉氣五層會開啟洞天專屬教學/);
});
