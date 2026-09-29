const test = require('node:test');
const assert = require('node:assert/strict');
const { questionQualityIssue } = require('../question-quality.cjs');

test('rejects questions that depend on an absent figure', () => {
  assert.match(questionQualityIssue({ q: '請根據如附圖所示的速度圖判斷位移？' }), /圖片/);
});

test('rejects explanations that correct the stored answer or admit contradictory data', () => {
  assert.match(questionQualityIssue({ q: '何者不同？', correct: '巧奪天工', wrong: ['江郎才盡'], exp: '修正：正確答案應為江郎才盡。' }), /修正/);
  assert.match(questionQualityIssue({ q: '溶解度為何？', exp: '題目中步驟四數據與前三步驟存在邏輯衝突。' }), /矛盾/);
});

test('accepts a self-contained question with consistent answer and explanation', () => {
  assert.equal(questionQualityIssue({ q: '水電解產生氫氧體積比為何？', correct: '2:1', wrong: ['1:1', '1:2', '3:1'], exp: '水電解的反應係數為 2H2O → 2H2 + O2，因此體積比為 2:1。' }), '');
});
