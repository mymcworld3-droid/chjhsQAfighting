const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = name => readFileSync(join(__dirname, '../public', name), 'utf8');

const main = read('main.js');
const theme = read('cultivation-theme.js');
const progression = read('cultivation-progression-v2.js');
const guard = read('golden-core-access-guard.js');
const training = read('cultivation-training-v4.js');
const tutorial = read('newbie-tutorial.js');

test('Golden Core UI is gated behind completed migration and 300 cultivation', () => {
  assert.match(training, /const GOLDEN_CORE_SCORE = 300;/);
  assert.match(guard, /const GOLDEN_CORE_SCORE = 300;/);
  assert.match(guard, /migrationReady\(\) && score\(\) >= GOLDEN_CORE_SCORE/);
  assert.match(guard, /document\.getElementById\('nav-training'\)\?\.remove\(\)/);
  assert.match(guard, /page\?\.remove\(\)/);

  const progressionIndex = main.indexOf("import './cultivation-progression-v2.js';");
  const guardIndex = main.indexOf("import './golden-core-access-guard.js';");
  const trainingIndex = main.indexOf("import './cultivation-training-v4.js';");
  assert.ok(progressionIndex >= 0 && guardIndex > progressionIndex && trainingIndex > guardIndex,
    'progression migration and guard must load before Golden Core UI');
});

test('multiplayer unlock remains Foundation Establishment at 60 cultivation', () => {
  assert.match(progression, /const FOUNDATION_SCORE = 60;/);
  assert.match(progression, /score\(\) < FOUNDATION_SCORE/);
  assert.match(progression, /startBattleMatchmaking/);
  assert.match(progression, /btn-social-nav/);
});

test('post-Golden-Core realm curve uses the rebalanced thresholds', () => {
  const expected = [
    ["金丹", 300],
    ["元嬰", 500],
    ["化神", 800],
    ["煉虛", 1200],
    ["合體", 1800],
    ["大乘", 2600],
    ["渡劫", 3600],
    ["真仙", 5000]
  ];

  for (const [name, need] of expected) {
    assert.ok(theme.includes(`{ name: '${name}'`) && theme.includes(`need: ${need}`), `${name} threshold exists`);
  }
  assert.match(training, /const REALM_THRESHOLDS = \[500, 800, 1200, 1800, 2600, 3600, 5000\];/);
});

test('legacy compensation formula and item are preserved', () => {
  assert.match(progression, /const LEGACY_HIGH_REALM_SCORE = 150;/);
  assert.match(progression, /Math\.ceil\(\(deducted \/ 2\) \/ PILL_GAIN\)/);
  assert.match(progression, /Math\.round\(\(deducted \/ 2\) \* 2\)/);
  assert.match(progression, /回魂聚靈丹/);
  assert.match(progression, /PILL_GAIN = 100/);
});

test('newbie tutorial explains scope selection and progression unlocks', () => {
  assert.match(tutorial, /綜合題目/);
  assert.match(tutorial, /指定題庫/);
  assert.match(tutorial, /專注練習/);
  assert.match(tutorial, /築基初期（60 修為）/);
  assert.match(tutorial, /300 修為/);
  assert.match(tutorial, /set-source-mode/);
  assert.match(tutorial, /set-difficulty/);
});
