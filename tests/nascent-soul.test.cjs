globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const source = read('public/cultivation/nascent-soul-rules.js');
const rules = vm.runInNewContext(source.replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm, '') +
  '\n({ NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward, normalizeSpirit, NASCENT_SOUL_ATTRIBUTES, NASCENT_SOUL_NODE_CAP, NASCENT_SOUL_BRANCH_UNLOCK, soulNodes, soulSkills, normalizeSoulTree, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses, soulNodeCost, soulCultivationBonuses, soulCultivationBonusForPlayer, soulFinalePerLevel })',
  {QANascentGrowth:globalThis.QANascentGrowth,QACombatCombo:globalThis.QACombatCombo,QASoulTalents:require('../public/cultivation/soul-talents.js')});
const { NASCENT_SOUL_TYPES, nascentSoulForCore, nascentSoulStage, nascentSoulSpiritReward,
  normalizeSpirit, NASCENT_SOUL_ATTRIBUTES, NASCENT_SOUL_NODE_CAP, NASCENT_SOUL_BRANCH_UNLOCK, soulNodes, soulSkills, normalizeSoulTree, soulAvailableSpirit, soulSpentSpirit, soulNodeStatus, allocateSoulNode, soulCombatBonuses, soulNodeCost, soulCultivationBonuses, soulCultivationBonusForPlayer, soulFinalePerLevel } = rules;

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

test('only raids and perfect meditation award new fragments; solo and cave retain cultivation',()=>{
 const solo=read('public/main-legacy.js'),daily=read('public/cultivation/daily-meditation.js'),cave=read('dongtian-settlement-api.cjs');
 assert.doesNotMatch(solo,/nascentSoulSpiritReward|savedStats.nascentSoulSpirit/);
 assert.match(daily,/originalScore >= 68 && current.correct === QUESTION_TOTAL \? 3 : 0/);
 assert.match(daily,/QANascentGrowth.patch\(growthState\)/);assert.doesNotMatch(cave,/stats.nascentSoulSpirit.*increment/);
});


test('twelve nodes reach 10/10 and preserve earned-stage progression', () => {
  assert.equal(NASCENT_SOUL_ATTRIBUTES.length,2);
  assert.equal(NASCENT_SOUL_NODE_CAP,10);
  assert.equal(NASCENT_SOUL_BRANCH_UNLOCK,5);
  const ids=soulNodes('sword').map(node=>node.id);
  assert.equal(ids.length,12);assert.equal(new Set(ids).size,12);
  for(const id of ['leftFinal','leftFarTop','leftFarBottom','rightFinal','rightFarTop','rightFarBottom'])assert.ok(ids.includes(id));
  let tree=null;
  for(let i=1;i<=10;i++){
    const r=allocateSoulNode(tree,'sword','leftMain',80);
    assert.equal(r.ok,true);assert.equal(r.cost,1);assert.equal(r.remaining,80-i);tree=r.tree;
  }
  assert.equal(soulNodeStatus(tree,'sword','leftMain',80).ok,false);
  assert.equal(soulSpentSpirit(tree),10);
  assert.equal(nascentSoulStage(80).name,'通靈');
  assert.equal(soulCombatBonuses(tree,'sword').attackFlat,120);
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
  assert.equal(lit.cost, 3);
  assert.equal(soulCombatBonuses(lit.tree, 'thunder').bonusDamage, 8);
});

test('nine soul types have distinct final talents and separate investments', () => {
  const all=Object.keys(NASCENT_SOUL_TYPES);
  for(const type of all){
    assert.equal(soulSkills(type).length,10);
    assert.equal(soulNodes(type).length,12);
    assert.ok(soulNodes(type).some(n=>n.id==='leftFinal'&&n.talentStrength>0));
    assert.ok(soulNodes(type).some(n=>n.id==='rightFinal'&&n.coreHeal>0));
  }
  assert.equal(new Set(all.map(type=>soulNodes(type).find(n=>n.id==='leftFinal').name)).size,9);
  const sword=allocateSoulNode(null,'sword','leftMain',20);
  const ocean=allocateSoulNode(sword.tree,'ocean','rightMain',20);
  assert.equal(soulAvailableSpirit(ocean.tree,20),18);
  assert.equal(soulCombatBonuses(ocean.tree,'sword').attackFlat,12);
  assert.equal(soulCombatBonuses(ocean.tree,'ocean').maxHpFlat,70);
  assert.equal(soulCultivationBonuses(ocean.tree,'ocean').solo,0);
});

test('old paid upgrades migrate without erasing paid spirit or charging twice', () => {
  const legacy = { version:1, paths:{
    thunder: { nodes:{ attack:2, vitality:1, focus:1, seed:1 } },
    sword: { nodes:{ vitality:2, form:1, seed:1 } }
  }};
  const fixed = normalizeSoulTree(legacy);
  assert.equal(fixed.version, 4);
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


test('previous v2 outer nodes keep their original one-spirit price after migration', () => {
  const old = { version: 2, paths: {
    sword: {
      nodes: { leftMain: 5, leftTop: 2, rightMain: 5, rightTop: 1 },
      baselineNodes: {},
      legacySpent: 0
    },
    ocean: {
      nodes: { leftMain: 6, leftTop: 2 },
      baselineNodes: { leftMain: 5, leftTop: 1 },
      legacySpent: 45
    }
  }};
  const migrated = normalizeSoulTree(old);
  assert.equal(migrated.version, 4);
  assert.equal(soulSpentSpirit(migrated), 13 + 47);
  assert.equal(soulSpentSpirit(normalizeSoulTree(migrated)), 60);
  const next = allocateSoulNode(migrated, 'sword', 'leftTop', 100);
  assert.equal(next.cost, 3);
  assert.equal(soulSpentSpirit(next.tree), 63);
  assert.equal(next.remaining, 37);
});

test('available spirit cannot go below zero or spend again at cap', () => {
  const earned = 6;
  let tree = allocateSoulNode(null,'taichu','rightMain',earned).tree;
  for (let i = 0; i < 5; i++) tree = allocateSoulNode(tree,'taichu','rightMain',earned).tree;
  assert.equal(soulAvailableSpirit(tree,earned),0);
  assert.equal(soulNodeStatus(tree,'taichu','rightMain',earned).ok,false);
  assert.equal(allocateSoulNode(tree,'taichu','rightMain',earned).ok,false);
});

test('new branch upgrades validate cloud core and currency inside one transaction',()=>{
 const training=read('public/cultivation/cultivation-training-v4.js');assert.match(training,/await runTransaction\(db, async tx =>/);assert.match(training,/Growth.upgrade\(data, branchId\)/);assert.match(training,/tx.update\(ref, Growth.patch\(next\)\)/);assert.match(training,/sameGoldenCore\(data.cultivationTraining\?\.equippedCore, core\)/);
});


test('duel bonus damage from nascent soul is fixed in the match and applies only on a correct hit', () => {
  const source = read('public/cultivation/battle-engine-v2.js').replace(/^import \{\} from .*;\n/gm,'')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  const context = vm.createContext({ console, Math, Number, String, Object, Array,QACombatCombo:globalThis.QACombatCombo });
  vm.runInContext(source + '\nthis.settle=settleBattleRound;', context);
  const player = (id, correct, withSoul) => ({
    uid: id, name: id, totalScore: 68, hp: 1000, maxHp: 1000, atk: 200, goldenCore: null,
    nascentSoul: withSoul ? {type:'sword', bonusDamage: 45} : null,
    answer: { correct, atMs: 1000 }
  });
  const correct = context.settle({roomId:'soul-a',round:1,host:player('h',true,true),guest:player('g',false,false)});
  assert.equal(correct.guestHp, 755);
  assert.equal(correct.steps.find(step => step.type === 'attack').extraDamage, 45);
  const wrong = context.settle({roomId:'soul-b',round:1,host:player('h',false,true),guest:player('g',false,false)});
  assert.equal(wrong.guestHp, 1000);
});


test('nascent soul combat attributes are sealed against Golden Core or lower opponents', () => {
  const source = read('public/cultivation/battle-engine-v2.js').replace(/^import \{\} from .*;\n/gm,'')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  const context = vm.createContext({ console, Math, Number, String, Object, Array,QACombatCombo:globalThis.QACombatCombo });
  vm.runInContext(source + '\nthis.settle=settleBattleRound;this.applyRule=applyNascentSoulDuelRule;', context);

  const soulHost = {
    uid:'nascent', name:'nascent', totalScore:68,
    baseAtk:200, baseMaxHp:1000, atk:320, hp:1700, maxHp:1700, combatPower:9000,
    goldenCore:null,
    nascentSoul:{type:'sword',attackFlat:120,maxHpFlat:700,bonusDamage:45,reductionFlat:30,coreHeal:24},
    answer:{correct:true,atMs:1000}
  };
  const goldenGuest = {
    uid:'golden', name:'golden', totalScore:28,
    baseAtk:200, baseMaxHp:1000, atk:200, hp:1000, maxHp:1000, combatPower:5000,
    goldenCore:null, nascentSoul:null, answer:{correct:false,atMs:1200}
  };

  const ruled = context.applyRule(soulHost, goldenGuest);
  assert.equal(ruled.host.nascentSoul, null);
  assert.equal(ruled.host.nascentSoulSuppressed, true);
  assert.equal(ruled.host.atk, 200);
  assert.equal(ruled.host.maxHp, 1000);
  assert.equal(ruled.host.hp, 1000);

  const sealed = context.settle({roomId:'seal-golden',round:1,host:soulHost,guest:goldenGuest});
  assert.equal(sealed.guestHp, 800);
  assert.equal(sealed.startHostHp, 1000);
  const sealedHit = sealed.steps.find(step => step.type === 'attack');
  assert.equal(sealedHit.baseDamage, 200);
  assert.equal(sealedHit.extraDamage, 0);

  const nascentGuest = {...goldenGuest, uid:'nascent-guest', totalScore:68};
  const active = context.settle({roomId:'seal-nascent',round:1,host:soulHost,guest:nascentGuest});
  assert.equal(active.guestHp, 635);
  assert.equal(active.startHostHp, 1700);
  const activeHit = active.steps.find(step => step.type === 'attack');
  assert.equal(activeHit.baseDamage, 320);
  assert.equal(activeHit.extraDamage, 45);
});


test('radial branches retain page scrolling instead of the retired fixed skill map',()=>{
 const training=read('public/cultivation/cultivation-training-v4.js'),css=read('public/cultivation-training-v3.css');assert.match(training,/class="ns-growth-map"/);assert.doesNotMatch(training,/ns-tree-viewport|ns-orbit-node|ns-growth-grid/);assert.match(css,/\.ns-growth-map \{ position:relative/);assert.match(css,/\.ns-growth-node \{ position:absolute/);assert.match(training,/classList.remove\('ns-map-active'\)/);
});


test('each independent radial branch is an accessible upgrade button',()=>{
 const source=read('public/cultivation/cultivation-training-v4.js');assert.match(source,/data-ns-upgrade="\$\{branch.id\}"/);assert.match(source,/saveSoulBranch\(button.dataset.nsUpgrade\)/);assert.doesNotMatch(source,/selectedSoulNodeId|前置節點/);
});

function renderGrowthMap(type, branches = {}, fragments = 20, soulBusy = false, grade = 1) {
  const source = read('public/cultivation/cultivation-training-v4.js');
  const start = source.indexOf('  function nascentSoulTabMarkup()');
  const end = source.indexOf('  async function saveSoulBranch', start);
  const core = {type, grade};
  const player = {stats:{totalScore:68}, cultivationTraining:{equippedCore:core},
    nascentSoulGrowth:{version:1, branches}, materialSystem:{inventory:{'nascent-soul-essence':fragments}}};
  return new Function('state', 'Growth', 'currentScore', 'NASCENT_SOUL_THRESHOLD', 'window',
    'clampGrade', 'coreType', 'coreVisualMarkup', 'soulBusy',
    source.slice(start, end) + '\nreturn nascentSoulTabMarkup();')(
      {equippedCore:core, core:{type:'thunder', grade:9}}, globalThis.QANascentGrowth,
      () => 68, 68, {getCurrentUserData:() => player}, grade => grade,
      type => ({name:type}), core => `<div data-test-core="${core.type}" data-test-grade="${core.grade}"></div>`, soulBusy);
}

test('equipped core sits at the radial center with one connector per four or five branches', () => {
  for (const [type, count] of [['ocean',4], ['ningxin',5], ['sword',5]]) {
    const markup = renderGrowthMap(type);
    assert.match(markup, new RegExp(`data-branch-count="${count}"`));
    assert.match(markup, new RegExp(`class="ns-growth-core"><div data-test-core="${type}" data-test-grade="1"`));
    assert.doesNotMatch(markup, /data-test-core="thunder"/);
    assert.equal((markup.match(/data-ns-upgrade=/g) || []).length, count);
    assert.equal((markup.match(/<line /g) || []).length, count);
    const positions = [...markup.matchAll(/--branch-x:(\d+)%;--branch-y:(\d+)%/g)];
    assert.equal(new Set(positions.map(match => match[1]+','+match[2])).size, count);
    assert.ok(positions.every(match => Number(match[1]) !== 50 || Number(match[2]) !== 50));
    assert.equal((markup.match(/x1="50" y1="50"/g) || []).length, count);
  }
  const css = read('public/cultivation-training-v3.css');
  assert.match(css, /\.ns-growth-core \{[^}]*left:50%; top:50%/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.ns-growth-map \{ height:480px/);
  assert.match(css, /#training-tab-content:has\(\.ns-growth-panel\) \{ overflow-y:auto/);
  assert.match(css, /\.training-page-v3:has\(\.ns-growth-panel\) \{[^}]*padding-bottom:0/);
  assert.match(css, /\.ns-growth-core \.golden-core-stage-v3 \{ width:100% !important; height:100% !important; min-width:0; min-height:0/);
});

test('radial UI keeps current bonuses, ranks and costs without upper limits or explanations', () => {
  const markup = renderGrowthMap('sword', {attack:10, coreDamage:4}, 0);
  assert.match(markup, /ns-growth-resource">元嬰碎精 <strong aria-live="polite">0/);
  assert.match(markup, /data-ns-upgrade="attack"[^>]*disabled/);
  assert.match(markup, /data-ns-upgrade="coreDamage"[^>]*元嬰碎精不足[^>]*disabled/);
  assert.match(markup, /ns-growth-value ">\+70</);
  assert.match(markup, /ns-growth-value is-percent">\+12%</);
  assert.doesNotMatch(markup, /上限|ns-growth-cap/);
  assert.match(markup, /10 \/ 10/);
  assert.match(markup, /已圓滿/);
  assert.match(markup, /↑ 5 碎精/);
  assert.doesNotMatch(markup, /<p>|ns-growth-note|個獨立分支|舊神識|團本答對|各分支共/);
  const busy = renderGrowthMap('ocean', {}, 20, true);
  assert.equal((busy.match(/data-ns-upgrade="[^"]+"[^>]*disabled/g) || []).length, 4);
  assert.match(busy, /保存中/);
});

test('radial branch labels show the equipped core ability and its actual bonus', () => {
  const expected = {ocean:'蓄潮爆發',taichu:'吸血',pojing:'斬殺',xingchen:'連答蓄力',
    wugou:'真傷',thunder:'反傷',reverse:'低血增傷'};
  for (const [type, name] of Object.entries(expected)) {
    const markup = renderGrowthMap(type,{core:4});
    assert.match(markup,new RegExp('ns-growth-name">[^<]*<i[^>]*><\\/i>'+name+'<'));
    assert.doesNotMatch(markup,/金丹屬性|金丹機率|金丹傷害|上限/);
  }
  const trueDamage = renderGrowthMap('wugou',{core:10},20,false,2);
  assert.match(trueDamage,/ns-growth-value ">\+71</);
  assert.doesNotMatch(trueDamage,/\+100%|\+71%/);
  for (const [type, rate, damage] of [['ningxin','爆擊率','爆擊傷害'],['sword','連擊率','連擊傷害']]) {
    const markup = renderGrowthMap(type,{coreChance:4,coreDamage:4});
    assert.match(markup,new RegExp('<\\/i>'+rate+'<'));
    assert.match(markup,new RegExp('<\\/i>'+damage+'<'));
    assert.doesNotMatch(markup,/金丹屬性|金丹機率|金丹傷害|上限/);
  }
});


test('growth status previews rising fragment costs and caps directly',()=>{
 const Growth=globalThis.QANascentGrowth,p={stats:{totalScore:68},cultivationTraining:{equippedCore:{type:'ocean'}},nascentSoulGrowth:{version:1,branches:{attack:3}},materialSystem:{inventory:{[Growth.ITEM_ID]:4}}};const ready=Growth.status(p,'attack');assert.equal(ready.cost,4);assert.equal(ready.ok,true);p.nascentSoulGrowth.branches.attack=10;assert.equal(Growth.status(p,'attack').reason,'已圓滿');
});


test('node costs rise with distance and cultivation nodes are minority', () => {
  for(const id of ['leftMain','rightMain'])assert.equal(soulNodeCost(id),1);
  for(const id of ['leftTop','leftBottom','rightTop','rightBottom'])assert.equal(soulNodeCost(id),3);
  for(const id of ['leftFarTop','leftFarBottom','rightFarTop','rightFarBottom'])assert.equal(soulNodeCost(id),5);
  for(const id of ['leftFinal','rightFinal'])assert.equal(soulNodeCost(id),8);
  assert.equal(soulNodeCost('not-a-node'),0);
  const nodes=soulNodes('sword');
  assert.equal(nodes.filter(n=>n.cultivationSolo||n.cultivationDaily||n.cultivationCave).length,3);
  let tree=null;
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'sword','rightMain',150).tree;
  let r=allocateSoulNode(tree,'sword','rightBottom',150);assert.equal(r.cost,3);tree=r.tree;
  for(let i=1;i<5;i++)tree=allocateSoulNode(tree,'sword','rightBottom',150).tree;
  r=allocateSoulNode(tree,'sword','rightFarBottom',150);
  assert.equal(r.cost,5);assert.equal(soulCultivationBonuses(r.tree,'sword').daily,5);
  assert.equal(soulCultivationBonuses(r.tree,'sword').cave,1);
  assert.equal(soulCombatBonuses(r.tree,'sword').maxHpFlat,350);
  assert.equal(soulCultivationBonusForPlayer({stats:{totalScore:68},
    cultivationTraining:{equippedCore:{type:'sword'},coreEnabled:true},
    nascentSoulTree:r.tree},'daily'),0);
  assert.equal(soulCultivationBonusForPlayer({stats:{totalScore:68},
    cultivationTraining:{equippedCore:{type:'sword'},coreEnabled:false},
    nascentSoulTree:r.tree},'daily'),0);
});

test('new cultivation branch reaches solo, meditation and server cave settlement',()=>{
 const rules=read('public/cultivation/nascent-soul-rules.js');assert.match(rules,/QANascentGrowth.cultivation\(player, source\)/);assert.match(read('public/cultivation/daily-meditation.js'),/soulCultivationBonusForPlayer\(data, 'daily'\)/);assert.match(read('dongtian-settlement-api.cjs'),/Growth.cultivation\(player,'cave'\)/);
});


test('dual outer prerequisites gate core-related final nodes', () => {
  let tree=null;
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'thunder','leftMain',400).tree;
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'thunder','leftTop',400).tree;
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'thunder','leftBottom',400).tree;
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'thunder','leftFarTop',400).tree;
  assert.equal(soulNodeStatus(tree,'thunder','leftFinal',400).ok,false);
  for(let i=0;i<5;i++)tree=allocateSoulNode(tree,'thunder','leftFarBottom',400).tree;
  const fin=allocateSoulNode(tree,'thunder','leftFinal',400);
  assert.equal(fin.ok,true);assert.equal(fin.cost,8);
  const low=soulNodes('thunder',9).find(n=>n.id==='leftFinal').talentStrength;
  const high=soulNodes('thunder',1).find(n=>n.id==='leftFinal').talentStrength;
  assert.ok(high > low);
  assert.notEqual(soulNodes('thunder',1).find(n=>n.id==='leftFinal').name,soulNodes('ocean',1).find(n=>n.id==='leftFinal').name);
  assert.ok(soulFinalePerLevel('wugou',1).coreHeal>soulFinalePerLevel('thunder',9).coreHeal);
});
test('previous v3 allocations preserve paid costs', () => {
  const old={version:3,paths:{sword:{nodes:{leftMain:5,leftTop:2,rightMain:5,rightBottom:3},baselineNodes:{},legacySpent:0}}};
  const fixed=normalizeSoulTree(old);
  assert.equal(fixed.version,4);
  assert.equal(soulSpentSpirit(fixed),5+6+5+9);
  const newer=allocateSoulNode(fixed,'sword','leftTop',100);
  assert.equal(newer.cost,3);
  assert.equal(soulSpentSpirit(newer.tree),28);
});
test('duel survival reduction and core-linked correct-answer healing', () => {
  const code=read('public/cultivation/battle-engine-v2.js').replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm,'');
  const settle=new Function(code+'\nreturn settleBattleRound;')();
  const p=(uid,correct,hp,ns)=>({uid,hp,maxHp:1000,atk:200,totalScore:68,goldenCore:null,nascentSoul:ns,answer:{correct,atMs:1000}});
  const host=p('host',true,700,{bonusDamage:30,reductionFlat:15,coreHeal:24});
  const guest=p('guest',false,1000,{reductionFlat:25});
  const result=settle({roomId:'soul-survival',round:1,host,guest});
  assert.equal(result.startHostHp,724);
  assert.equal(result.guestHp,795);
  assert.equal(result.steps.find(x=>x.type==='attack').damage,205);
  assert.equal(result.steps.find(x=>x.type==='attack').extraDamage,30);
  const wrong=settle({roomId:'soul-no-heal',round:1,host:p('host',false,700,{coreHeal:24}),guest:p('guest',false,1000,null)});
  assert.equal(wrong.startHostHp,700);
});


test('growth and available branch count follow equipped core, never wash candidate',()=>{
 const source=read('public/cultivation/cultivation-training-v4.js');const start=source.indexOf('  function nascentSoulTabMarkup()');const end=source.indexOf('  async function saveSoulBranch',start);const markup=source.slice(start,end);assert.match(markup,/const core = state.equippedCore/);assert.match(markup,/Growth.branches\(core\)/);assert.doesNotMatch(markup,/state.core[?.]/);assert.match(source,/Growth.bonuses\(window.getCurrentUserData\?\.\(\) \|\| \{\}, state.equippedCore\)/);
});


test('core-grade decoration uses each rendered core, never applies the wash candidate to all', () => {
  const visual = read('public/cultivation/cultivation-core-visual.js');
  const training = read('public/cultivation/cultivation-training-v4.js');
  const wash = read('public/cultivation/golden-core-wash-animation.js');
  const css = read('public/cultivation-training-v3.css');
  const visualsCss = read('public/cultivation-core-visual.css');
  assert.match(training, /data-core-visual-grade="\$\{clampGrade\(core\.grade\)\}"/);
  assert.match(visual, /const explicitGrade = Number\(stage\.dataset\.coreVisualGrade\)/);
  assert.match(visual, /Number\.isInteger\(explicitGrade\)/);
  assert.match(visual, /decorateStage\(stage, grade\)/);
  assert.match(wash, /stage\.dataset\.coreVisualGrade = String\(/);
  assert.match(visualsCss, /\.core-grade-1 \.pattern-a/);
  assert.match(visualsCss, /\.core-grade-9 \.pattern-a/);
  assert.doesNotMatch(training, /ns-equipped-effect|data-ns-core-detail/);
  assert.doesNotMatch(css, /ns-equipped-effect/);
  assert.match(css, /grid-template-rows: auto auto minmax\(0,1fr\) auto auto !important/);
});

test('independent grade classes survive mixing one-grade equipped core with nine-grade wash candidate', () => {
  const visual = read('public/cultivation/cultivation-core-visual.js');
  const state = {grade:9};
  const makeStage = (grade) => {
    const classes = new Set(['golden-core-stage-v3']);
    const stage = {
      dataset: {coreVisualGrade:String(grade)},
      classList: {
        add: (...items) => items.forEach(item=>classes.add(item)),
        remove: (...items) => items.forEach(item=>classes.delete(item))
      },
      querySelector:()=>null,
      appendChild:()=>{},
      classes
    };
    return stage;
  };
  const candidate = makeStage(9), equipped = makeStage(1);
  const documentMock = {readyState:'loading', addEventListener:()=>{},
    querySelectorAll:()=>[candidate,equipped]};
  // Isolate decoration logic with simplified DOM nodes; verify per-stage quality.
  const start = visual.indexOf('  function decorateAll() {');
  const end = visual.indexOf('  function scheduleDecorate() {',start);
  assert.ok(start>=0 && end>start);
  const body = visual.slice(start,end);
  const decorate = new Function('window','document','decorateStage',
    body + '\nreturn decorateAll;')(
      {getGoldenCoreState:()=>state},documentMock,
      (stage,grade) => {
        for(let i=1;i<=9;i++) stage.classList.remove('core-grade-'+i);
        stage.classList.add('core-grade-'+grade);
      }
    );
  decorate();
  assert.ok(candidate.classes.has('core-grade-9'));
  assert.ok(equipped.classes.has('core-grade-1'));
  assert.ok(!equipped.classes.has('core-grade-9'));
  state.grade=2;
  decorate();
  assert.ok(equipped.classes.has('core-grade-1'));
  assert.ok(candidate.classes.has('core-grade-9'));
});
