const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('repeated terminal room snapshots preserve pending, successful and retryable reward UI', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/cultivation/raid-mode.js'), 'utf8');
  const start = source.indexOf('  function finishRaid(won, reason) {');
  const end = source.indexOf('\n  function resetRaid(', start);
  assert.ok(start >= 0 && end > start);
  for (const message of ['核對中', '獎勵已入帳', '獎勵尚未入帳，重新領取']) {
    let renders = 0;
    const result = {innerHTML: message};
    const context = {state:{status:'finished'}, stopTick(){renders++;}, document:{getElementById(){return result;}}};
    vm.runInNewContext(source.slice(start, end) + '\nfinishRaid(true, "boss-defeated");', context);
    assert.equal(renders, 0);
    assert.equal(result.innerHTML, message);
  }
});
