const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const battle = readFileSync(join(__dirname, '../public/cultivation/battle-mode-v2.js'), 'utf8');

test('opening round waits exactly three seconds; later rounds have no extra delay', () => {
  const start = battle.indexOf('  const ROUND_COUNTDOWN_MS = 3000;');
  const end = battle.indexOf('  const ANSWER_WINDOW_MS', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(battle.slice(start, end) + '\nthis.deadline = questionReadyDeadline;', context);
  const issued = 1_800_000_000_000;
  assert.equal(context.deadline(1, issued), issued + 3000);
  for (const round of [2, 3, 4, 5, 10]) assert.equal(context.deadline(round, issued), issued);
});

test('both the snapshot and periodic tick use the same first-round deadline', () => {
  assert.match(battle, /questionReadyAtMs: questionReadyDeadline\(round, nowMs\(\)\)/);
  assert.match(battle, /room\.currentQuestion && nowMs\(\) >= Number\(room\.questionReadyAtMs \|\| 0\)/);
  assert.match(battle, /if \(nowMs\(\) < Number\(room\.questionReadyAtMs \|\| 0\)\)/);
  assert.match(battle, /Number\(room\.round\) === 1 && remaining > 0/);
  assert.doesNotMatch(battle, /下一題倒數/);
});

test('the answer response timer still begins only after the first player answers', () => {
  assert.match(battle, /if \(!otherAnswered && !room\.answerWindowStartedAt && !room\.answerWindowStartedAtMs\)/);
  assert.match(battle, /const ANSWER_WINDOW_MS = 25000/);
  assert.match(battle, /if \(started && left <= 0\) timeoutMissingAnswer\(room\)/);
});
