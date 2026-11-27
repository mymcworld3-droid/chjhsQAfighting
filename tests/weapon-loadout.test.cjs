'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Catalog=require('../public/cultivation/manual-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const NOW=2000000000000;
const owned=()=>({books:{
  'sword-wind':{exp:280},'body-rock':{exp:1080},'sword-flight':{exp:0}},
  weaponIds:['sword-wind','body-rock','sword-flight'],skillLevels:{'rock-fist':4}});
test('all six vector-illustrated sword/totem weapons retain the original mastery gates',()=>{
  assert.equal(Catalog.BOOKS.length,Catalog.RELEASE_NEW_WEAPONS?12:6);
  assert.equal(Catalog.BOOKS.filter(b=>b.weaponType==='sword').length,Catalog.RELEASE_NEW_WEAPONS?6:3);
  assert.equal(Catalog.BOOKS.filter(b=>b.weaponType==='totem').length,Catalog.RELEASE_NEW_WEAPONS?6:3);
  assert(Catalog.BOOKS.every(b=>b.skills.length===3));
  assert(Catalog.BOOKS.every(b=>JSON.stringify(b.skills.map(s=>s.levelRequired))==='[1,5,10]'));
  const state=Catalog.normalize({...owned(),version:3});
  assert.equal(state.version,3);
  assert.deepEqual(state.weaponIds,['sword-wind','body-rock']);
  assert.deepEqual(state.loadouts.map(slot=>slot.skillIds.length),[2,3]);
  assert.equal(state.equipped.length,5,'two worn weapons expose their learned skills');
  assert.deepEqual(state.equipped,state.loadouts.flatMap(slot=>slot.skillIds));
  assert.equal(state.skillLevels['rock-fist'],4);
  assert.equal(state.books['body-rock'].exp,1080);
  assert.equal(state.activeLoadout,0,'legacy field is inert, never designates a main weapon');
  const invalid=Catalog.normalize({...owned(),
    weaponIds:['body-rock','body-rock','missing-weapon','sword-flight']});
  assert.deepEqual(invalid.weaponIds,['body-rock',null]);
});
test('legacy manual presets project into two equivalent weapon slots with original XP',()=>{
  const old={version:2,books:{'sword-wind':{exp:0},'body-rock':{exp:40}},
    equipped:['wind-slash'],loadouts:[
      {name:'先手',skillIds:['wind-slash']},
      {name:'防禦',skillIds:['rock-fist']},
      {name:'備用',skillIds:[]}],activeLoadout:0};
  assert.equal(Catalog.normalize(old).version,2);
  const projected=Catalog.publicState(old,100);
  assert.deepEqual(projected.weaponIds,['sword-wind','body-rock']);
  assert.equal(projected.loadouts[1].name,'玄嶽圖騰');
  assert.deepEqual(projected.equipped,['wind-slash','rock-fist']);
  const migrated=Catalog.weaponize(old);
  assert.equal(migrated.version,3);
  assert.deepEqual(migrated.weaponIds,projected.weaponIds);
  assert.equal(migrated.books['body-rock'].exp,40);
});
test('server equips at most two unique owned weapons, with all their learned skills at once',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'sword'});
  const old=db.records.get(API.MANUALS+'/u1');
  old.books['body-rock']={exp:40};
  old.books['sword-flight']={exp:280};
  let result=await API.manualsState(db,'u1');
  assert.equal(result.weaponIds[0],'sword-wind');
  await assert.rejects(API.updateLoadout(db,'u1',{index:1,weaponId:'sword-sky'}),/尚未獲得/);
  result=await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  assert.deepEqual(result.weaponIds,['sword-wind','body-rock']);
  assert.equal(db.records.get(API.MANUALS+'/u1').version,3);
  await assert.rejects(API.updateLoadout(db,'u1',{index:2,weaponId:'body-rock'}),/最多裝備兩把/);
  await assert.rejects(API.updateLoadout(db,'u1',{index:2,weaponId:'sword-flight'}),/最多裝備兩把/);
  assert.equal(result.weaponIds.filter(Boolean).length,2);
  assert.equal(result.equipped.length,2);
  await assert.rejects(API.updateLoadout(db,'u1',{index:3,weaponId:'sword-flight'}),/配置不存在/);
  const room=await API.start(db,'u1',{mode:'pve'},NOW);
  const hero=room.actors[0];
  assert.deepEqual(hero.manualWeaponIds,['sword-wind','body-rock']);
  assert.equal(hero.manualWeaponMode,true);
  assert.equal(hero.manualSkills.length,2);
  assert.equal(hero.manualLoadoutName,undefined);
  await assert.rejects(API.switchBattleLoadout(db,'u1',
    {roomId:room.id,index:2,requestId:'weapon-switch-001'},NOW+1),/沒有主武器/);
  const changed=await API.updateLoadout(db,'u1',{index:1,weaponId:null});
  assert.deepEqual(changed.weaponIds,['sword-wind',null]);
  assert.equal(changed.equipped.length,1);
  const storedRoom=db.records.get(API.ROOMS+'/'+room.id);
  assert.deepEqual(storedRoom.actors[0].manualSkills,changed.equipped);
  assert.equal(storedRoom.actors[0].stamina,hero.stamina);
  assert.equal(storedRoom.actors[0].actions,hero.actions);
  assert(storedRoom.revision>room.revision);
  assert.equal(changed.library.find(b=>b.id==='body-rock').exp,40);
  const restored=await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  assert.equal(restored.equipped.length,2);
  assert.equal(db.records.get(API.ROOMS+'/'+room.id).actors[0].manualSkills.length,2);
});
test('PvP waiting may change weapons, but an active duel and assembled dungeon forbid changes',async()=>{
  const pvp=database();await API.chooseSchool(pvp,'u1',{school:'sword'});
  const waiting=await API.start(pvp,'u1',{mode:'pvp'},NOW);
  const edited=await API.updateLoadout(pvp,'u1',{index:0,weaponId:null});
  assert.deepEqual(edited.weaponIds,[null,null]);
  assert.deepEqual(pvp.records.get(API.ROOMS+'/'+waiting.id).actors[0].manualSkills,[],
    'the pending match must see updated equipment');
  await API.start(pvp,'u2',{mode:'pvp',code:waiting.id.slice(6)},NOW+1);
  await assert.rejects(API.updateLoadout(pvp,'u1',{index:0,weaponId:'sword-wind'}),
    /多人鬥法進行中/);
  const dungeon=database();await API.chooseSchool(dungeon,'u1',{school:'sword'});
  const roomId='dungeon-weapon-test-001';
  dungeon.records.set('dungeonRoomMemberships/u1',{roomId});
  dungeon.records.set('dungeonRooms/'+roomId,{mode:'dungeon',version:1,status:'assembled',expiresAtMs:Date.now()+3600000,members:{u1:{}}});
  await assert.rejects(API.updateLoadout(dungeon,'u1',{index:0,weaponId:null}),
    /多人副本進行中/);
  dungeon.records.get('dungeonRooms/'+roomId).status='waiting';
  const valid=await API.updateLoadout(dungeon,'u1',{index:0,weaponId:null});
  assert.deepEqual(valid.weaponIds,[null,null]);
});

test('expired, completed or stale dungeon memberships do not block weapon changes',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'sword'});
  const roomId='dungeon-stale-lock-001',key='dungeonRooms/'+roomId;
  db.records.set('dungeonRoomMemberships/u1',{roomId});
  const active={mode:'dungeon',version:1,status:'assembled',expiresAtMs:Date.now()+3600000,members:{u1:{},u2:{}}};
  for(const room of [
    {...active,expiresAtMs:Date.now()-1},
    {...active,bossEncounter:{status:'defeated'}},
    {...active,status:'closed'},
    {...active,members:{u2:{}}},
    {...active,expiresAtMs:undefined},
    {...active,version:0},
    null
  ]){
    if(room)db.records.set(key,room);else db.records.delete(key);
    const result=await API.updateLoadout(db,'u1',{index:0,weaponId:null});
    assert.deepEqual(result.weaponIds,[null,null]);
    await API.updateLoadout(db,'u1',{index:0,weaponId:'sword-wind'});
    assert.equal(db.records.get('dungeonRoomMemberships/u1').roomId,roomId,
      'retain reward recovery records and never disband another player');
  }
  db.records.set(key,{...active,bossEncounter:{status:'fighting'}});
  await assert.rejects(API.updateLoadout(db,'u1',{index:0,weaponId:null}),/多人副本進行中/);
  assert.deepEqual((await API.manualsState(db,'u1')).weaponIds,['sword-wind',null]);
});
