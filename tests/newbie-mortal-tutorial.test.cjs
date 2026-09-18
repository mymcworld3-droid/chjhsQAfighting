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


test('newbie tutorial teaches the full Dongtian lifecycle without teleporting past the entrance', () => {
  assert.match(tutorial, /第十一步 · 洞天入口/);
  assert.match(tutorial, /target: '#dongtian-card \.dongfu-collapse-head, #dongtian-launcher-card \.dt-entry-head'/);
  assert.match(tutorial, /requiresDongtianOpen: true/);
  assert.match(tutorial, /圖片或文字都能煉成洞天/);
  assert.match(tutorial, /少量是 <strong>10 題<\/strong>/);
  assert.match(tutorial, /中量由 AI 在 <strong>15～20 題<\/strong>/);
  assert.match(tutorial, /大量由 AI 在 <strong>25～30 題<\/strong>/);
  assert.match(tutorial, /每 5 題一批/);
  assert.match(tutorial, /正式洞天每題都是四選一單選題/);
});

test('newbie tutorial creates a private sample, makes the player finish it, return, and delete it', () => {
  assert.match(tutorial, /prepareDongtianDemo: true/);
  assert.match(tutorial, /data-dt-tutorial-card/);
  assert.match(tutorial, /data-dt-tutorial-play/);
  assert.match(tutorial, /requiresDongtianStart: true/);
  assert.match(tutorial, /requiresDongtianComplete: true/);
  assert.match(tutorial, /requiresDongtianReturn: true/);
  assert.match(tutorial, /data-dt-tutorial-delete/);
  assert.match(tutorial, /requiresDongtianDelete: true/);
  assert.match(tutorial, /newbie:dongtian-demo-started/);
  assert.match(tutorial, /newbie:dongtian-demo-completed/);
  assert.match(tutorial, /newbie:dongtian-demo-returned/);
  assert.match(tutorial, /newbie:dongtian-demo-deleted/);
  assert.match(tutorial, /教學專用 · 不公開/);
});

test('newbie tutorial stays above the full-screen Dongtian runner and cleans private demo on skip or completion', () => {
  assert.match(tutorial, /#newbie-tutorial-layer\{position:fixed;inset:0;z-index:12500/);
  assert.match(tutorial, /window\.deleteNewbieDongtianDemo\?\.\(\{ silent: true \}\)/);
  assert.match(tutorial, /function bindDongtianTutorialEvents\(\)/);
});
