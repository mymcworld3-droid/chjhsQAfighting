'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
const total=s=>s.kind==='sword-array'?s.centerPower:s.kind==='fist-chain'?s.power*s.steps:s.power;
test('weapon tier increases both basic and peak single-target output per stamina',()=>{
  for(const ids of [['sword-wind','sword-flight','sword-sky'],['body-rock','body-tiger','body-dragon']]){
    for(const level of [1,5])for(const stars of [0,5]){
      const tiers=ids.map(id=>M.BY_BOOK[id].skills.filter(s=>s.power>0).map(s=>M.skillAtLevel(s,level,stars)));
      for(let i=1;i<tiers.length;i++){
        const lo=tiers[i-1],hi=tiers[i];
        assert(hi[0].power>lo[0].power);
        assert(hi[0].power/hi[0].cost>lo[0].power/lo[0].cost);
        assert(Math.max(...hi.map(total))>Math.max(...lo.map(total)));
        assert(Math.max(...hi.map(s=>total(s)/s.cost))>Math.max(...lo.map(s=>total(s)/s.cost)));
      }
    }
  }
});
test('movement damage separate from summon and scaled by mastery; focus cannot drop below five stamina',()=>{
  const s=M.BY_SKILL['flight-summon'];
  assert.equal(s.movePower,.85);
  assert.equal(s.power,2.4);
  assert(Math.abs(M.skillAtLevel(s,5,5).movePower-.85*1.4*1.25)<1e-9);
  assert.equal(M.skillAtLevel(M.BY_SKILL['dragon-roar'],5).cost,5);
});
test('Peak Stone has a separate smoothly increasing health budget and no boss double multiplier',()=>{
  let previous=null;
  for(let difficulty=0;difficulty<W.DIFFICULTIES.length;difficulty++){
    const state=R.create({id:'balance',mode:'pve',players:[{uid:'hero',atk:200,enemyScaleAttack:200,maxHp:1000}],trial:{seed:'balance',weaponDungeon:{id:W.ID,difficulty}}});
    const boss=state.actors.find(a=>a.weaponDungeonLord);
    const guards=state.actors.filter(a=>a.bot&&!a.weaponDungeonLord);
    assert.equal(boss.maxHp,Math.round(200*(7+difficulty*1.2)));
    assert(guards.every(a=>a.maxHp===Math.round(200*(2.5+difficulty*.35))));
    assert(boss.maxHp>guards[0].maxHp*2);
    if(previous){assert(boss.maxHp>previous.maxHp);assert(boss.maxHp/previous.maxHp<1.25);}
    previous=boss;
  }
});
