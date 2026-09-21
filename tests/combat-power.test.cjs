const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '../public', path), 'utf8');
const source = read('cultivation/combat-power.js');
const main = read('main.js');
const status = read('cultivation/cultivation-status-panel.js');
const battle = read('cultivation/battle-mode-v2.js');
const tutorial = read('cultivation/battle-tutorial.js');
const bag = read('cultivation/unified-inventory-grid.js');

const slots = ['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶'];
const realm = { 凡人:0, 煉氣:1, 築基:2, 金丹:3, 元嬰:4, 化神:5, 煉虛:6, 合體:7, 大乘:8, 渡劫:9, 真仙:10 };
const fixtures = {
  sword: {id:'sword',name:'青鋒',realm:'金丹',equipSlot:'本命法寶',effects:[{type:'equip_attack_flat',value:100}]},
  robe: {id:'robe',name:'天衣',realm:'元嬰',equipSlot:'護身法寶',effects:[{type:'equip_hp_flat',value:300},{type:'equip_damage_reduction_percent',value:0.2}]},
  loose: {id:'loose',name:'未裝備仙器',realm:'真仙',equipSlot:'輔助法寶',effects:[{type:'equip_damage_percent',value:1}]},
  potion: {id:'potion',name:'一次性丹藥',realm:'真仙',effects:[{type:'timed_attack_multiplier',multiplier:2}]}
};
function loadPower() {
  const window = {};
  const context = { window, ARTIFACT_EQUIP_SLOTS: slots, getArtifactById:(id) => fixtures[id] || null, realmOrderByName:(name) => realm[name] ?? 0 };
  const code = source.replace(/^import .*?;\s*$/gm, '').replace(/export function /g, 'function ') +
    '\nthis.power={calculateGoldenCorePower,calculateArtifactPower,calculateCombatPower,getCurrentCombatPower};';
  vm.runInNewContext(code, context);
  return {power:context.power, window};
}
test('Golden Core power depends solely on quality, with first grade strongest and no unequipped benefit', () => {
  const { power } = loadPower();
  assert.equal(power.calculateGoldenCorePower(null), 0);
  assert.equal(power.calculateGoldenCorePower({type:'sword', grade:1}), 20000);
  assert.equal(power.calculateGoldenCorePower({type:'ocean', grade:1}), 20000);
  assert.equal(power.calculateGoldenCorePower({type:'sword', grade:9}), 4000);
  assert.equal(power.calculateGoldenCorePower({type:'sword', grade:1,equipped:false}), 0);
  assert.equal(power.calculateGoldenCorePower({type:'sword', grade:0}), 4000);
  assert.equal(power.calculateGoldenCorePower({type:'sword', grade:10}), 4000);
});
test('artifact power includes realm quality and combat effects, never consumables', () => {
  const {power}=loadPower();
  assert.equal(power.calculateArtifactPower(fixtures.potion),0);
  assert.equal(power.calculateArtifactPower(fixtures.sword),45 * 4 ** 2 + 150);
  assert.equal(power.calculateArtifactPower(fixtures.robe),45 * 5 ** 2 + 90 + 130);
  assert.ok(power.calculateArtifactPower(fixtures.robe)>power.calculateArtifactPower(fixtures.sword));
});
test('only possessed artifacts in the correct four equipment slots contribute power', () => {
  const {power}=loadPower();
  const snapshot=power.calculateCombatPower({
    stats:{attack:200,maxHp:1000}, core:{type:'ocean',grade:3},
    inventory:{sword:1,robe:1,loose:1,potion:1},
    equipped:{'本命法寶':'sword','護身法寶':'robe','輔助法寶':'potion'}
  });
  assert.equal(snapshot.base,600);
  assert.equal(snapshot.core,16000);
  assert.equal(snapshot.equipment, power.calculateArtifactPower(fixtures.sword)+power.calculateArtifactPower(fixtures.robe));
  assert.equal(snapshot.total, snapshot.base+snapshot.core+snapshot.equipment);
  assert.deepEqual(Array.from(snapshot.items, item=>item.name),['青鋒','天衣']);
  const noCore=power.calculateCombatPower({stats:{attack:200,maxHp:1000},equipped:{'本命法寶':'sword'},inventory:{sword:0}});
  assert.equal(noCore.total,600);
});
test('battle and status snapshot the same combat rating, without touching actual attack or HP', () => {
  assert.match(main, /'\.\/cultivation\/combat-power\.js'/);
  assert.ok(main.indexOf("'./cultivation/artifact-battle-effects.js'") < main.indexOf("'./cultivation/combat-power.js'"));
  assert.ok(main.indexOf("'./cultivation/combat-power.js'") < main.indexOf("'./cultivation/battle-mode-v2.js'"));
  assert.match(status, /power: window\.getCombatPower\?\.\(\)/);
  assert.match(status, /綜合戰力/);
  assert.match(status, /金丹 · 品質/);
  assert.match(battle, /combatPower: Math\.max\(0, Math\.round\(Number\(window\.getCombatPower\?\.\(\)\.total\)/);
  assert.match(battle, /function playerPowerLabel/);
  assert.match(tutorial, /combatPower: Math\.max\(0, Math\.round\(Number\(window\.getCombatPower\?\.\(\)\.total\)/);
  assert.match(bag, /window\.calculateArtifactPower\?\.\(item\)/);
  assert.match(bag, /法寶戰力/);
});
