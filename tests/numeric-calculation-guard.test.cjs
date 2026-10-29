'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { numericExpression, numericCalculationIssue: issue } = require('../numeric-calculation-guard.cjs');
const { questionQualityIssue } = require('../question-quality.cjs');
const { arithmeticExpected, questionIntegrityIssue } = require('../question-answer-integrity.cjs');

const reported = {
  q: String.raw`已知 $|\vec a|=3$、$|\vec b|=5$ 且 $\vec a\cdot\vec b=12$，求 $|\vec a+\vec b|$。`,
  correct: String.raw`$\sqrt{38}$`, wrong: ['8', '38', String.raw`$\sqrt{34}$`],
  exp: String.raw`利用向量長度的平方公式展開，計算 $|\vec a+\vec b|^2=|\vec a|^2+2(\vec a\cdot\vec b)+|\vec b|^2=3^2+2(12)+5^2=9+24+25=38$，開根號後得到長度為 $\sqrt{38}$。答案為 $\sqrt{38}$。`
};

test('the reported vector sum is blocked even when both stored answer and conclusion repeat sqrt(38)', () => {
  assert.match(questionIntegrityIssue(reported), /數值等式.*9\+24\+25 = 38/);
  assert.match(questionQualityIssue(reported), /數值等式/);
  const repaired = {...reported, correct: String.raw`$\sqrt{58}$`, exp: reported.exp.replaceAll('38', '58')};
  assert.equal(questionQualityIssue(repaired), '');
  assert.match(questionQualityIssue({...repaired, exp: reported.exp}), /數值等式/,
    'changing only the choice cannot hide the bad computation');
});

test('arithmetic grammar follows precedence, signs, implicit group multiplication and exact decimals', () => {
  for (const [input, expected] of [
    ['9+24+25',58],['3^2+2(12)+5^2',58],['2+3*4',14],['(2+3)*4',20],
    ['-3^2',-9],['(-3)^2',9],['2^3^2',512],['2^-3',.125],['0.1+0.2',.3],
    [String.raw`\frac{1}{3}+\dfrac{2}{3}`,1], [String.raw`\frac{2+3}{5}`,1],
    [String.raw`\sqrt{3^2+(-4)^2}`,5], [String.raw`\frac{|6-4+5|}{5}`,1.4],
    ['√(9)+2√(4)',7], ['3²+2(12)+5²',58], ['２×（３＋４）',14]
  ]) assert.equal(numericExpression(input)?.value, expected, input);
  assert.deepEqual(numericExpression('0.1+0.2'), {n:3n,d:10n,value:.3});
});

test('every adjacent numeric link is checked, including before a symbolic result and after symbolic premises', () => {
  for (const exp of [
    '代入得 $s=3^2+2(12)+5^2=38$。',
    '代入得 $s=9+24+25=38=t$。',
    '代入得 $s=9+24+25=58=38$。',
    '代入得 $s=3^2+2(12)+5^2=9+24+25=38$。',
    '相加得到 9 + 24 + 25 = 38。',
    '相加得到 $9+24+25$ = $38$。',
    String.raw`相加得到 \(9+24+25=38\)。`,
    String.raw`相加得到 \[9+24+25=38\]。`,
    '相加得到 $$9+24+25=38$$。',
    '相加得到 9+24+25=38.',
    String.raw`代入得 $\frac{9+24+25}{2}=19$。`,
    String.raw`代入得 $\sqrt{58}=\sqrt{38}$。`,
    '代入得 $3²+2(12)+5²=38$。'
  ]) assert.match(issue(exp), /數值等式/, exp);
});

test('correct fractions, roots, absolute values and small or negative values are accepted', () => {
  for (const exp of [
    '相加得到 $9+24+25=58$。',
    String.raw`計算 $\frac{1}{3}+\frac{2}{3}=1$。`,
    String.raw`計算 $\frac{|6-4+5|}{\sqrt{3^2+(-4)^2}}=\frac{7}{5}=1.4$。`,
    String.raw`計算 $\sqrt{2}^2=2$。`,
    String.raw`計算 $2\sqrt{2}=\sqrt{8}$。`,
    '計算 $0.1+0.2=0.3$。', '計算 $2^-3=0.125$。',
    '計算 $-3^2=-9$。', '計算 $10^{-12}+10^{-12}=2*10^{-12}$。'
  ]) assert.equal(issue(exp), '', exp);
  assert.match(issue('計算 $10^{-12}+10^{-12}=3*10^{-12}$。'), /數值等式/);
});

test('unknown notation is never partially parsed into an apparently false numeric assertion', () => {
  for (const exp of [
    '由 $x+9+24+25=38$ 可求 x。', '由 $π+3=6.14$ 可得。',
    String.raw`由 $\sin(30)=0.5$ 可得。`, String.raw`由 $\sqrt[3]{8}=2$ 可得。`,
    String.raw`取長度 $3\mathrm{m}=300\mathrm{cm}$。`,
    '由 $x_1=2$ 可得。', '由 $F′=2$ 可得。', '質量為 $1,000=1000$。',
    '比例 $1:2=0.5$。', '比例 $20%=0.2$。', '分數 $½=0.5$。',
    String.raw`帶分數 $2\frac{1}{2}=2.5$。`, '由 $π=3$ 可得。',
    '若甲+3=4，則甲為 1。', '若甲 + 3 = 4，則甲為 1。', '若甲(3+4)=14，則甲為 2。'
  ]) assert.equal(issue(exp), '', exp);
});

test('quotations, explicit error examples, inequalities and rounding are not asserted as exact calculations', () => {
  for (const exp of [
    '不能寫成 $9+24+25=38$。', '「9+24+25=38」是不成立的。',
    '常見錯誤是 $9+24+25=38$。', '計算結果約為 $1/3=0.333$。',
    '取小數點後兩位，$1/3=0.33$。', String.raw`計算 $1/3\approx0.33$。`,
    '反例：$1+1≠3$。', 'Incorrect: 1+1=3.', 'Rounded to two places: 1/3=0.33.'
  ]) assert.equal(issue(exp), '', exp);
});

test('pure arithmetic questions use the whole expression rather than its first operation', () => {
  for (const [stem, answer] of [['2 + 2 = ?', '4'], ['計算 9+24+25 的值。','58'],
    ['計算 $3^2+2(12)+5^2$ 的值。','58'], ['算出 (2+3)*4 的結果。','20']])
    assert.equal(arithmeticExpected(stem), answer, stem);
  for (const stem of ['已知 x^2 + 2x = 4，求 x','計算 2+3x 的值。','計算 1+2 時小明寫成 5，哪裡錯？',
    '已知甲的數量為 9+24+25，求甲的一半？']) assert.equal(arithmeticExpected(stem),null,stem);
  const good={q:'計算 9+24+25 的值。',correct:'58',wrong:['38','33','48'],exp:'計算 $9+24+25=58$。答案為 58。'};
  assert.equal(questionQualityIssue(good),'');
  assert.equal(arithmeticExpected('計算 3²+2(12)+5² 的值。'), '58');
  assert.equal(questionQualityIssue({...good,q:'計算 3²+2(12)+5² 的值。',exp:'計算 $3²+2(12)+5²=58$。答案為 58。'}),'');
});

test('hostile, undefined or excessive expressions fail closed without executing code or blocking the process', () => {
  for (const input of ['process.exit()', 'globalThis.pwned=1', '1/0', '0^0', String.raw`\sqrt{-1}`,
    '9^999999', '2^12^12', '('.repeat(500)+'1'+')'.repeat(500), '-'.repeat(100)+'1',
    '1+'.repeat(500)+'1', '1'.repeat(5000), '1 2', '2**3', '1//2']) assert.equal(numericExpression(input),null,input.slice(0,60));
});
