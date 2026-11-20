'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Catalog=require('../public/cultivation/manual-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const NOW=2000000000000;
test('six sword/totem weapons retain the original stable IDs, XP and three-skill gates',()=>{
  assert.equal(Catalog.BOOKS.length,6);
  assert.equal(Catalog.BOOKS.filter(b=>b.weaponType==='sword').length,3);
  assert.equal(Catalog.BOOKS.filter(b=>b.weaponType==='totem').length,3);
  assert(Catalog.BOOKS.every(b=>b.skills.length===3));
  assert(Catalog.BOOKS.every(b=>JSON.stringify(b.skills.map(s=>s.levelRequired))==='[1,5,10]'));
  const record={version:3,school:'sword',books:{
    'sword-wind':{exp:280},'body-rock':{exp:1080},'sword-flight':{exp:0}},
    weaponIds:['sword-wind','body-rock','sword-flight'],activeLoadout:1,
    skillLevels:{'rock-fist':4}};
  const state=Catalog.normalize(record);
  assert.equal(state.version,3);
  assert.deepEqual(state.weaponIds,record.weaponIds);
  assert.deepEqual(state.loadouts.map(slot=>slot.skillIds.length),[2,3,1]);
  assert.equal(state.loadouts[0].name,'流風靈劍');
  assert.equal(state.loadouts[1].name,'玄嶽圖騰');
  assert.deepEqual(state.equipped,state.loadouts[1].skillIds);
  assert.equal(state.skillLevels['rock-fist'],4);
  assert.equal(state.books['body-rock'].exp,1080);
  const invalid=Catalog.normalize({...record,
    weaponIds:['body-rock','body-rock','missing-weapon','sword-flight']});
  assert.deepEqual(invalid.weaponIds,['body-rock',null,null]);
});
test('legacy skill presets project into weapon slots without losing old stored data',()=>{
  const old={version:2,books:{'sword-wind':{exp:0},'body-rock':{exp:40}},
    equipped:['wind-slash'],loadouts:[
      {name:'先手',skillIds:['wind-slash']},
      {name:'防禦',skillIds:['rock-fist']},
      {name:'備用',skillIds:[]}],activeLoadout:0};
  assert.equal(Catalog.normalize(old).version,2);
  const projected=Catalog.publicState(old,100);
  assert.deepEqual(projected.weaponIds,['sword-wind','body-rock',null]);
  assert.equal(projected.loadouts[1].name,'防禦');
  const migrated=Catalog.weaponize(old);
  assert.equal(migrated.version,3);
  assert.deepEqual(migrated.weaponIds,projected.weaponIds);
  assert.equal(migrated.books['body-rock'].exp,40);
});
test('server equips at most three unique owned weapons, switches main weapon, and preserves mastery',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'sword'});
  const old=db.records.get(API.MANUALS+'/u1');
  old.books['body-rock']={exp:40};
  old.books['sword-flight']={exp:280};
  let result=await API.manualsState(db,'u1');
  assert.equal(result.weaponIds[0],'sword-wind');
  await assert.rejects(API.updateLoadout(db,'u1',{index:1,weaponId:'sword-sky'}),/尚未獲得/);
  result=await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  assert.deepEqual(result.weaponIds,['sword-wind','body-rock',null]);
  assert.equal(db.records.get(API.MANUALS+'/u1').version,3);
  await assert.rejects(API.updateLoadout(db,'u1',{index:2,weaponId:'body-rock'}),/不能重複裝備/);
  result=await API.updateLoadout(db,'u1',{index:2,weaponId:'sword-flight'});
  assert.equal(result.weaponIds.filter(Boolean).length,3);
  await assert.rejects(API.updateLoadout(db,'u1',{index:3,weaponId:'sword-flight'}),/配置不存在/);
  result=await API.updateLoadout(db,'u1',{index:1,apply:true});
  assert.equal(result.activeLoadout,1);
  assert.deepEqual(result.equipped,['rock-fist']);
  assert.equal(result.library.find(b=>b.id==='body-rock').exp,40);
  const room=await API.start(db,'u1',{mode:'pve'},NOW);
  assert.deepEqual(room.actors[0].manualSkills,['rock-fist']);
  const switched=await API.switchBattleLoadout(db,'u1',
    {roomId:room.id,index:2,requestId:'weapon-switch-001'},NOW+1);
  assert.equal(switched.actors[0].manualLoadoutIndex,2);
  assert(switched.actors[0].manualSkills.every(id=>Catalog.BY_SKILL[id]?.manualId==='sword-flight'));
  assert.equal(switched.actors[0].stamina,room.actors[0].stamina);
});
