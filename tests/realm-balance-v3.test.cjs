const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const theme = read('public/cultivation/cultivation-theme.js');
const rules = read('public/cultivation/cultivation-rules.js');
const battle = read('public/cultivation/battle-mode-v2.js');
const artifacts = read('public/cultivation/artifact-catalog.js');

test('realm pacing reaches Foundation at 6 cultivation after five Qi layers, with Golden Core at 28', () => {
  assert.match(theme, /name: '築基', sub: '初期', need: 6/);
  assert.match(theme, /name: '築基', sub: '中期', need: 16/);
  assert.match(theme, /name: '築基', sub: '後期', need: 22/);
  assert.match(theme, /name: '金丹', sub: '丹成一品', need: 28/);
  assert.match(rules, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(battle, /const FOUNDATION_SCORE = 6;/);
});

test('every active realm table transitions directly from Qi five to Foundation at six cultivation', () => {
  const files = ['public/main-legacy.js', 'public/cultivation/cultivation-theme.js',
    'public/cultivation/xiuxian-live-sync.js', 'public/cultivation/realm-breakthrough-feedback.js',
    'public/cultivation/cultivation-progression-v2.js'];
  for (const file of files) {
    const source = read(file);
    const table = vm.runInNewContext(source.match(/const (?:FALLBACK_)?REALMS = (\[[\s\S]*?\n\s*\]);/)[1]);
    const realmAt = score => table.filter(row => score >= row.need && row.name !== '真仙').at(-1);
    assert.deepEqual(Array.from(table.filter(row => row.name === '煉氣'), row => row.sub), ['一層','二層','三層','四層','五層'], file);
    assert.equal(realmAt(5).sub, '五層', file);
    for (const score of [6,7,8,9,10,15]) {
      assert.equal(realmAt(score).name, '築基', file + ':' + score);
      assert.equal(realmAt(score).sub, '初期', file + ':' + score);
    }
    assert.equal(realmAt(16).sub, '中期');
    assert.equal(realmAt(22).sub, '後期');
    assert.equal(realmAt(28).name, '金丹');
  }
});

test('legacy saved realm indices cannot mislabel players after removing Qi layers six through nine', () => {
  const source = read('public/main-legacy.js');
  const table = source.match(/const REALMS = (\[[\s\S]*?\n\]);/)[1];
  const functions = source.slice(source.indexOf('function getRankName('), source.indexOf('// Linking a provider'));
  const runtime = vm.runInNewContext('const REALMS = ' + table + ';\n' + functions + '\n({getRankName,getRankMarkup,calculateRankFromScore})',
    {window:{limitImmortalRank:index => index}});
  for (const [oldRank,score,label] of [[5,5,'煉氣 五層'],[6,6,'築基 初期'],[9,9,'築基 初期'],
    [10,10,'築基 初期'],[13,28,'金丹 丹成一品'],[14,68,'元嬰 元嬰出竅']]) {
    assert.equal(runtime.getRankName(oldRank,'tester',score), label);
    assert.equal(runtime.getRankMarkup(oldRank,'tester',score).trim(), label);
  }
});

test('post-nascent-soul curve grows with investable cultivation bonuses', () => {
  const expected = [['元嬰',68],['化神',188],['煉虛',428],['合體',788],['渡劫',1268],['半仙',1868],['真仙',1868]];
  for (const [name, need] of expected) assert.match(theme, new RegExp("name: '" + name + "'.*need: " + need));
  assert.match(artifacts, /id: 'golden-core'.*need: 28/);
  assert.match(artifacts, /id: 'mahayana'.*need: 1268/);
});

test('base +2 answer gaps increase after Nascent Soul while spirit bonuses shorten the grind', () => {
  const thresholds = [28, 68, 188, 428, 788, 1268, 1868];
  const answerGaps = thresholds.slice(1).map((need, index) => (need - thresholds[index]) / 2);
  assert.deepEqual(answerGaps, [20, 60, 120, 180, 240, 300]);
  for (let i = 1; i < answerGaps.length; i += 1) assert.ok(answerGaps[i] >= answerGaps[i - 1]);
  const fullyTrainedGaps = thresholds.slice(2).map((need, index) => (need - thresholds[index + 1]) / 12);
  assert.deepEqual(fullyTrainedGaps, [10, 20, 30, 40, 50]);
});
