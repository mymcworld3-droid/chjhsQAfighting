const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('Golden Core activation feedback module is loaded and exposes a queued banner', () => {
  const rules = read('public/cultivation/cultivation-rules.js');
  const feedback = read('public/cultivation/golden-core-activation-feedback.js');

  assert.match(rules, /import '\.\/golden-core-activation-feedback\.js';/);
  assert.match(feedback, /window\.showGoldenCoreActivation\s*=\s*function/);
  assert.match(feedback, /金丹神通發動/);
  assert.match(feedback, /const queue = \[\]/);
  assert.match(feedback, /now - previous < 1000/);
});

test('quiz Golden Core effects show activation only when an effect message exists', () => {
  const rules = read('public/cultivation/cultivation-rules.js');

  assert.match(rules, /const message = reward\?\.goldenCoreMessage/);
  assert.match(rules, /if \(!message \|\| typeof window\.showGoldenCoreActivation !== 'function'\) return;/);
  assert.match(rules, /window\.getEquippedGoldenCoreState\?\.\(\)/);
  assert.match(rules, /window\.showGoldenCoreActivation\(\{/);
});

test('battle Golden Core effects announce ocean, sword and thunder activations', () => {
  const battle = read('public/cultivation/golden-core-battle-effects.js');

  assert.match(battle, /function showActivation\(core, message, kind\)/);
  assert.match(battle, /千尺巨浪席捲戰場，額外造成 100 傷害/);
  assert.match(battle, /萬劍追擊，額外造成 200 傷害/);
  assert.match(battle, /雷光反擊，返還 \$\{damage\} 傷害/);
  assert.match(battle, /showActivation\(core, message, '鬥法攻擊效果'\)/);
  assert.match(battle, /showActivation\(core, message, '鬥法受擊效果'\)/);
});
