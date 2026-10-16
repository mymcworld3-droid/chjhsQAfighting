'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/battle-mode-v2.js'), 'utf8');
function isolatedFunction(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'Missing battle helper: ' + name);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start);
  return source.slice(start, end + 4);
}
const q = {
  id: 'bv2q-1', q: '1 + 1 等於多少？',
  opts: ['1', '2', '3', '4'], ans: 1
};

test('a complete shared question is required before the battle quiz starts', () => {
  const check = vm.runInNewContext(isolatedFunction('usableQuestion') + '\nusableQuestion');
  assert.equal(check(q), true);
  assert.equal(check({ ...q, q: '' }), false);
  assert.equal(check({ ...q, opts: ['A', 'B'] }), false);
  assert.equal(check({ ...q, id: '' }), false);
  assert.match(source, /room\.status === 'playing' && usableQuestion\(room\.currentQuestion\)/);
});

test('the quiz gets reconstructed when existing question markup is removed', () => {
  const questionNode = { dataset: { questionId: q.id }, innerHTML: '<span>1 + 1</span>' };
  const optionsNode = { querySelectorAll: () => [1, 2, 3, 4] };
  const dom = {
    getElementById(id) { return id === 'bv2-question' ? questionNode : optionsNode; }
  };
  const functions = isolatedFunction('usableQuestion') + '\n' + isolatedFunction('questionDomReady') +
    '\nthis.result = questionDomReady;';
  const ctx = { document: dom };
  vm.runInNewContext(functions, ctx);
  assert.equal(ctx.result(q), true);
  questionNode.innerHTML = '';
  assert.equal(ctx.result(q), false);
  questionNode.innerHTML = '<span>1 + 1</span>';
  optionsNode.querySelectorAll = () => [1, 2];
  assert.equal(ctx.result(q), false);
  assert.match(source, /!questionDomReady\(room\.currentQuestion\)\) renderQuiz\(room\)/);
});

test('an active AI generation lease is not stolen after only seven seconds', () => {
  const now = 1000000;
  const ctx = {
    nowMs: () => now, PREPARE_LEASE_MS: 7000, ACTIVE_QUESTION_LEASE_MS: 65000,
    BATTLE_V2: { disconnectTtlMs: 45000 }
  };
  vm.runInNewContext(isolatedFunction('questionLeaseExpired') + '\nthis.expired = questionLeaseExpired;', ctx);
  const online = { host: { uid: 'a', lastSeenAtMs: now - 1500 }, guest: { uid: 'b', lastSeenAtMs: now - 3000 } };
  assert.equal(ctx.expired(online, 'a', now - 8000), false);
  assert.equal(ctx.expired(online, 'a', now - 64000), false);
  assert.equal(ctx.expired(online, 'a', now - 65000), true);
  const offline = { ...online, host: { uid: 'a', lastSeenAtMs: now - 46000 } };
  assert.equal(ctx.expired(offline, 'a', now - 8000), true);
});

test('a missing question can only be repaired before either participant answers', () => {
  assert.match(source, /function repairMissingPlayingQuestion\(room\)/);
  assert.match(source, /hasSubmittedAnswer\(room\.host, room\.round\) \|\| hasSubmittedAnswer\(room\.guest, room\.round\)/);
  assert.match(source, /fresh\.status !== 'playing' \|\| Number\(fresh\.round\) !== round/);
  assert.match(source, /status: 'preparing', currentQuestion: null, questionReadyAtMs: null/);
  assert.match(source, /controller\.abort\(\), QUIZ_REQUEST_TIMEOUT_MS/);
  assert.match(source, /clearTimeout\(timeout\)/);
});
