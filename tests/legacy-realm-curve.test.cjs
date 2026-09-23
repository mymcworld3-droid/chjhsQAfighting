const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');

test('legacy login core uses the same cultivation realm curve', () => {
  const expected = [
    ['金丹', 28],
    ['元嬰', 68],
    ['化神', 128],
    ['煉虛', 208],
    ['合體', 308],
    ['大乘', 448],
    ['渡劫', 628],
    ['半仙', 868],
    ['真仙', 868]
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
