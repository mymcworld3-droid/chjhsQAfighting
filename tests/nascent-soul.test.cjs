const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const source = read('public/cultivation/nascent-soul-rules.js');
const rules = vm.runInNewContext(source.replace(/^export /gm, '') +
  '\n({ NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward, NASCENT_SOUL_ATTRIBUTES, soulSkills, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses })');
const { NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward,
  NASCENT_SOUL_ATTRIBUTES, soulSkills, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses } = rules;

test('all nine golden cores map to separate nascent souls with a talent', () => {
  const ids = ['ocean','taichu','ningxin','pojing','xingchen','wugou','thunder','reverse','sword'];
  assert.deepEqual(Object.keys(NASCENT_SOUL_TYPES).sort(), ids.sort());
  assert.equal(new Set(ids.map(id => nascentSoulForCore(id).name)).size, 9);
  for (const id of ids) {
    assert.ok(nascentSoulForCore(id).trait);
    assert.ok(nascentSoulForCore(id).description);
  }
});

test('spirit increases only for eligible correct solo answers and full daily meditation', () => {
  const gain = nascentSoulSpiritReward;
  assert.equal(gain({source:'solo',score:67,isCorrect:true}),0);
  assert.equal(gain({source:'solo',score:68,isCorrect:true}),1);
  assert.equal(gain({source:'solo',score:128,isCorrect:false}),0);
  assert.equal(gain({source:'daily-meditation',score:68,correct:3,total:3}),3);
  assert.equal(gain({source:'daily-meditation',score:68,correct:2,total:3}),0);
  assert.equal(gain({source:'daily-meditation',score:28,correct:3,total:3}),0);
});

test('each cave completion awards number of correct answers; stage thresholds are monotone', () => {
  const gain = nascentSoulSpiritReward;
  assert.equal(gain({source:'dongtian',score:68,correct:7,total:10}),7);
  assert.equal(gain({source:'dongtian',score:68,correct:999,total:10}),10);
  assert.equal(gain({source:'dongtian',score:67,correct:7,total:10}),0);
  assert.equal(nascentSoulStage(29).name,'初生');
  assert.equal(nascentSoulStage(30).name,'凝神');
  assert.equal(nascentSoulStage(250).name,'圓滿');
});

test('rewards persist through existing settlement, and cave replay is idempotent by runId', () => {
  const solo = read('public/main-legacy.js');
  const daily = read('public/cultivation/daily-meditation.js');
  const cave = read('public/cultivation/dongtian.js');
  const training = read('public/cultivation/cultivation-training-v4.js');
  assert.match(solo,/stats\.nascentSoulSpirit = normalizeSpirit\(stats\.nascentSoulSpirit\) \+ spiritAdded/);
  assert.match(daily,/lastDate === current\.date[\s\S]*'stats\.nascentSoulSpirit': increment\(spiritAdded\)/);
  assert.match(cave,/lastSpiritRunId === s\.runId/);
  assert.match(cave,/lastSpiritRunId: s\.runId/);
  assert.match(cave,/if \(spiritAdded\) tx\.update\(playerRef, \{ 'stats\.nascentSoulSpirit': increment\(spiritAdded\) \}\)/);
  assert.match(training,/activeTab === 'nascent-soul' \? nascentSoulTabMarkup\(\)/);
});


test('attribute investments cost the stated amount and keep the earned spirit stage', () => {
  assert.equal(NASCENT_SOUL_ATTRIBUTES.length, 3);
  const first = allocateSoulNode(null, 'sword', 'attack', 30);
  assert.equal(first.ok, true);
  assert.equal(first.cost, 5);
  assert.equal(first.remaining, 25);
  assert.equal(soulSpentSpirit(first.tree), 5);
  const second = allocateSoulNode(first.tree, 'sword', 'attack', 30);
  assert.equal(second.cost, 10);
  assert.equal(second.remaining, 15);
  assert.equal(nascentSoulStage(30).name, '凝神');
  assert.equal(soulCombatBonuses(second.tree, 'sword').attackFlat, 24);
  assert.equal(soulCombatBonuses(second.tree, 'ocean').attackFlat, 0);
});

test('skill tree checks prerequisites, lifetime thresholds and available spirit', () => {
  const blank = soulNodeStatus({}, 'thunder', 'seed', 250);
  assert.equal(blank.ok, false);
  assert.match(blank.reason, /先點亮一項基礎屬性/);
  const attr = allocateSoulNode(null, 'thunder', 'focus', 250);
  assert.equal(soulNodeStatus(attr.tree, 'thunder', 'seed', 29).ok, false);
  assert.equal(soulNodeStatus(attr.tree, 'thunder', 'seed', 30).ok, true);
  const first = allocateSoulNode(attr.tree, 'thunder', 'seed', 250);
  assert.equal(first.cost, 20);
  assert.equal(soulNodeStatus(first.tree, 'thunder', 'realm', 250).ok, false);
  const second = allocateSoulNode(first.tree, 'thunder', 'form', 250);
  assert.equal(second.cost, 35);
  const third = allocateSoulNode(second.tree, 'thunder', 'realm', 250);
  assert.equal(third.cost, 55);
  assert.equal(soulCombatBonuses(third.tree, 'thunder').bonusDamage, 8 + 48 + 30);
  assert.equal(soulCombatBonuses(third.tree, 'thunder').attackFlat, 24 + 12 + 28);
  assert.equal(allocateSoulNode(third.tree, 'thunder', 'realm', 250).ok, false);
});

test('different soul types preserve their investments but draw from the same spirit balance', () => {
  const sword = allocateSoulNode(null, 'sword', 'attack', 20);
  const ocean = allocateSoulNode(sword.tree, 'ocean', 'vitality', 20);
  assert.equal(ocean.ok, true);
  assert.equal(soulAvailableSpirit(ocean.tree, 20), 10);
  assert.equal(soulCombatBonuses(ocean.tree, 'sword').attackFlat, 12);
  assert.equal(soulCombatBonuses(ocean.tree, 'ocean').maxHpFlat, 70);
  assert.equal(allocateSoulNode(ocean.tree, 'sword', 'attack', 10).ok, false);
});

test('nine nascent soul branches have unique tier titles and nonzero passive effects', () => {
  const all = Object.keys(NASCENT_SOUL_TYPES);
  for (const type of all) {
    const skills = soulSkills(type);
    assert.equal(skills.length, 3);
    assert.equal(new Set(skills.map(skill => skill.name)).size, 3);
    assert.ok(skills.every(skill => skill.attackFlat + skill.maxHpFlat + skill.bonusDamage > 0));
    assert.deepEqual(Array.from(skills, skill => skill.id), ['seed','form','realm']);
  }
  assert.equal(new Set(all.map(type => soulSkills(type)[0].name)).size, 9);
});

test('training mutations use Firestore transaction and separate trees from the reward ledger', () => {
  const training = read('public/cultivation/cultivation-training-v4.js');
  const combat = read('public/cultivation/cultivation-combat-stats.js');
  const power = read('public/cultivation/combat-power.js');
  const battle = read('public/cultivation/battle-mode-v2.js');
  const engine = read('public/cultivation/battle-engine-v2.js');
  const css = read('public/cultivation-training-v3.css');
  assert.match(training, /await runTransaction\(db, async tx =>/);
  assert.match(training, /tx\.update\(ref, \{ nascentSoulTree: awarded\.tree \}\)/);
  assert.match(training, /data-ns-node=/);
  assert.match(training, /window\.getNascentSoulBattleSnapshot/);
  assert.match(combat, /window\.getNascentSoulBattleSnapshot\?\.\(\)/);
  assert.match(power, /window\.getNascentSoulBattleSnapshot\?\.\(\)/);
  assert.match(battle, /nascentSoul: nascentSoul \?/);
  assert.match(engine, /soulDamage/);
  assert.match(css, /\.ns-trees/);
  assert.match(css, /\.ns-light-btn:disabled/);
});

test('duel bonus damage from nascent soul is fixed in the match and applies only on a correct hit', () => {
  const source = read('public/cultivation/battle-engine-v2.js')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  const context = vm.createContext({ console, Math, Number, String, Object, Array });
  vm.runInContext(source + '\nthis.settle=settleBattleRound;', context);
  const player = (id, correct, withSoul) => ({
    uid: id, name: id, hp: 1000, maxHp: 1000, atk: 200, goldenCore: null,
    nascentSoul: withSoul ? {type:'sword', bonusDamage: 45} : null,
    answer: { correct, atMs: 1000 }
  });
  const correct = context.settle({roomId:'soul-a',round:1,host:player('h',true,true),guest:player('g',false,false)});
  assert.equal(correct.guestHp, 755);
  assert.equal(correct.steps.find(step => step.type === 'attack').extraDamage, 45);
  const wrong = context.settle({roomId:'soul-b',round:1,host:player('h',false,true),guest:player('g',false,false)});
  assert.equal(wrong.guestHp, 1000);
});
