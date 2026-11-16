'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Rules=require('../public/cultivation/tactical-power-rules.js');
const Manual=require('../public/cultivation/manual-rules.js');
const base={stats:{attack:200,maxHp:1000}};
const own=(id,xp=0,rank=1)=>({
  books:{[Manual.BY_SKILL[id].manualId]:{exp:xp}},
  equipped:[id],skillLevels:{[id]:rank}
});
test('tactical strength has a transparent, bounded base and never counts inactive old systems',()=>{
  const none=Rules.calculate(base);
  assert.equal(none.mode,'tactical');
  assert.equal(none.base,600);
  assert.equal(none.total,600);
  assert.equal(none.complete,false);
  const empty=Rules.calculate({...base,manualState:{},realmScore:1868});
  assert.equal(empty.total,600);
  assert.equal(empty.complete,true);
  assert.equal(empty.core,0);
  assert.equal(empty.equipment,0);
  assert(Number.isFinite(Rules.calculate({stats:{attack:Infinity,maxHp:-1}}).total));
});
test('only equipped, owned, mastered and realm-eligible moves increase strength',()=>{
  const novice=Rules.calculate({...base,manualState:own('wind-slash'),realmScore:1});
  assert(novice.skills>0);
  assert.equal(novice.items.length,1);
  const unowned=Rules.calculate({...base,manualState:{equipped:['wind-slash']},realmScore:1868});
  assert.equal(unowned.skills,0);
  const locked=Rules.calculate({...base,manualState:own('wind-step'),realmScore:1868});
  assert.equal(locked.skills,0);
  const wrongRealm=Rules.calculate({...base,manualState:own('wind-step',280),realmScore:1});
  assert.equal(wrongRealm.skills,0);
  const unlocked=Rules.calculate({...base,manualState:own('wind-step',280),realmScore:6});
  assert(unlocked.skills>0);
});
test('moving a skill from level 1 to level 5 improves rating without changing the base',()=>{
  const early=Rules.calculate({...base,manualState:own('wind-slash',0,1),realmScore:1});
  const upgraded=Rules.calculate({...base,manualState:own('wind-slash',0,5),realmScore:1});
  assert.equal(early.base,upgraded.base);
  assert(upgraded.skills>early.skills);
  const focus={books:{'body-dragon':{exp:1080}},equipped:['dragon-roar'],skillLevels:{}};
  const a=Rules.calculate({...base,manualState:focus,realmScore:68});
  focus.skillLevels['dragon-roar']=5;
  const b=Rules.calculate({...base,manualState:focus,realmScore:68});
  assert(b.skills>a.skills);
});
test('additional distinct equipped techniques give diminishing, never negative returns',()=>{
  const manuals={books:{'sword-wind':{exp:1080},'sword-flight':{exp:1080},'sword-sky':{exp:1080}},
    equipped:['wind-slash','wind-step','sky-cloud'],skillLevels:{}};
  const one=Rules.calculate({...base,manualState:{...manuals,equipped:['wind-slash']},realmScore:1868});
  const two=Rules.calculate({...base,manualState:{...manuals,equipped:['wind-slash','wind-step']},realmScore:1868});
  const three=Rules.calculate({...base,manualState:manuals,realmScore:1868});
  assert(two.skills>=one.skills);
  assert(three.skills>=two.skills);
  assert.equal(three.skills,three.items.reduce((n,x)=>n+x.power,0));
  const duplicate=Rules.calculate({...base,manualState:{books:{'sword-wind':{exp:1080},'sword-flight':{exp:1080}},
    equipped:['wind-slash','flight-slash'],skillLevels:{}},realmScore:1868});
  assert.equal(duplicate.items.length,1);
});
test('changing owned but unequipped books and acquired XP does not inflate combat strength',()=>{
  const old=Rules.calculate({...base,manualState:own('wind-slash',0),realmScore:1868});
  const later=Rules.calculate({...base,manualState:{
    ...own('wind-slash',10000),books:{'sword-wind':{exp:10000},'body-dragon':{exp:10000}}
  },realmScore:1868});
  assert.equal(old.total,later.total);
});
