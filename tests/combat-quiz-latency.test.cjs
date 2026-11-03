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
  for (const mode of ['raid-quick-simple', 'raid-standard', 'battle-fast', 'immortal-fast']) {
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
    assert.match(prompt, /數學式用 \$\.\.\.\$/);
  }
  assert.match(battle, /quizMode: 'battle-fast'/);
  assert.match(raid, /quizMode: 'raid-quick-simple'/);
  assert.match(five, /quizMode: 'immortal-avatar'/);
  assert.match(server, /FAST_QUIZ_MODES\.has/);
  assert.match(server, /combatFastMode \? quickQuizPrompt/);
  assert.match(server, /timeoutMs: 16000/);
  // The existing server-side validation must remain mandatory for all modes.
  assert.match(server, /questionQualityIssue\(parsed\)/);
  assert.match(server, /const finalIssue = questionQualityIssue\(parsed\)/);
  assert.match(server, /issueRaidQuestionTicket/);
});

test('avatar quizzes use a signed server question and prefetch only after the current turn settles',()=>{
  const source=read('public/cultivation/five-immortals.js');
  assert.match(source,/data.avatarQuestion/);
  assert.match(source,/q.ticket/);
  assert.match(source,/function prefetchNextChallengeQuestion\(serial\)/);
  assert.match(source,/if \(!run.nextPromise\) run.nextPromise/);
  assert.match(source,/const waiting = run.nextPromise/);
  assert.match(source,/waiting \? await waiting/);
  const answer=source.slice(source.indexOf('  async function answerChallenge'));
  assert.ok(answer.indexOf('await request') < answer.indexOf('prefetchNextChallengeQuestion(serial)'));
  assert.match(source,/alive\(serial\)/);
});

test('raid awaits its in-flight prefetch rather than losing the next question during an ongoing request', () => {
  const source = read('public/cultivation/raid-mode.js');
  assert.match(source, /async function prefetchQuestion\(\)/);
  assert.match(source, /if \(state\.questionLoading\) return state\.pendingQuestionWork \|\| Promise\.resolve\(\)/);
  assert.match(source, /state\.pendingQuestionWork = work/);
  assert.match(source, /await prefetchQuestion\(\)/);
  assert.match(source, /state\.roomId === roomId && token === state\.battleSceneToken/);
  assert.match(source, /if \(!state\.pendingQuestion\) return renderArena\(\)/);
});
