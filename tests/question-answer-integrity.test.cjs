'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { questionIntegrityIssue, arithmeticExpected, explicitSolutionAnswer, numericAnswer } =
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

test('the reported point-to-line question cannot label 3/5 correct when its solution concludes 7/5', () => {
  const reported={q:'點 $(2,1)$ 到直線 $3x-4y+5=0$ 的距離為何？',
    correct:'$\\frac{3}{5}$',wrong:['$\\frac{7}{5}$','$\\frac{1}{5}$','$\\frac{9}{5}$'],
    exp:'由點到直線距離公式，$d=\\frac{|3(2)-4(1)+5|}{\\sqrt{3^2+(-4)^2}}=\\frac{7}{5}$。因此距離為 $\\frac{7}{5}$。'};
  assert.match(questionQualityIssue(reported),/最終答案與 correct 不一致/);
  assert.equal(questionQualityIssue({...reported,correct:reported.wrong[0],wrong:[reported.correct,...reported.wrong.slice(1)]}), '');
  assert.match(questionIntegrityIssue({...reported,exp:'代入並約分，答案為 1.4。'}),/最終答案/);
  assert.match(questionIntegrityIssue({...reported,exp:'代入並約分，答案為 \\(\\dfrac{7}{5}\\)。'}),/最終答案/);
});

test('numeric answer comparison understands fractions and decimals without merging different decimal places', () => {
  for(const [input,result] of [['$\\frac{14}{10}$','7/5'],['\\dfrac{7}{5}','7/5'],['1.40','7/5'],
    ['-0.50','-1/2'],['\\frac{-2}{4}','-1/2'],['-\\tfrac{2}{4}','-1/2'],['-\\frac{-2}{4}','1/2'],['0.00','0']])assert.equal(numericAnswer(input),result);
  const duplicate={q:'下列何者正確？',correct:'$\\frac{7}{5}$',wrong:['1.4','1','3'],exp:'答案為 $\\frac{7}{5}$。'};
  assert.match(questionIntegrityIssue(duplicate),/結構有誤/);
  assert.equal(questionIntegrityIssue({...duplicate,correct:'1.4',wrong:['14','1','3'],exp:'代入求得答案為 1.4。'}),'');
  for(const unsafe of ['process.exit()','1/0','\\sqrt{2}','x+1','1.4 公尺','2^3'])assert.equal(numericAnswer(unsafe),null);
});

test('only final numeric conclusions are checked; intermediate quantities are not mistaken for the requested answer', () => {
  const q={q:'求長方體的體積。',correct:'8',wrong:['4','6','10'],exp:'因此面積為 4，再乘以高 2，答案為 8。'};
  assert.equal(questionIntegrityIssue(q),'');
  assert.equal(questionIntegrityIssue({...q,exp:'先計算底面積為 4。再乘以高 2，因此體積為 8。'}),'');
  assert.match(questionIntegrityIssue({...q,exp:'代入題目條件，因此體積為 12。'}),/最終答案/,'a numeric conclusion absent from all choices is also invalid');
});

test('all quiz generation modes share independent solving and concise explanation instructions', () => {
  const {ANSWER_AND_EXPLANATION_RULES}=require('../quiz-answer-prompt.cjs');
  const {quickQuizPrompt,MODES}=require('../fast-quiz-prompt.cjs');
  const server=require('node:fs').readFileSync(require.resolve('../server.js'),'utf8');
  assert.match(server,/\$\{ANSWER_AND_EXPLANATION_RULES\}/);
  for(const mode of MODES)assert.ok(quickQuizPrompt({mode}).includes(ANSWER_AND_EXPLANATION_RULES));
  assert.match(ANSWER_AND_EXPLANATION_RULES,/先只依 q.*獨立求解/);
  assert.match(ANSWER_AND_EXPLANATION_RULES,/正負號、常數項/);
  assert.match(ANSWER_AND_EXPLANATION_RULES,/2–4 個短句/);
  assert.match(ANSWER_AND_EXPLANATION_RULES,/最後一句固定用「答案為/);
  assert.match(ANSWER_AND_EXPLANATION_RULES,/不逐項分析錯誤選項/);
});
