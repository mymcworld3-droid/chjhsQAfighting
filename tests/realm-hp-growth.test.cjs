'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const Access=require('../public/cultivation/training-access-rules.js');
const Raid=require('../raid-authority.cjs');

test('each breakthrough after Foundation adds 100 max HP, once per realm',()=>{
  for(const [cultivation,bonus] of [[0,0],[5,0],[6,0],[27,0],[28,100],[67,100],
    [68,200],[187,200],[188,300],[427,300],[428,400],[788,500],
    [1268,600],[1868,700],[99999,700]]) {
    assert.equal(Access.hpBonus({stats:{totalScore:cultivation}}),bonus,`score ${cultivation}`);
  }
  const attained={stats:{totalScore:30},trainingAccess:{version:1,highestRealmScore:188}};
  assert.equal(Access.hpBonus(attained),300,'previously earned realm HP remains after score deduction');
  const legacy={stats:{totalScore:2},cultivationTraining:{
    announced:true,equippedCore:{type:'sword'}},nascentSoulGrowth:{version:1,branches:{attack:1}}};
  assert.equal(Access.hpBonus(legacy),200,'legacy unlocks receive corresponding health');
});

test('browser combat HP bonus applies before nascent and equipment wrappers without saving it',()=>{
  const user={stats:{attack:200,hp:900,maxHp:1000,totalScore:188}};
  const window={QATrainingAccessRules:Access,getCurrentUserData:()=>user,getNascentSoulBattleSnapshot:()=>null,
    addEventListener:()=>{}};
  const document={readyState:'loading',addEventListener:()=>{}};
  const source=read('public/cultivation/cultivation-combat-stats.js')
    .replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source,{window,document,console,Math,Number,CustomEvent:class {}});
  assert.deepEqual(JSON.parse(JSON.stringify(window.getCombatStats())),{attack:200,maxHp:1300,hp:1170});
  window.getNascentSoulBattleSnapshot=()=>({attackFlat:35,maxHpFlat:250});
  assert.deepEqual(JSON.parse(JSON.stringify(window.getCombatStats())),{attack:235,maxHp:1550,hp:1395});
  assert.equal(user.stats.maxHp,1000,'stored base maxHp must not be inflated');
  user.stats.totalScore=27;
  assert.equal(window.getCombatStats().maxHp,1250,'below Golden Core has no realm bonus');
});

test('server trusted raid HP projection matches browser before and after nascent growth',()=>{
  const user={stats:{attack:200,maxHp:1000,totalScore:188}};
  const plain=Raid.trustedRaidPlayerSnapshot(user,'h');
  assert.equal(plain.maxHp,1300);
  assert.equal(plain.baseMaxHp,1300);
  assert.equal(plain.combatPower,660);
  const core={type:'ocean',grade:1};
  user.cultivationTraining={coreEnabled:true,equippedCore:core};
  user.nascentSoulGrowth={version:1,branches:{attack:10,vitality:10,core:10,cultivation:10}};
  const evolved=Raid.trustedRaidPlayerSnapshot(user,'h');
  assert.equal(evolved.baseMaxHp,1300);
  assert.equal(evolved.maxHp,1550);
  assert.equal(evolved.atk,235);
});

test('combat power UI explicitly includes realm HP, without counting it as an equipped artifact',()=>{
  const user={stats:{attack:200,maxHp:1000,totalScore:188}};
  const window={getCurrentUserData:()=>user,
    getEquippedGoldenCoreBattleSnapshot:()=>null,getNascentSoulBattleSnapshot:()=>null};
  const context={window,QATrainingAccessRules:Access,QASoulboundPool:require('../public/cultivation/soulbound-pool.js'),
    ARTIFACT_EQUIP_SLOTS:[],getArtifactById:()=>null,realmOrderByName:()=>0};
  const source=read('public/cultivation/combat-power.js')
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  vm.runInNewContext(source+'\nthis.calculate=getCurrentCombatPower;',context);
  assert.equal(context.calculate().base,660);
  assert.equal(context.calculate().equipment,0);
});
