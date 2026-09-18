const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const catalog = read('public/cultivation/artifact-catalog.js');
const system = read('public/cultivation/artifact-system.js');
const resolverSource = read('public/cultivation/artifact-battle-effects.js');
const manager = read('public/cultivation/admin-artifact-manager.js');
const legacy = read('public/main-legacy.js');
const main = read('public/main.js');

function loadResolver(randomValue = 0.5) {
  const math = Object.create(Math);
  math.random = () => randomValue;
  const context = { window: {}, Math: math };
  vm.runInNewContext(resolverSource, context);
  return context.window;
}

function player(effects, extra = {}) {
  return {
    uid: extra.uid || 'p1',
    hp: extra.hp ?? 1000,
    maxHp: extra.maxHp ?? 1000,
    artifactShield: extra.artifactShield ?? 0,
    artifactBattle: {
      version: 1,
      effects: effects.map((effect, index) => ({
        artifactId: effect.artifactId || 'artifact-' + index,
        artifactName: effect.artifactName || '測試法寶',
        effectIndex: index,
        ...effect
      }))
    },
    ...extra
  };
}

test('catalog exposes useful flat and percentage combat effects but no battle-start/post-battle healing', () => {
  for (const type of [
    'equip_damage_percent',
    'equip_damage_reduction_flat',
    'equip_damage_reduction_percent',
    'equip_crit_chance',
    'equip_crit_damage_percent',
    'equip_combo_chance',
    'equip_lifesteal_percent',
    'equip_reflect_percent',
    'equip_shield_flat',
    'equip_true_damage_flat',
    'equip_low_hp_damage_percent',
    'equip_low_hp_reduction_percent',
    'equip_first_hit_reduction_percent',
    'equip_damage_cap_percent',
    'equip_on_correct_shield_flat',
    'equip_cheat_death',
    'equip_copy_enemy_artifact'
  ]) {
    assert.match(catalog, new RegExp("'" + type + "'"));
  }
  assert.doesNotMatch(catalog, /battle_start_heal|post_battle_heal|battle_end_heal/);
});

test('combo chance is hard capped at ten percent in catalog, admin and runtime', () => {
  assert.match(catalog, /equip_combo_chance:\s*0\.10/);
  assert.match(manager, /valueInput\.max = '0\.10'/);
  assert.match(manager, /Math\.min\(0\.10, Math\.max\(0, value\)\)/);
  assert.match(resolverSource, /COMBO_CHANCE_CAP = 0\.10/);

  const runtime = loadResolver(0);
  const attack = runtime.resolveArtifactBattleAttack({
    attacker: player([{ type: 'equip_combo_chance', value: 0.9 }]),
    defender: player([], { uid: 'p2' }),
    baseDamage: 100
  });
  assert.equal(attack.comboChance, 0.10);
  assert.equal(attack.combo, true);
  assert.equal(attack.normalDamage, 200);
});

test('flat and percentage damage reduction stack in actual PvP resolver', () => {
  const runtime = loadResolver();
  const defender = player([
    { type: 'equip_damage_reduction_percent', value: 0.20 },
    { type: 'equip_damage_reduction_flat', value: 100 }
  ], { uid: 'defender' });

  const result = runtime.resolveArtifactBattleDefense({
    defender,
    attacker: player([], { uid: 'attacker' }),
    normalDamage: 1000,
    trueDamage: 0
  });

  assert.equal(result.hpDamage, 700);
  assert.equal(result.reductionPercent, 0.20);
  assert.equal(result.flatReduction, 100);
});

test('true damage bypasses normal reduction while shields still absorb final incoming damage', () => {
  const runtime = loadResolver();
  const defender = player(
    [{ type: 'equip_damage_reduction_percent', value: 0.50 }],
    { uid: 'defender', artifactShield: 100 }
  );
  const result = runtime.resolveArtifactBattleDefense({
    defender,
    attacker: player([], { uid: 'attacker' }),
    normalDamage: 200,
    trueDamage: 80
  });
  // 200 -> 100 after reduction, plus 80 true = 180, shield absorbs 100.
  assert.equal(result.shieldAbsorbed, 100);
  assert.equal(result.hpDamage, 80);
  assert.equal(defender.artifactShield, 0);
});

test('cheat death leaves one HP and is marked consumed for the battle', () => {
  const runtime = loadResolver();
  const defender = player([{ type: 'equip_cheat_death', value: 0 }], {
    uid: 'defender',
    hp: 500,
    maxHp: 1000
  });
  const first = runtime.resolveArtifactBattleDefense({
    defender,
    attacker: player([], { uid: 'attacker' }),
    normalDamage: 900,
    trueDamage: 0
  });
  assert.equal(first.hpDamage, 499);
  assert.equal(first.cheatDeath, true);
  assert.equal(defender.artifactCheatDeathUsed, true);

  defender.hp = 1;
  const second = runtime.resolveArtifactBattleDefense({
    defender,
    attacker: player([], { uid: 'attacker' }),
    normalDamage: 100,
    trueDamage: 0
  });
  assert.equal(second.cheatDeath, false);
  assert.ok(second.hpDamage >= 1);
});

test('copy-enemy-artifact effect deterministically mirrors one eligible enemy combat effect', () => {
  const runtime = loadResolver();
  const mirror = player([{ type: 'equip_copy_enemy_artifact', value: 0 }], { uid: 'mirror' });
  const enemy = player([
    { type: 'equip_damage_reduction_percent', value: 0.25, artifactName: '玄武甲' },
    { type: 'equip_copy_enemy_artifact', value: 0, artifactName: '照妖鏡' }
  ], { uid: 'enemy' });

  const copied = runtime.getArtifactBattleCopiedEffect(mirror, enemy);
  assert.ok(copied);
  assert.equal(copied.type, 'equip_damage_reduction_percent');
  assert.equal(copied.value, 0.25);
  assert.equal(copied.copiedFromEnemy, true);
});

test('lifesteal, reflect, low-hp bonuses and on-correct shield are present in resolver output', () => {
  const runtime = loadResolver(0.99);
  const attacker = player([
    { type: 'equip_lifesteal_percent', value: 0.12 },
    { type: 'equip_low_hp_damage_percent', value: 0.25 },
    { type: 'equip_on_correct_shield_flat', value: 120 }
  ], { uid: 'a', hp: 250, maxHp: 1000 });
  const defender = player([
    { type: 'equip_reflect_percent', value: 0.20 },
    { type: 'equip_low_hp_reduction_percent', value: 0.20 }
  ], { uid: 'd', hp: 250, maxHp: 1000 });

  const attack = runtime.resolveArtifactBattleAttack({ attacker, defender, baseDamage: 100 });
  assert.equal(attack.normalDamage, 125);
  assert.equal(attack.lifestealPercent, 0.12);
  assert.equal(attack.shieldGain, 120);

  const defense = runtime.resolveArtifactBattleDefense({
    defender,
    attacker,
    normalDamage: attack.normalDamage,
    trueDamage: attack.trueDamage
  });
  assert.equal(defense.hpDamage, 100);
  assert.equal(defense.reflectDamage, 20);
});

test('artifact system snapshots equipped combat effects and legacy PvP carries them into room state', () => {
  assert.match(system, /window\.getArtifactBattleSnapshot/);
  assert.match(system, /BATTLE_RUNTIME_EFFECTS/);
  assert.match(system, /openingShield/);

  assert.match(legacy, /function buildLocalBattlePlayer\(\)/);
  assert.match(legacy, /window\.getCombatStats\?\.\(\)/);
  assert.match(legacy, /window\.getArtifactBattleSnapshot\?\.\(\)/);
  assert.match(legacy, /artifactShield: openingShield/);
  assert.match(legacy, /resolveArtifactBattleAttack/);
  assert.match(legacy, /resolveArtifactBattleDefense/);
  assert.match(legacy, /lifestealPercent/);
  assert.match(legacy, /法寶反震/);

  const systemIndex = main.indexOf("'./cultivation/artifact-system.js'");
  const battleEffectsIndex = main.indexOf("'./cultivation/artifact-battle-effects.js'");
  const battleIndex = main.indexOf("'./cultivation/battle-mode-v2.js'");
  assert.ok(systemIndex >= 0 && battleEffectsIndex > systemIndex && battleIndex > battleEffectsIndex);
});

test('admin guide includes copy-enemy effect and both flat/percentage defensive choices', () => {
  assert.match(manager, /鏡映敵方法寶/);
  assert.match(manager, /固定減傷/);
  assert.match(manager, /百分比減傷/);
  assert.match(manager, /硬上限：0\.10 = 10%/);
  assert.match(manager, /不會複製「複製」本身/);
});
