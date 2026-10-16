'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { quickQuizPrompt, MODES } = require('../fast-quiz-prompt.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('three combat modes use a compact but strict full-question AI prompt', () => {
  const server = read('server.js');
  const battle = read('public/cultivation/battle-mode-v2.js');
  const raid = read('public/cultivation/raid-question.js');
  const five = read('public/cultivation/five-immortals.js');
  for (const mode of ['raid-quick-simple', 'battle-fast', 'immortal-fast']) {
    assert.ok(MODES.has(mode));
    const prompt = quickQuizPrompt({
      mode, subject: '數學', level: '國中三年級',
      topic: '一元一次方程式', difficulty: 'medium',
      targetForm: '多步推理', previousQuestions: ['2+2=4'], retryIssue: '答案與解析不符'
    });
    assert.ok(prompt.length < 2900, mode + ' should avoid several kilobytes of generic instruction');
    assert.match(prompt, /數學/);
    assert.match(prompt, /國中三年級/);
    assert.match(prompt, /一元一次方程式/);
    assert.match(prompt, /正解/);
    assert.match(prompt, /三個錯誤選項/);
    assert.match(prompt, /從零寫正確|解析應含/);
    assert.match(prompt, /complete|重新生成|重新生成 JSON|重新生成 q/);
    assert.match(prompt, /答案錯誤/);
    assert.match(prompt, /TeX/);
  }
  assert.match(battle, /quizMode: 'battle-fast'/);
  assert.match(raid, /quizMode: 'raid-quick-simple'/);
  assert.match(five, /quizMode: 'immortal-fast'/);
  assert.match(server, /FAST_QUIZ_MODES\.has/);
  assert.match(server, /combatFastMode \? quickQuizPrompt/);
  assert.match(server, /timeoutMs: 16000/);
  // The existing server-side validation must remain mandatory for all modes.
  assert.match(server, /questionQualityIssue\(parsed\)/);
  assert.match(server, /const finalIssue = questionQualityIssue\(parsed\)/);
  assert.match(server, /issueRaidQuestionTicket/);
});

test('Five Immortals accepts real API correct/wrong output with the correct answer preserved', () => {
  const source = read('public/cultivation/five-immortals.js');
  const start = source.indexOf('  function normalizeQuestion(raw) {');
  const end = source.indexOf('  async function fetchChallengeQuestion(', start);
  assert.ok(start > 0 && end > start);
  const normalize = vm.runInNewContext(source.slice(start, end) + '\nnormalizeQuestion;', { Math });
  const question = {
    q: '請計算二加二是多少？', correct: '4', wrong: ['1','3','5'],
    exp: '兩個二相加等於四，所以答案是四。'
  };
  for (let n=0; n<20; n++) {
    const normalized = normalize(question);
    assert.equal(normalized.options.length, 4);
    assert.equal(normalized.options[normalized.answer], '4');
    assert.equal(normalized.explanation, question.exp);
    assert.equal(new Set(normalized.options).size, 4);
  }
  assert.throws(() => normalize({ ...question, wrong: ['4', '3', '5'] }), /INVALID_QUESTION/);
  assert.throws(() => normalize({ ...question, wrong: ['1', '3'] }), /INVALID_QUESTION/);
  // Old stored/cached opts/ans format remains supported.
  const legacy = normalize({
    q:'請選出正確的結果',opts:['1','2','3','4'],ans:3,
    exp:'由題意可知正確結果是 4。'
  });
  assert.equal(legacy.options[legacy.answer], '4');
});

test('Five Immortals prefetches only one next question per live challenge and never repeats answered question', () => {
  const source = read('public/cultivation/five-immortals.js');
  assert.match(source, /function prefetchNextChallengeQuestion\(serial\)/);
  assert.match(source, /current\.nextPromise/);
  assert.match(source, /const waiting = current\.nextPromise/);
  assert.match(source, /question = waiting \? await waiting : null/);
  assert.match(source, /prefetchNextChallengeQuestion\(serial\)/);
  assert.match(source, /current\.seenQuestions/);
  assert.match(source, /avoidQuestions: avoidQuestions\.slice\(-12\)/);
  assert.match(source, /DUPLICATE_IMMORTAL_QUESTION/);
  assert.match(source, /challenge\.active = false/);
});

test('raid awaits its in-flight prefetch rather than losing the next question during an ongoing request', () => {
  const source = read('public/cultivation/raid-mode.js');
  assert.match(source, /let pendingQuestionWork = null/);
  assert.match(source, /if \(state\.questionLoading\) return pendingQuestionWork \|\| Promise\.resolve\(\)/);
  assert.match(source, /pendingQuestionWork = work/);
  assert.match(source, /await prefetchQuestion\(\)/);
  assert.match(source, /state\.roomId === roomId && token === state\.battleSceneToken/);
  assert.match(source, /if \(!state\.pendingQuestion\) return renderArena\(\)/);
});
