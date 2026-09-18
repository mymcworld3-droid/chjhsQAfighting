const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const training = fs.readFileSync(
  path.join(__dirname, '..', 'public/cultivation/cultivation-training-v4.js'),
  'utf8'
);

test('Breakthrough Ascension Pill grants five cultivation in the breakthrough zone', () => {
  const start = training.indexOf("id: 'pojing'");
  const end = training.indexOf("id: 'xingchen'", start);
  const block = training.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /悟道成功額外 \+5 修為/);
  assert.match(block, /bonusGain: 5/);
  assert.match(block, /額外 \+5 修為/);
  assert.match(block, /inBreakthroughZone\(score, grade\)/);
  assert.doesNotMatch(block, /bonusGain: 2/);
  assert.doesNotMatch(block, /額外 \+2 修為/);
});
