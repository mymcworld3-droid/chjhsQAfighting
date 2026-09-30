const test = require('node:test');
const assert = require('node:assert/strict');
const { questionQualityIssue, removeUnstableOptionLabels } = require('../question-quality.cjs');

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

test('rejects answer lists embedded in the stem and removes unstable letter references', () => {
  assert.match(questionQualityIssue({ q: '何者正確？(A) 一 (B) 二 (C) 三 (D) 四' }), /題幹/);
  const explanation = removeUnstableOptionLabels('選項A強調形影不離；選項(B)的說法不同；(C)是誤解。');
  assert.doesNotMatch(explanation, /選項[ABCD]|選項\([ABCD]\)|\([ABCD]\)/);
  assert.match(explanation, /相關敘述強調形影不離/);
});

test('removes Chinese and numeric choice order without changing solution steps or quantities', () => {
  const explanation = removeUnstableOptionLabels('第一步先算500公尺。選項二的路網分析不適合；第一項錯誤；錯誤選項三錯誤；答案4是正解。');
  assert.equal(explanation, '第一步先算500公尺。相關敘述的路網分析不適合；相關敘述錯誤；相關敘述錯誤；相關敘述是正解。');
});
