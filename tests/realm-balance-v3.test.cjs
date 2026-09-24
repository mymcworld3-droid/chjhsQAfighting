const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const theme = read('public/cultivation/cultivation-theme.js');
const rules = read('public/cultivation/cultivation-rules.js');
const battle = read('public/cultivation/battle-mode-v2.js');
const artifacts = read('public/cultivation/artifact-catalog.js');

test('realm pacing reaches Foundation in 10 answers and Golden Core 18 answers later', () => {
  assert.match(theme, /name: '築基', sub: '初期', need: 10/);
  assert.match(theme, /name: '築基', sub: '中期', need: 16/);
  assert.match(theme, /name: '築基', sub: '後期', need: 22/);
  assert.match(theme, /name: '金丹', sub: '丹成一品', need: 28/);
  assert.match(rules, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(battle, /const FOUNDATION_SCORE = 10;/);
});

test('post-nascent-soul curve grows with investable cultivation bonuses', () => {
  const expected = [['元嬰',68],['化神',188],['煉虛',428],['合體',788],['大乘',1268],['渡劫',1868],['半仙',2588],['真仙',2588]];
  for (const [name, need] of expected) assert.match(theme, new RegExp("name: '" + name + "'.*need: " + need));
  assert.match(artifacts, /id: 'golden-core'.*need: 28/);
  assert.match(artifacts, /id: 'tribulation'.*need: 1868/);
});

test('base +2 answer gaps increase after Nascent Soul while spirit bonuses shorten the grind', () => {
  const thresholds = [28, 68, 188, 428, 788, 1268, 1868, 2588];
  const answerGaps = thresholds.slice(1).map((need, index) => (need - thresholds[index]) / 2);
  assert.deepEqual(answerGaps, [20, 60, 120, 180, 240, 300, 360]);
  for (let i = 1; i < answerGaps.length; i += 1) assert.ok(answerGaps[i] >= answerGaps[i - 1]);
  const fullyTrainedGaps = thresholds.slice(2).map((need, index) => (need - thresholds[index + 1]) / 12);
  assert.deepEqual(fullyTrainedGaps, [10, 20, 30, 40, 50, 60]);
});
