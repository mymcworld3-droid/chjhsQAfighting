const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, '../public/cultivation/material-drop-system.js'), 'utf8');
const start = source.indexOf('  async function runDropTransactionWithRetry(');
const end = source.indexOf('  async function grantDrops(', start);
assert.ok(start >= 0 && end > start, 'material drop conflict helper exists');

function retry() {
  const ctx = { Math: { random: () => 0 } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.retry = runDropTransactionWithRetry;', ctx);
  return ctx.retry;
}

test('material reward transaction retries a failed-precondition and preserves the original drop', async () => {
  const run = retry();
  const delays = [];
  let calls = 0;
  const result = await run(async () => {
    if (++calls < 3) throw Object.assign(new Error('stale updateTime'), { code:'failed-precondition' });
    return { inventory: { 'spirit-grass': 7 } };
  }, async (ms) => { delays.push(ms); });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [180, 360]);
  assert.equal(result.inventory['spirit-grass'], 7);
});

test('material reward transaction also retries aborted but never errors of uncertain outcome', async () => {
  const run = retry();
  let calls = 0;
  await assert.rejects(run(async () => {
    calls++;
    throw Object.assign(new Error('unavailable'), { code:'unavailable' });
  }, async () => {}), /unavailable/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(run(async () => {
    calls++;
    throw Object.assign(new Error('too much contention'), { code:'aborted' });
  }, async () => {}), /too much contention/);
  assert.equal(calls, 4, 'initial attempt plus three limited conflict retries');
});

test('reward writes fresh inventory and updates local data only after confirmed commit', () => {
  const reward = source.slice(source.indexOf('  async function grantDrops('), source.indexOf('  function enqueueRoll('));
  assert.match(reward, /runDropTransactionWithRetry\(\(\) => runTransaction\(database\(\), async \(tx\) =>/);
  assert.match(reward, /const next = normalizeMaterialSystem\(snap\.data\(\)\?\.\[FIELD\] \|\| \{\}\)/);
  assert.match(reward, /tx\.update\(ref, \{ \[FIELD\]: next \}\)/);
  assert.ok(reward.indexOf('if (authUser()?.uid !== user.uid)') > reward.indexOf('await runDropTransactionWithRetry'));
  assert.match(source, /材料掉落未能寫入，獎勵尚未發放/);
});
