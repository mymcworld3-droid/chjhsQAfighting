const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const read = name => readFileSync(join(__dirname, '../public', name), 'utf8');

const main = read('main.js');
const theme = read('cultivation-theme.js');
const liveSync = read('xiuxian-live-sync.js');
const breakthrough = read('realm-breakthrough-feedback.js');
const progression = read('cultivation-progression-v2.js');
const guard = read('golden-core-access-guard.js');
const training = read('cultivation-training-v4.js');
const tutorial = read('newbie-tutorial.js');
const combat = read('cultivation-combat-stats.js');
const statusPanel = read('cultivation-status-panel.js');
const visual = read('cultivation-core-visual.js');
const equipWarning = read('cultivation-core-equip-warning.js');

test('login core is isolated from optional cultivation module failures', () => {
  const staticImports = main.match(/^import\s+['"][^'"]+['"];$/gm) || [];
  assert.deepEqual(staticImports, ["import './main-legacy.js';"]);
  assert.match(main, /const XIUXIAN_FEATURE_MODULES = \[/);
  assert.match(main, /await import\(modulePath\)/);
  assert.match(main, /catch \(error\)/);
  assert.match(main, /Failed to load optional module/);
});

test('Golden Core UI and effects are gated behind completed migration and 300 cultivation', () => {
  assert.match(training, /const GOLDEN_CORE_SCORE = 300;/);
  assert.match(guard, /const GOLDEN_CORE_SCORE = 300;/);
  assert.match(guard, /migrationReady\(\) && score\(\) >= GOLDEN_CORE_SCORE/);
  assert.match(guard, /document\.getElementById\('nav-training'\)\?\.remove\(\)/);
  assert.match(guard, /page\?\.remove\(\)/);
  assert.match(guard, /resolveGoldenCoreCultivationReward/);
  assert.match(guard, /getGoldenCoreState/);
  assert.match(guard, /if \(!allowed\(\)\) return null;/);

  const progressionIndex = main.indexOf("'./cultivation-progression-v2.js'");
  const guardIndex = main.indexOf("'./golden-core-access-guard.js'");
  const trainingIndex = main.indexOf("'./cultivation-training-v4.js'");
  assert.ok(progressionIndex >= 0 && guardIndex > progressionIndex && trainingIndex > guardIndex,
    'progression migration and guard must load before Golden Core UI');
});

test('compensation inventory rendering is idempotent and cannot self-trigger forever', () => {
  assert.match(progression, /const signature = `\$\{count\}:\$\{pillBusy \? 1 : 0\}`;/);
  assert.match(progression, /existing\?\.dataset\.signature === signature/);
  assert.match(progression, /card\.dataset\.signature = signature/);
});

test('multiplayer unlock remains Foundation Establishment at 60 cultivation', () => {
  assert.match(progression, /const FOUNDATION_SCORE = 60;/);
  assert.match(progression, /score\(\) < FOUNDATION_SCORE/);
  assert.match(progression, /startBattleMatchmaking/);
  assert.match(progression, /btn-social-nav/);
  assert.match(progression, /接受鬥法邀請/);
});

test('post-Golden-Core realm curve is consistent across active realm renderers', () => {
  const expected = [
    ['金丹', 300],
    ['元嬰', 500],
    ['化神', 800],
    ['煉虛', 1200],
    ['合體', 1800],
    ['大乘', 2600],
    ['渡劫', 3600],
    ['真仙', 5000]
  ];

  for (const source of [theme, liveSync, breakthrough]) {
    for (const [name, need] of expected) {
      assert.match(source, new RegExp(`name: '${name}'.*need: ${need}`), `${name} threshold ${need} is synchronized`);
    }
  }

  assert.match(training, /const REALM_THRESHOLDS = \[500, 800, 1200, 1800, 2600, 3600, 5000\];/);
});

test('legacy compensation formula and item are preserved', () => {
  assert.match(progression, /const LEGACY_HIGH_REALM_SCORE = 150;/);
  assert.match(progression, /Math\.ceil\(\(deducted \/ 2\) \/ PILL_GAIN\)/);
  assert.match(progression, /Math\.round\(\(deducted \/ 2\) \* 2\)/);
  assert.match(progression, /回魂聚靈丹/);
  assert.match(progression, /PILL_GAIN = 100/);
  assert.match(progression, /'stats\.totalScore': FOUNDATION_SCORE/);
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

test('combat status remains intentionally limited to attack and HP', () => {
  assert.match(combat, /attack: 200/);
  assert.match(combat, /hp: 1000/);
  assert.match(combat, /maxHp: 1000/);
  assert.doesNotMatch(combat, /defense:/);
  assert.doesNotMatch(combat, /speed:/);
  assert.doesNotMatch(combat, /critRate:/);
  assert.doesNotMatch(combat, /critDamage:/);
  assert.match(statusPanel, /攻擊力/);
  assert.match(statusPanel, /生命值/);
  assert.doesNotMatch(statusPanel, /防禦力/);
  assert.doesNotMatch(statusPanel, /暴擊傷害/);
});

test('Golden Core visual and lower-quality equip warning remain active', () => {
  assert.match(visual, /core-quality-supreme/);
  assert.match(visual, /core-quality-rays/);
  assert.match(visual, /core-rune-ring/);
  assert.match(visual, /core-quality-sparks/);
  assert.match(equipWarning, /金丹品質下降/);
  assert.match(equipWarning, /if \(newGrade <= oldGrade\) return;/);
  assert.match(main, /cultivation-core-visual\.js/);
  assert.match(main, /cultivation-core-equip-warning\.js/);
  assert.match(main, /cultivation-status-panel\.js/);
  assert.match(main, /realm-breakthrough-feedback\.js/);
  assert.match(main, /newbie-tutorial\.js/);
});
