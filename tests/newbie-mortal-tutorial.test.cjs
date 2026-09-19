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
  assert.match(tutorial, /先找到「\$\{label\}」在哪裡/);
  assert.match(tutorial, /仙府/);
  assert.doesNotMatch(tutorial, /首頁/);
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


test('mortal newbie tutorial carefully teaches the complete Dongtian lifecycle', () => {
  assert.match(tutorial, /第十一步 · 洞天入口/);
  assert.match(tutorial, /請親自點亮起的「洞天」入口/);
  assert.match(tutorial, /圖片與文字都可以煉成洞天/);
  assert.match(tutorial, /少＝10 題/);
  assert.match(tutorial, /中＝15～20 題/);
  assert.match(tutorial, /多＝25～30 題/);
  assert.match(tutorial, /四選一單選題/);
  assert.match(tutorial, /每 5 題生成一批/);
  assert.match(tutorial, /後一批會帶入前面全部已生成題目/);
});

test('mortal newbie tutorial requires actual private Dongtian play, return, and deletion', () => {
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
});

test('mortal newbie tutorial explains real Dongtian rewards while the sample remains reward-free and private', () => {
  assert.match(tutorial, /每題 100、最低 1000/);
  assert.match(tutorial, /每答對 5 題 \+1/);
  assert.match(tutorial, /私人教學範例完全不發正式獎勵、不掉材料，也不寫入歷史紀錄/);
  assert.match(tutorial, /教學範例已刪除，而且從頭到尾都沒有公開/);
});


test('the navigation gate highlights the actual bottom-bar buttons and leaves them clickable', () => {
  const layout = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-layout-fix.js'), 'utf8');
  assert.match(tutorial, /#bottom-nav #nav-grid > button\[data-target="page-home"\]/);
  assert.match(tutorial, /#bottom-nav #nav-grid > button\[data-target="page-settings"\]/);
  assert.match(tutorial, /const genericTarget = `#bottom-nav #nav-grid > button/);
  assert.match(tutorial, /spot\.dataset\.navigation = String\(!!step\.routeGate && !!el\.closest\('#bottom-nav'\)\)/);
  assert.match(tutorial, /if \(highlighted && !highlighted\.closest\('#bottom-nav'\)\)/);
  assert.match(tutorial, /navigate\(route\.destination\)/);
  assert.match(layout, /spot\.dataset\.navigation === 'true'/);
  assert.match(layout, /candidate\(centeredLeft, target\.top - height - GAP, width, height, 'above', 0\)/);
});
