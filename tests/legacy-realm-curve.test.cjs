const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');

test('legacy login core uses the same cultivation realm curve', () => {
  const expected = [
    ['金丹', 28],
    ['元嬰', 68],
    ['化神', 188],
    ['煉虛', 428],
    ['合體', 788],
    ['大乘', 1268],
    ['渡劫', 1868],
    ['半仙', 2588],
    ['真仙', 2588]
  ];

  for (const [name, need] of expected) {
    assert.match(
      legacy,
      new RegExp(`name: '${name}'.*need: ${need}`),
      `${name} must start at ${need} cultivation in main-legacy.js`
    );
  }

  assert.doesNotMatch(legacy, /name: '金丹'.*need: 150/);
  assert.doesNotMatch(legacy, /name: '金丹'.*need: 300/);
});
