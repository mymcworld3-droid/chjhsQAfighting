const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const readRoot = name => readFileSync(join(__dirname, '../public', name), 'utf8');
const read = name => readFileSync(join(__dirname, '../public/cultivation', name), 'utf8');

const main = readRoot('main.js');
const theme = read('cultivation-theme.js');
const liveSync = read('xiuxian-live-sync.js');
const breakthrough = read('realm-breakthrough-feedback.js');
const progression = read('cultivation-progression-v2.js');
const inventory = read('cultivation-inventory.js');
const guard = read('golden-core-access-guard.js');
const foundationTraining = read('foundation-training-page.js');
const training = read('cultivation-training-v4.js');
const tutorial = read('newbie-tutorial-v2.js');
const coreTutorial = read('golden-core-tutorial.js');
const combat = read('cultivation-combat-stats.js');
const statusPanel = read('cultivation-status-panel.js');
const visual = read('cultivation-core-visual.js');
const equipWarning = read('cultivation-core-equip-warning.js');
const battleEffects = read('golden-core-battle-effects.js');
const legacy = readRoot('main-legacy.js');

test('login core is isolated from optional cultivation module failures', () => {
  const staticImports = main.match(/^import\s+['"][^'"]+['"];$/gm) || [];
  assert.deepEqual(staticImports, ["import './main-legacy.js';", "import './cultivation/dongtian-entry.js';"]);
  const dongtianEntry = read('dongtian-entry.js');
  assert.doesNotMatch(dongtianEntry, /firebasejs|firebase-firestore|getFirestore|getAuth/);
  assert.match(main, /const XIUXIAN_FEATURE_MODULES = \[/);
  assert.match(main, /await import\(modulePath\)/);
  assert.match(main, /Failed to load optional module/);
  assert.match(main, /\.\/cultivation\/cultivation-theme\.js/);
});

test('Foundation opens training at 10 with backpack only while Golden Core waits for 28', () => {
  assert.match(progression, /const FOUNDATION_SCORE = 10;/);
  assert.match(progression, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /const FOUNDATION_SCORE = 10;/);
  assert.match(guard, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /migrationReady\(\) && score\(\) >= FOUNDATION_SCORE/);
  assert.match(guard, /migrationReady\(\) && score\(\) >= GOLDEN_CORE_SCORE/);
  assert.match(guard, /\[data-training-tab="core"\]/);
  assert.match(guard, /#training-status-tab/);

  assert.match(foundationTraining, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(foundationTraining, /value >= FOUNDATION_SCORE && value < GOLDEN_CORE_SCORE/);
  assert.match(foundationTraining, /data-training-tab="bag"/);
  assert.doesNotMatch(foundationTraining, /data-training-tab="core"/);
  assert.doesNotMatch(foundationTraining, /training-status-tab/);

  const progressionIndex = main.indexOf("'./cultivation/cultivation-progression-v2.js'");
  const inventoryIndex = main.indexOf("'./cultivation/cultivation-inventory.js'");
  const guardIndex = main.indexOf("'./cultivation/golden-core-access-guard.js'");
  const foundationIndex = main.indexOf("'./cultivation/foundation-training-page.js'");
  const trainingIndex = main.indexOf("'./cultivation/cultivation-training-v4.js'");
  assert.ok(progressionIndex >= 0 && inventoryIndex > progressionIndex && guardIndex > inventoryIndex && foundationIndex > guardIndex && trainingIndex > foundationIndex,
    'migration, shared inventory, guard, Foundation page and full Golden Core UI load in order');
});

test('Golden Core UI and effects remain gated behind migration and 28 cultivation', () => {
  assert.match(training, /const GOLDEN_CORE_SCORE = 28;/);
  assert.match(guard, /function coreAllowed\(\)/);
  assert.match(guard, /if \(!coreAllowed\(\)\)/);
  assert.match(guard, /resolveGoldenCoreCultivationReward/);
  assert.match(guard, /getGoldenCoreState/);
  assert.match(guard, /if \(!coreAllowed\(\)\) return null;/);
});

test('compensation inventory rendering is idempotent and cannot self-trigger forever', () => {
  assert.match(progression, /const signature = `\$\{count\}:\$\{pillBusy \? 1 : 0\}`;/);
  assert.match(progression, /existing\?\.dataset\.signature === signature/);
  assert.match(progression, /card\.dataset\.signature = signature/);
});

test('revival pill is a cultivation backpack consumable, not a Golden Core', () => {
  assert.match(inventory, /const PILL_FIELD = 'revivalPills';/);
  assert.match(inventory, /const PILL_GAIN = 100;/);
  assert.match(inventory, /type: 'consumable'/);
  assert.match(inventory, /cultivationGain: PILL_GAIN/);
  assert.match(inventory, /training-tab-content/);
  assert.match(inventory, /data-training-tab="bag"/);
  assert.match(inventory, /'stats\.totalScore': newScore/);
  assert.match(inventory, /`stats\.\$\{PILL_FIELD\}`/);
  assert.match(inventory, /修煉 → 背包/);
  assert.match(inventory, /#settings-inventory-grid #revival-pill-card\{display:none!important\}/);
  assert.match(main, /cultivation\/cultivation-inventory\.js/);
  assert.doesNotMatch(inventory, /getGoldenCoreState/);
  assert.doesNotMatch(inventory, /cultivationTraining/);
});

test('multiplayer unlock remains Foundation Establishment at 10 cultivation', () => {
  assert.match(progression, /score\(\) < FOUNDATION_SCORE/);
  assert.match(progression, /startBattleMatchmaking/);
  assert.match(progression, /btn-social-nav/);
  assert.match(progression, /接受鬥法邀請/);
});

test('post-Golden-Core realm curve is consistent across active realm renderers', () => {
  const expected = [
    ['金丹', 28], ['元嬰', 68], ['化神', 128], ['煉虛', 208],
    ['合體', 308], ['大乘', 448], ['渡劫', 628], ['真仙', 868]
  ];
  for (const source of [theme, liveSync, breakthrough]) {
    for (const [name, need] of expected) {
      assert.match(source, new RegExp(`name: '${name}'.*need: ${need}`), `${name} threshold ${need} is synchronized`);
    }
  }
  assert.match(training, /const REALM_THRESHOLDS = \[68, 128, 208, 308, 448, 628, 868\];/);
});

test('legacy compensation formula and item are preserved', () => {
  assert.match(progression, /const LEGACY_HIGH_REALM_SCORE = 150;/);
  assert.match(progression, /Math\.ceil\(\(deducted \/ 2\) \/ PILL_GAIN\)/);
  assert.match(progression, /Math\.round\(\(deducted \/ 2\) \* 2\)/);
  assert.match(progression, /回魂聚靈丹/);
  assert.match(progression, /PILL_GAIN = 100/);
  assert.match(progression, /'stats\.totalScore': FOUNDATION_SCORE/);
});

test('beginner tutorial covers scope and Foundation but never mentions Golden Core', () => {
  assert.match(tutorial, /綜合題目/);
  assert.match(tutorial, /指定題庫/);
  assert.match(tutorial, /專注練習/);
  assert.match(tutorial, /築基初期（10 修為）/);
  assert.match(tutorial, /set-source-mode/);
  assert.match(tutorial, /set-difficulty/);
  assert.doesNotMatch(tutorial, /金丹/);
});

test('Golden Core tutorial is a separate post-unlock tutorial', () => {
  assert.match(coreTutorial, /goldenCoreTutorialV1/);
  assert.match(coreTutorial, /isGoldenCoreUnlocked/);
  assert.match(coreTutorial, /training-core-orb/);
  assert.match(coreTutorial, /wash-golden-core/);
  assert.match(coreTutorial, /training-status-tab/);
  assert.match(coreTutorial, /金丹教學/);
  assert.match(main, /cultivation\/newbie-tutorial-v2\.js/);
  assert.match(main, /cultivation\/golden-core-tutorial\.js/);
  assert.doesNotMatch(main, /'\.\/newbie-tutorial\.js'/);
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
  assert.match(main, /cultivation\/cultivation-core-visual\.js/);
  assert.match(main, /cultivation\/cultivation-core-equip-warning\.js/);
  assert.match(main, /cultivation\/cultivation-status-panel\.js/);
  assert.match(main, /cultivation\/realm-breakthrough-feedback\.js/);
});


test('Golden Core roster matches the nine current pills and battle effects', () => {
  for (const name of [
    '大海無垠丹', '太初回元丹', '凝心靜音丹', '破境衝仙丹', '星辰吞月丹',
    '無垢清心丹', '萬劫雷霆丹', '陰陽反轉丹', '破鋒劍心丹'
  ]) assert.match(training, new RegExp(name));
  for (const oldName of ['破境拆牆丹', '無垢摸魚丹', '雷公安眠丹', '倒反天罡丹']) {
    assert.doesNotMatch(training, new RegExp(oldName));
  }
  assert.match(training, /chanceByGrade\(grade, 10, 5, 50\)/);
  assert.match(training, /breakthroughPercent\(grade\)/);
  assert.match(training, /chanceByGrade\(grade, 20, 10, 100\)/);
  assert.match(training, /bonusGain: 3/);
  assert.match(statusPanel, /sword: \{ icon: '⚔', tone: 'silver' \}/);
  assert.match(battleEffects, /extraDamage: 100/);
  assert.match(battleEffects, /extraDamage: 200/);
  assert.match(battleEffects, /chanceByGrade\(core\.grade, 10, 10, 90\)/);
  assert.match(battleEffects, /reflectDamage: damage/);
  assert.match(main, /cultivation\/golden-core-battle-effects\.js/);
  assert.match(legacy, /goldenCore: window\.getEquippedGoldenCoreBattleSnapshot/);
  assert.match(legacy, /resolveGoldenCoreBattleAttack/);
  assert.match(legacy, /resolveGoldenCoreBattleCounter/);
});
