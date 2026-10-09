const Growth=require('../public/cultivation/nascent-growth.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-room.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

test('raid reward response mirrors server spirit without a second persistence write',async()=>{
  const local={uid:'a',stats:{nascentSoulSpirit:10}};let refreshed=0,requests=0;
  const api=vm.runInNewContext(source+'\napi',{QANascentGrowth:Growth,CustomEvent:class{},
    window:{dispatchEvent(){},getCurrentUserData:()=>local,updateUIStats(){refreshed++;}},
    raidRepository:{async request(){requests++;return {spiritReward:{uid:'a',totalFragments:11,learningTotals:{fragments:1}}};}}});
  await api('player-action');
  assert.equal(local.materialSystem.inventory[Growth.ITEM_ID],11);assert.equal(refreshed,1);assert.equal(requests,1);
});

test('stale raid poll cannot reduce cumulative spirit or refresh unnecessarily',async()=>{
  const local={uid:'a',stats:{nascentSoulSpirit:0},nascentSoulGrowth:{version:1,branches:{}},materialSystem:{inventory:{[Growth.ITEM_ID]:20}},raidLearningRewards:{fragments:5}};let refreshed=0;
  const api=vm.runInNewContext(source+'\napi',{QANascentGrowth:Growth,CustomEvent:class{},
    window:{dispatchEvent(){},getCurrentUserData:()=>local,updateUIStats(){refreshed++;}},
    raidRepository:{async request(){return {spiritReward:{uid:'a',totalFragments:11,learningTotals:{fragments:1}}};}}});
  await api('get');assert.equal(local.materialSystem.inventory[Growth.ITEM_ID],20);assert.equal(refreshed,0);
});

test('reward completing after account switch does not modify either account',async()=>{
  const original={uid:'a',stats:{nascentSoulSpirit:10}},next={uid:'b',stats:{nascentSoulSpirit:4}};
  let current=original;
  const api=vm.runInNewContext(source+'\napi',{QANascentGrowth:Growth,CustomEvent:class{},
    window:{dispatchEvent(){},getCurrentUserData:()=>current,updateUIStats(){throw Error('unexpected refresh');}},
    raidRepository:{async request(){current=next;return {spiritReward:{uid:'a',totalFragments:11,learningTotals:{fragments:1}}};}}});
  await api('get');assert.equal(original.stats.nascentSoulSpirit,10);assert.equal(next.stats.nascentSoulSpirit,4);
});

test('cached learning totals cannot restore spent gold or penalized cultivation',async()=>{
  const local={uid:'a',stats:{totalScore:68,gold:50},raidLearningRewards:{cultivation:2,gold:40}};
  let reward={uid:'a',learningTotals:{cultivation:3,gold:60}};
  const api=vm.runInNewContext(source+'\napi',{QANascentGrowth:Growth,CustomEvent:class{},
    window:{dispatchEvent(){},getCurrentUserData:()=>local,updateUIStats(){}},
    raidRepository:{async request(){return {spiritReward:reward};}}});
  await api('get');assert.equal(local.stats.totalScore,69);assert.equal(local.stats.gold,70);
  local.stats.gold=0;local.stats.totalScore=67;
  await api('get');assert.equal(local.stats.gold,0);assert.equal(local.stats.totalScore,67);
  reward={uid:'a',learningTotals:{cultivation:1,gold:20}};
  await api('get');assert.equal(local.stats.gold,0);
  reward={uid:'a',learningTotals:{cultivation:4,gold:80}};
  await api('get');assert.equal(local.stats.gold,20);assert.equal(local.stats.totalScore,68);
});

test('cached fragment income never restores fragments already spent upgrading',async()=>{
 const local={uid:'a',stats:{},nascentSoulGrowth:{version:1,branches:{}},materialSystem:{inventory:{[Growth.ITEM_ID]:5}},raidLearningRewards:{fragments:5}};
 let earned=6;const api=vm.runInNewContext(source+'\napi',{QANascentGrowth:Growth,CustomEvent:class{},window:{dispatchEvent(){},getCurrentUserData:()=>local,updateUIStats(){}},raidRepository:{async request(){return {spiritReward:{uid:'a',totalFragments:6,learningTotals:{fragments:earned}}};}}});
 await api('get');assert.equal(local.materialSystem.inventory[Growth.ITEM_ID],6);local.materialSystem.inventory[Growth.ITEM_ID]=0;await api('get');assert.equal(local.materialSystem.inventory[Growth.ITEM_ID],0);earned=7;await api('get');assert.equal(local.materialSystem.inventory[Growth.ITEM_ID],1);
});
