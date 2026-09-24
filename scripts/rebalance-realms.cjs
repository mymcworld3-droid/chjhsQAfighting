// This script is a historical rebalancing utility. Keep its output aligned with the
// current post-nascent-soul curve so reruns cannot silently restore the earlier thresholds.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const touched = new Set();

function file(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(file(rel), 'utf8');
}

function write(rel, source) {
  fs.writeFileSync(file(rel), source);
  touched.add(rel);
}

function replace(rel, pattern, replacement, { required = true } = {}) {
  const source = read(rel);
  const next = source.replace(pattern, replacement);
  if (required && next === source) throw new Error(`Pattern not found in ${rel}: ${pattern}`);
  if (next !== source) write(rel, next);
}

function replaceAll(rel, pattern, replacement, { required = false } = {}) {
  const source = read(rel);
  let next;
  if (typeof pattern === 'string') next = source.split(pattern).join(replacement);
  else next = source.replace(pattern, replacement);
  if (required && next === source) throw new Error(`Pattern not found in ${rel}: ${pattern}`);
  if (next !== source) write(rel, next);
}

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of fs.readdirSync(file(dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) out.push(...walk(rel, predicate));
    else if (predicate(rel)) out.push(rel);
  }
  return out;
}

const detailedCurve = [
  ['煉氣', '一層', 1],
  ['煉氣', '二層', 2],
  ['煉氣', '三層', 3],
  ['煉氣', '四層', 4],
  ['煉氣', '五層', 5],
  ['煉氣', '六層', 6],
  ['煉氣', '七層', 7],
  ['煉氣', '八層', 8],
  ['煉氣', '九層', 9],
  ['築基', '初期', 10],
  ['築基', '中期', 16],
  ['築基', '後期', 22],
  ['金丹', '丹成一品', 28],
  ['元嬰', '元嬰出竅', 68],
  ['化神', '神念通天', 188],
  ['煉虛', '虛空悟道', 428],
  ['合體', '天地合一', 788],
  ['大乘', '大道將成', 1268],
  ['渡劫', '雷劫問道', 1868],
  ['半仙', '仙門在望', 2588],
  ['真仙', '榜上仙位', 2588]
];

const detailedRealmFiles = [
  'public/main-legacy.js',
  'public/cultivation/cultivation-theme.js',
  'public/cultivation/xiuxian-live-sync.js',
  'public/cultivation/realm-breakthrough-feedback.js',
  'public/cultivation/cultivation-progression-v2.js'
];

for (const rel of detailedRealmFiles) {
  let source = read(rel);
  for (const [name, sub, need] of detailedCurve) {
    const re = new RegExp(`(\\{ name: '${name}', sub: '${sub}', need: )\\d+`, 'g');
    source = source.replace(re, `$1${need}`);
  }
  write(rel, source);
}

// Artifact realm restrictions use one row per major realm.
const artifactNeeds = {
  qi: 1,
  foundation: 10,
  'golden-core': 28,
  'nascent-soul': 68,
  spirit: 188,
  void: 428,
  fusion: 788,
  mahayana: 1268,
  tribulation: 1868,
  immortal: 2588
};
{
  const rel = 'public/cultivation/artifact-catalog.js';
  let source = read(rel);
  for (const [id, need] of Object.entries(artifactNeeds)) {
    const re = new RegExp(`(\\{ id: '${id}', name: '[^']+', order: \\d+, need: )\\d+`, 'g');
    source = source.replace(re, `$1${need}`);
  }
  write(rel, source);
}

// All gameplay gates must agree with the new early-game pacing.
for (const rel of walk('public/cultivation', (rel) => rel.endsWith('.js'))) {
  replaceAll(rel, /const FOUNDATION_SCORE = \d+;/g, 'const FOUNDATION_SCORE = 10;');
  replaceAll(rel, /const GOLDEN_CORE_SCORE = \d+;/g, 'const GOLDEN_CORE_SCORE = 28;');
  replaceAll(rel, /const TRIBULATION_SCORE = \d+;/g, 'const TRIBULATION_SCORE = 1868;');
}

replace('public/cultivation/cultivation-training-v4.js', /const REALM_THRESHOLDS = \[[^\]]+\];/, 'const REALM_THRESHOLDS = [68, 188, 428, 788, 1268, 1868, 2588];', false);
replaceAll('public/cultivation/cultivation-theme.js', '築基以前維持原進度；金丹以上因金丹特性會加速修煉，因此拉長後期曲線。', '前 10 題快速完成煉氣並築基；金丹後每題基礎 +2，因此後期門檻按實際答題量漸進。');
replaceAll('public/cultivation/cultivation-progression-v2.js', '金丹 120 開內丹', '金丹 28 開內丹');
replaceAll('public/cultivation/cultivation-progression-v2.js', '<b>60 · 築基初期</b>', '<b>${FOUNDATION_SCORE} · 築基初期</b>');
replaceAll('public/cultivation/foundation-training-page.js', '築基期修煉頁：60～119 修為只顯示背包；踏入金丹後交棒給完整修煉模組。', '築基期修煉頁：10～27 修為只顯示背包；踏入金丹後交棒給完整修煉模組。');
replaceAll('public/cultivation/newbie-tutorial-v2.js', '60 修為後開放多人玩法', '10 修為後開放多人玩法');
replaceAll('public/cultivation/newbie-tutorial-v2.js', '築基初期（60 修為）', '築基初期（10 修為）');
replaceAll('public/cultivation/five-immortals.js', '渡劫 · 3600 修為', '渡劫 · 1868 修為');

// Update regression expectations for the new curve.
const testRealmNeeds = {
  金丹: 28,
  元嬰: 68,
  化神: 188,
  煉虛: 428,
  合體: 788,
  大乘: 1268,
  渡劫: 1868,
  真仙: 2588
};
for (const rel of ['tests/progression-gates.test.cjs', 'tests/legacy-realm-curve.test.cjs']) {
  let source = read(rel);
  for (const [name, need] of Object.entries(testRealmNeeds)) {
    source = source.replace(new RegExp(`(\\['${name}', )\\d+`, 'g'), `$1${need}`);
  }
  source = source
    .replaceAll('FOUNDATION_SCORE = 60', 'FOUNDATION_SCORE = 10')
    .replaceAll('GOLDEN_CORE_SCORE = 120', 'GOLDEN_CORE_SCORE = 28')
    .replaceAll('at 60 with backpack only while Golden Core waits for 120', 'at 10 with backpack only while Golden Core waits for 28')
    .replaceAll('at 60 cultivation', 'at 10 cultivation')
    .replaceAll('behind migration and 120 cultivation', 'behind migration and 28 cultivation')
    .replace('const expected = [\n    [\'金丹\', 28]', 'const expected = [\n    [\'金丹\', 28]');
  write(rel, source);
}

replaceAll('tests/progression-gates.test.cjs', 'const REALM_THRESHOLDS = [500, 800, 1200, 1800, 2600, 3600, 5000];', 'const REALM_THRESHOLDS = [68, 188, 428, 788, 1268, 1868, 2588];');
replaceAll('tests/five-immortals-challenge.test.cjs', '3600', '1868');
replaceAll('tests/newbie-mortal-tutorial.test.cjs', 'FOUNDATION_SCORE = 60', 'FOUNDATION_SCORE = 10');
replaceAll('tests/newbie-mortal-tutorial.test.cjs', '60 修為', '10 修為');

{
  const rel = 'tests/cultivation.test.cjs';
  let source = read(rel);
  source = source
    .replace("const h = setup(4);\n  const pending = h.answer();\n  assert.equal(h.nodes.get('xiuxian-score').textContent, '5 修為');", "const h = setup(0);\n  const pending = h.answer();\n  assert.equal(h.nodes.get('xiuxian-score').textContent, '1 修為');")
    .replace("assert.equal(h.nodes.get('xiuxian-sub').textContent, '一層');\n  assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');\n  assert.equal(h.nodes.get('xiuxian-next').textContent, '5 修為');", "assert.equal(h.nodes.get('xiuxian-sub').textContent, '一層');\n  assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');\n  assert.equal(h.nodes.get('xiuxian-next').textContent, '1 修為');")
    .replaceAll("assert.equal(h.writes[0].data.stats.totalScore, 5);", "assert.equal(h.writes[0].data.stats.totalScore, 1);")
    .replaceAll("assert.equal(h.nodes.get('xiuxian-score').textContent, '5 修為');", "assert.equal(h.nodes.get('xiuxian-score').textContent, '1 修為');")
    .replace("assert.equal(h.nodes.get('xiuxian-progress').style.width, '80%');", "assert.equal(h.nodes.get('xiuxian-progress').style.width, '0%');")
    .replace('const h = setup(119);', 'const h = setup(27);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 120);', 'assert.equal(h.context.currentUserData.stats.totalScore, 28);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 122);', 'assert.equal(h.context.currentUserData.stats.totalScore, 30);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 121);', 'assert.equal(h.context.currentUserData.stats.totalScore, 29);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 120);', 'assert.equal(h.context.currentUserData.stats.totalScore, 28);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 119);', 'assert.equal(h.context.currentUserData.stats.totalScore, 27);')
    .replaceAll('const h = setup(120);', 'const h = setup(28);')
    .replaceAll('assert.equal(h.context.currentUserData.stats.totalScore, 120);', 'assert.equal(h.context.currentUserData.stats.totalScore, 28);')
    .replaceAll('assert.equal(h.context.currentUserData.stats.totalScore, 119);', 'assert.equal(h.context.currentUserData.stats.totalScore, 27);')
    .replace('assert.equal(h.context.currentUserData.stats.totalScore, 124);', 'assert.equal(h.context.currentUserData.stats.totalScore, 32);')
    .replace("for (const [initial, expected] of [[undefined, 1], ['30', 31]])", "for (const [initial, expected] of [[undefined, 1], ['20', 21]])");
  write(rel, source);
}

// Add an explicit pacing regression test so future changes cannot silently restore the grind.
const balanceTest = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nfunction read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }\n\nconst theme = read('public/cultivation/cultivation-theme.js');\nconst rules = read('public/cultivation/cultivation-rules.js');\nconst battle = read('public/cultivation/battle-mode-v2.js');\nconst artifacts = read('public/cultivation/artifact-catalog.js');\n\ntest('realm pacing reaches Foundation in 10 answers and Golden Core 18 answers later', () => {\n  assert.match(theme, /name: '築基', sub: '初期', need: 10/);\n  assert.match(theme, /name: '築基', sub: '中期', need: 16/);\n  assert.match(theme, /name: '築基', sub: '後期', need: 22/);\n  assert.match(theme, /name: '金丹', sub: '丹成一品', need: 28/);\n  assert.match(rules, /const GOLDEN_CORE_SCORE = 28;/);\n  assert.match(battle, /const FOUNDATION_SCORE = 10;/);\n});\n\ntest('post-Golden-Core curve is balanced against the +2 base cultivation gain', () => {\n  const expected = [['元嬰',68],['化神',188],['煉虛',428],['合體',788],['大乘',1268],['渡劫',1868],['半仙',2588],['真仙',2588]];\n  for (const [name, need] of expected) assert.match(theme, new RegExp("name: '" + name + "'.*need: " + need));\n  assert.match(artifacts, /id: 'golden-core'.*need: 28/);\n  assert.match(artifacts, /id: 'tribulation'.*need: 1868/);\n});\n`;
write('tests/realm-balance-v3.test.cjs', balanceTest);

console.log(`Realm rebalance updated ${touched.size} files:`);
for (const rel of [...touched].sort()) console.log(` - ${rel}`);
