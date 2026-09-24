const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const source = read('public/cultivation/nascent-soul-rules.js');
const rules = vm.runInNewContext(source.replace(/^export /gm, '') +
  '\n({ NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward, NASCENT_SOUL_ATTRIBUTES, NASCENT_SOUL_NODE_CAP, NASCENT_SOUL_BRANCH_UNLOCK, soulNodes, soulSkills, normalizeSoulTree, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses })');
const { NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward,
  NASCENT_SOUL_ATTRIBUTES, NASCENT_SOUL_NODE_CAP, NASCENT_SOUL_BRANCH_UNLOCK, soulNodes, soulSkills, normalizeSoulTree, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses } = rules;

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


test('six nodes reach 10/10; each click spends one spirit without changing stage', () => {
  assert.equal(NASCENT_SOUL_ATTRIBUTES.length, 2);
  assert.equal(NASCENT_SOUL_NODE_CAP, 10);
  assert.equal(NASCENT_SOUL_BRANCH_UNLOCK, 5);
  const ids = soulNodes('sword').map(node => node.id);
  assert.deepEqual(Array.from(ids), ['leftTop','leftMain','leftBottom','rightMain','rightTop','rightBottom']);
  let tree = null;
  for (let i = 1; i <= 10; i++) {
    const result = allocateSoulNode(tree, 'sword', 'leftMain', 80);
    assert.equal(result.ok, true);
    assert.equal(result.cost, 1);
    assert.equal(result.remaining, 80 - i);
    tree = result.tree;
  }
  assert.equal(soulNodeStatus(tree, 'sword', 'leftMain', 80).ok, false);
  assert.equal(soulSpentSpirit(tree), 10);
  assert.equal(nascentSoulStage(80).name, '通靈');
  assert.equal(soulCombatBonuses(tree, 'sword').attackFlat, 120);
});

test('both outward branches need five points in their respective main node', () => {
  let tree = null;
  assert.match(soulNodeStatus(tree, 'thunder', 'leftTop', 100).reason, /前置需達 5/);
  assert.match(soulNodeStatus(tree, 'thunder', 'rightBottom', 100).reason, /前置需達 5/);
  for (let i = 0; i < 4; i++) tree = allocateSoulNode(tree, 'thunder', 'leftMain', 100).tree;
  assert.equal(soulNodeStatus(tree, 'thunder', 'leftTop', 100).ok, false);
  tree = allocateSoulNode(tree, 'thunder', 'leftMain', 100).tree;
  assert.equal(soulNodeStatus(tree, 'thunder', 'leftTop', 100).ok, true);
  assert.equal(soulNodeStatus(tree, 'thunder', 'leftBottom', 100).ok, true);
  assert.equal(soulNodeStatus(tree, 'thunder', 'rightTop', 100).ok, false);
  const lit = allocateSoulNode(tree, 'thunder', 'leftTop', 100);
  assert.equal(lit.cost, 1);
  assert.equal(soulCombatBonuses(lit.tree, 'thunder').bonusDamage, 8);
});

test('nine soul branches have distinct names and persistent per-type progress', () => {
  const all = Object.keys(NASCENT_SOUL_TYPES);
  for (const type of all) {
    const skills = soulSkills(type);
    assert.equal(skills.length, 4);
    assert.equal(new Set(skills.map(skill => skill.name)).size, 4);
    assert.deepEqual(Array.from(skills, skill => skill.id), ['leftTop','leftBottom','rightTop','rightBottom']);
  }
  assert.equal(new Set(all.map(type => soulSkills(type)[0].name)).size, 9);
  const sword = allocateSoulNode(null, 'sword', 'leftMain', 20);
  const ocean = allocateSoulNode(sword.tree, 'ocean', 'rightMain', 20);
  assert.equal(soulAvailableSpirit(ocean.tree, 20), 18);
  assert.equal(soulCombatBonuses(ocean.tree, 'sword').attackFlat, 12);
  assert.equal(soulCombatBonuses(ocean.tree, 'ocean').maxHpFlat, 70);
});

test('old paid upgrades migrate without erasing paid spirit or charging twice', () => {
  const legacy = { version:1, paths:{
    thunder: { nodes:{ attack:2, vitality:1, focus:1, seed:1 } },
    sword: { nodes:{ vitality:2, form:1, seed:1 } }
  }};
  const fixed = normalizeSoulTree(legacy);
  assert.equal(fixed.version, 2);
  assert.equal(fixed.paths.thunder.nodes.leftMain, 5);
  assert.equal(fixed.paths.thunder.nodes.leftTop, 1);
  assert.equal(fixed.paths.thunder.nodes.leftBottom, 2);
  assert.equal(fixed.paths.thunder.legacySpent, 45);
  assert.equal(fixed.paths.sword.legacySpent, 70);
  assert.equal(soulSpentSpirit(fixed), 115);
  assert.equal(soulSpentSpirit(normalizeSoulTree(fixed)), 115);
  const next = allocateSoulNode(fixed, 'thunder', 'leftMain', 120);
  assert.equal(next.ok, true);
  assert.equal(soulSpentSpirit(next.tree), 116);
  assert.equal(next.remaining, 4);
});

test('available spirit cannot go below zero or spend again at cap', () => {
  const earned = 6;
  let tree = allocateSoulNode(null,'taichu','rightMain',earned).tree;
  for (let i = 0; i < 5; i++) tree = allocateSoulNode(tree,'taichu','rightMain',earned).tree;
  assert.equal(soulAvailableSpirit(tree,earned),0);
  assert.equal(soulNodeStatus(tree,'taichu','rightMain',earned).ok,false);
  assert.equal(allocateSoulNode(tree,'taichu','rightMain',earned).ok,false);
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
  assert.match(css, /\.ns-tree-viewport/);
  assert.match(css, /\.ns-orbit-node\.ns-light-btn:disabled/);
  assert.match(training, /ns-tree-viewport ns-trees/);
  assert.match(training, /ns-branches/);
  assert.match(css, /\.ns-pos-leftTop/);
  assert.match(css, /\.ns-pos-rightBottom/);
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


test('nascent soul map stays inside one viewport with fixed navigation and HUD', () => {
  const training = read('public/cultivation/cultivation-training-v4.js');
  const css = read('public/cultivation-training-v3.css');
  assert.match(training, /document\.body\.classList\.toggle\('ns-map-active'/);
  assert.match(training, /class="ns-branch-intro"/);
  assert.match(training, /class="ns-tree-tip"/);
  assert.match(training, /class="ns-tree-viewport ns-trees" role="group"/);
  assert.doesNotMatch(training, /ns-tree-viewport'\)\?\.scrollLeft/);
  assert.doesNotMatch(training, /窄螢幕可左右捲動|手機或窄螢幕可左右滑動/);
  assert.match(css, /body\.xianxia-theme\.ns-map-active main:has\(#page-training\.active-page\)\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(css, /\.ns-branch-panel\s*\{[\s\S]*?grid-template-rows:\s*auto auto minmax\(0,1fr\) auto auto\s*!important/);
  assert.match(css, /#training-tab-content\s*\{[\s\S]*?max-height:\s*100%\s*!important/);
  assert.match(css, /\.ns-tree-viewport\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
  assert.match(css, /\.ns-diagram\s*\{[\s\S]*?min-width:\s*0\s*!important/);
  assert.match(css, /\.ns-tree-core \.golden-core-stage-v3\s*\{[\s\S]*?min-height:\s*0\s*!important/);
});
