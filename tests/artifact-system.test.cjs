const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const catalog = read('public/cultivation/artifact-catalog.js');
const system = read('public/cultivation/artifact-system.js');
const main = read('public/main.js');
const rules = read('public/cultivation/cultivation-rules.js');
const battle = read('public/cultivation/battle-mode-v2.js');
const dongtian = read('public/cultivation/dongtian.js');

test('artifact definitions live in one catalog and the engine contains no hard-coded sample artifact names', () => {
  assert.match(catalog, /export const ARTIFACT_CATALOG/);
  assert.match(catalog, /七寶玲瓏尺/);
  assert.match(catalog, /破軍戰鼓/);
  assert.match(catalog, /悟道玄燈/);
  assert.match(catalog, /鎮嶽玄甲/);
  assert.match(catalog, /太虛劍/);
  assert.match(catalog, /長生玉佩/);

  for (const name of ['七寶玲瓏尺', '破軍戰鼓', '悟道玄燈', '鎮嶽玄甲', '太虛劍', '長生玉佩']) {
    assert.doesNotMatch(system, new RegExp(name));
  }
  assert.match(system, /ARTIFACT_CATALOG\.map\(forgeItemMarkup\)/);
});

test('catalog supports every requested artifact behavior through composable effect descriptors', () => {
  assert.match(catalog, /type: 'timed_attack_multiplier'/);
  assert.match(catalog, /type: 'timed_cultivation_multiplier'/);
  assert.match(catalog, /type: 'equip_attack_flat'/);
  assert.match(catalog, /type: 'equip_hp_flat'/);
  assert.match(catalog, /type: 'remove_wrong_option'/);
  assert.match(catalog, /contexts: \['quiz', 'battle', 'dongtian'\]/);
});

test('forge is mounted in Dongfu and all player realms can equip any artifact tier', () => {
  assert.match(system, /id = 'artifact-forge-card'|card\.id = 'artifact-forge-card'/);
  assert.match(system, />煉器室</);
  assert.match(system, /所有境界的修士都能裝備任何境界的裝備型法寶/);
  assert.doesNotMatch(system, /realmOrderByName\(item\?\.realm\) >= currentRealm\(\)\.order/);
  assert.doesNotMatch(system, /低於你目前的.*境界，不能裝備/);
  assert.match(system, /enforceEquipmentEligibility/);
  assert.match(system, /delete next\.equipped\[slot\]/);
});

test('combat and cultivation read generic artifact effects without artifact-specific game-page code', () => {
  const combatIndex = main.indexOf("'./cultivation/cultivation-combat-stats.js'");
  const artifactIndex = main.indexOf("'./cultivation/artifact-system.js'");
  const battleIndex = main.indexOf("'./cultivation/battle-mode-v2.js'");
  assert.ok(combatIndex >= 0 && artifactIndex > combatIndex && battleIndex > artifactIndex);

  assert.match(system, /window\.getCombatStats = wrapped/);
  assert.match(system, /timed_attack_multiplier/);
  assert.match(system, /equip_attack_flat/);
  assert.match(system, /equip_hp_flat/);
  assert.match(rules, /window\.applyArtifactCultivationGain/);
  assert.match(rules, /artifactBonusGain/);
  assert.match(rules, /artifactMessage/);
});

test('remove-wrong-option artifact is connected to solo quiz, Battle v2 and Dongtian with safe correct indexes', () => {
  assert.match(system, /context: 'quiz'/);
  assert.match(system, /window\.getBattleArtifactQuestionContext/);
  assert.match(system, /window\.getDongtianArtifactQuestionContext/);
  assert.match(system, /idx !== context\.correctIndex/);
  assert.match(system, /usedQuestionKeys\.has\(context\.key\)/);
  assert.match(system, /chosen\.style\.display = 'none'/);

  assert.match(battle, /window\.getBattleArtifactQuestionContext/);
  assert.match(battle, /correctIndex: Number\(question\.ans\)/);
  assert.match(battle, /buttonsSelector: '#bv2-options \.bv2-option'/);

  assert.match(dongtian, /window\.getDongtianArtifactQuestionContext/);
  assert.match(dongtian, /s\.currentOptions\.findIndex\(\(item\) => item\?\.correct\)/);
  assert.match(dongtian, /buttonsSelector: '#dongtian-overlay \[data-dt-answer\]'/);
});

test('artifact ownership, equipment and timed buffs persist in the user document', () => {
  assert.match(system, /const FIELD = 'artifactSystem'/);
  assert.match(system, /runTransaction\(database\(\)/);
  assert.match(system, /tx\.update\(ref, \{ \[FIELD\]: committed \}\)/);
  assert.match(system, /inventory/);
  assert.match(system, /equipped/);
  assert.match(system, /buffs/);
  assert.match(system, /expiresAt/);
});


test('equipment system uses four canonical slots, replaces same-slot gear, and cleans invalid equipment', () => {
  assert.match(catalog, /ARTIFACT_EQUIP_SLOTS = Object\.freeze\(\['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶'\]\)/);
  assert.match(system, /ARTIFACT_EQUIP_SLOTS/);
  assert.match(system, /function canonicalEquipSlot\(item\)/);
  assert.match(system, /ARTIFACT_EQUIP_SLOTS\.includes\(slot\)/);
  assert.match(system, /ARTIFACT_EQUIP_SLOTS\.includes\(slot\) && inventory\[id\] > 0/);
  assert.match(system, /\(item && canonicalSlot === slot\) \|\| \(!item && pendingCatalog\)/);
  assert.match(system, /replacedId = String\(next\.equipped\[slot\] \|\| ''\)/);
  assert.match(system, /next\.equipped\[slot\] = itemId/);
  assert.match(system, /已將 \$\{replaced\.name\} 替換為 \$\{item\.name\}/);
  assert.match(system, /window\.getArtifactEquipmentSlots/);
  assert.match(system, /window\.getArtifactEquipmentStatus/);
});

test('equipment writes recheck live ownership but do not reject cross-realm artifacts', () => {
  const start = system.indexOf('async function toggleEquipArtifact');
  const end = system.indexOf('async function activateTimedArtifact', start);
  const block = system.slice(start, end);
  assert.match(block, /const owned = Math\.max\(0, Number\(next\.inventory\[itemId\]\) \|\| 0\)/);
  assert.doesNotMatch(block, /const liveRealm = realmForScore/);
  assert.doesNotMatch(block, /realmOrderByName\(item\.realm\)/);
  assert.match(block, /next\.equipped\[slot\] = itemId/);
});
