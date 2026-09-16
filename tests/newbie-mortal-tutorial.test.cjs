const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const tutorial = readFileSync(join(__dirname, '../public/cultivation/newbie-tutorial-v2.js'), 'utf8');

test('mortal-stage tutorial teaches a real-looking sample quiz without awarding cultivation', () => {
  assert.match(tutorial, /const VERSION = 2;/);
  assert.match(tutorial, /const FOUNDATION_SCORE = 60;/);
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
