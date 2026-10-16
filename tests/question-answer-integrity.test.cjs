'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { questionIntegrityIssue, arithmeticExpected, explicitSolutionAnswer } =
  require('../question-answer-integrity.cjs');
const { questionQualityIssue } = require('../question-quality.cjs');

test('an explicit solution answer cannot disagree with the stored correct choice', () => {
  const good = { q: '下列何者正確？', correct: 'A', wrong: ['B', 'C', 'D'], exp: '正確答案：A，因為 A 符合題意。' };
  const bad = { ...good, exp: '正確答案：B，所以選 B。' };
  assert.equal(questionIntegrityIssue(good), '');
  assert.match(questionIntegrityIssue(bad), /解析所標示的最終答案/);
  assert.match(questionQualityIssue(bad), /解析所標示的最終答案/);
  assert.deepEqual(explicitSolutionAnswer('答案為 4，因此正解為 4。'), ['4', '4']);
});

test('a mathematically wrong numeric answer cannot be published even if the explanation repeats it', () => {
  const wrong = { q: '2 + 2 = ?', correct: '5', wrong: ['3', '4', '6'], exp: '2 + 2 = 5。' };
  assert.equal(arithmeticExpected(wrong.q), '4');
  assert.match(questionIntegrityIssue(wrong), /數值答案/);
  assert.match(questionQualityIssue(wrong), /數值答案/);
  assert.equal(questionIntegrityIssue({ ...wrong, correct: '4', wrong: ['3', '5', '6'], exp: '2 + 2 = 4。' }), '');
  // We must not interpret arbitrary expressions or intermediate algebra as a simple answer.
  assert.equal(arithmeticExpected('已知 x^2 + 2x = 4，求 x'), null);
});

test('review commentary inside the learning explanation is not a repaired question', () => {
  const original = { q: '關於函數，下列何者正確？', correct: '連續', wrong: ['可微', '不可積', '無界'], exp: '原答案有誤，應修正為連續。' };
  assert.match(questionIntegrityIssue(original), /解析包含題目出錯/);
  assert.match(questionIntegrityIssue({ ...original, exp: '本題有錯，應更正答案。' }), /解析包含題目出錯/);
  assert.equal(questionIntegrityIssue({ ...original, exp: '連續函數在閉區間上有界，故此敘述成立。' }), '');
});

test('exactly one correct choice is required after whitespace and Unicode normalization', () => {
  const x = { q: '選出 1 + 1 的正解', correct: '2', wrong: ['２', '3', '4'], exp: '2 是正解。' };
  assert.match(questionIntegrityIssue(x), /結構有誤/);
  assert.equal(questionIntegrityIssue({ ...x, wrong: ['5', '3', '4'] }), '');
});
