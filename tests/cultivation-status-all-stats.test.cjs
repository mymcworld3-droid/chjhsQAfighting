const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { spawnSync } = require('node:child_process');

const path = join(__dirname, '../public/cultivation/cultivation-status-panel.js');
const status = readFileSync(path, 'utf8');
const css = readFileSync(join(__dirname, '../public/cultivation-status-panel.css'), 'utf8');

function getStatList() {
  const window = {};
  const document = { readyState: 'loading', addEventListener() {} };
  runInNewContext(status, { window, document, Intl, Number, Object, Array, Math, String, JSON });
  assert.equal(typeof window.getCultivationStatusStats, 'function');
  return window.getCultivationStatusStats;
}

test('status script passes syntax check and uses actual equipped artifact battle snapshot', () => {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(status, /window\.getArtifactBattleSnapshot\?\.\(\)/);
  assert.match(status, /window\.getCombatStats\?\.\(\)/);
  assert.match(status, /window\.getEquippedGoldenCoreState\?\.\(\)/);
});

test('displayed values sort as HP 1000, attack 200, combo 9%, reduction 5%', () => {
  const build = getStatList();
  const list = build({ hp: 1000, maxHp: 1000, attack: 200 }, {
    effects: [
      { type: 'equip_damage_reduction_percent', value: 0.05 },
      { type: 'equip_combo_chance', value: 0.09 }
    ]
  });
  assert.deepEqual(Array.from(list, item => [item.label, item.value]), [
    ['生命值', '1,000'], ['攻擊力', '200'], ['連擊率', '9%'], ['減傷', '5%']
  ]);
});

test('battle caps and stacking match the effects engine and unsupported effects are omitted', () => {
  const build = getStatList();
  const list = build({ hp: 3000, maxHp: 3000, attack: 200 }, {
    effects: [
      { type: 'equip_combo_chance', value: 0.09 },
      { type: 'equip_combo_chance', value: 0.06 },
      { type: 'equip_damage_reduction_percent', value: 0.50 },
      { type: 'equip_damage_reduction_percent', value: 0.50 },
      { type: 'equip_crit_chance', value: 0.60 },
      { type: 'equip_crit_chance', value: 0.60 },
      { type: 'equip_lifesteal_percent', value: 0.35 },
      { type: 'equip_lifesteal_percent', value: 0.35 },
      { type: 'equip_damage_cap_percent', value: 0.8 },
      { type: 'equip_damage_cap_percent', value: 0.4 },
      { type: 'timed_attack_multiplier', value: 9 }
    ]
  });
  const byKey = Object.fromEntries(Array.from(list, stat => [stat.key, stat.value]));
  assert.equal(byKey.equip_combo_chance, '10%');
  assert.equal(byKey.equip_damage_reduction_percent, '90%');
  assert.equal(byKey.equip_crit_chance, '75%');
  assert.equal(byKey.equip_lifesteal_percent, '50%');
  assert.equal(byKey.equip_damage_cap_percent, '40%');
  assert.equal(byKey.timed_attack_multiplier, undefined);
  assert.ok(list.every((stat, i) => i === 0 || list[i - 1].sortValue >= stat.sortValue));
});

test('current HP is clamped and conditional bonuses carry a caveat rather than being applied to base attack', () => {
  const build = getStatList();
  const list = build({ hp: 1200, maxHp: 1000, attack: 200 }, {
    effects: [{ type: 'equip_low_hp_damage_percent', value: 0.3 }]
  });
  assert.equal(list.find(item => item.key === 'hp').value, '1,000');
  const conditional = list.find(item => item.key === 'equip_low_hp_damage_percent');
  assert.equal(conditional.value, '30%');
  assert.match(conditional.note, /≤30%/);
});

test('status panel scrolls through dynamically sized numeric cards on mobile', () => {
  assert.match(css, /\.status-player-section\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.status-stat-grid\.status-stat-grid-simple\s*\{[\s\S]*?height:\s*auto/);
  assert.match(css, /grid-template-rows:\s*none/);
  assert.match(status, /stats\.map\(stat => statCard/);
  assert.match(status, /由高至低/);
});
