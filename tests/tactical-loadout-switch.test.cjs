'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const API=require('../tactical-combat-api.cjs').__test;
const Manuals=require('../public/cultivation/manual-rules.js');
const {database}=require('./helpers/tactical-db.cjs');
const NOW=2_000_000_000_000;
function fixture(){
  const db=database();
  db.records.get('users/u1').stats.totalScore=188;
  db.records.set(API.MANUALS+'/u1',Manuals.normalize({
    school:'sword',books:{'sword-wind':{exp:1000000},'body-rock':{exp:40}},
    equipped:['wind-slash'],activeLoadout:0,skillLevels:{'wind-step':3},
    loadouts:[
      {name:'舊近戰配置',skillIds:['wind-slash']},
      {name:'舊閃步配置',skillIds:['wind-step']},
      {name:'舊備用',skillIds:[]}
    ]
  }));
  return db;
}
test('all unlocked moves from every worn weapon are simultaneously available, without main weapon',async()=>{
  const db=fixture(),first=await API.start(db,'u1',{mode:'pve'},NOW);
  const hero=first.actors.find(a=>a.uid==='u1');
  assert.deepEqual(hero.manualWeaponIds,['sword-wind',null]);
  assert.deepEqual(hero.manualSkills,['wind-slash','wind-step','wind-thousand']);
  assert.equal(hero.manualSkillLevels['wind-step'],3);
  assert.equal(hero.manualLoadoutIndex,undefined);
  const result=await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  assert.deepEqual(result.weaponIds,['sword-wind','body-rock']);
  const live=db.records.get(API.ROOMS+'/'+first.id).actors[0];
  assert.deepEqual(live.manualSkills,['wind-slash','wind-step','wind-thousand','rock-fist']);
  assert.equal(live.stamina,hero.stamina);
  assert.equal(live.hp,hero.hp);
  assert.equal(live.actions,hero.actions);
  assert.equal(live.attacks,hero.attacks);
  assert.deepEqual([live.x,live.y],[hero.x,hero.y]);
  await assert.rejects(API.switchBattleLoadout(db,'u1',
    {roomId:first.id,index:2,requestId:'no-main-weapon-01'},NOW+1),
    /沒有主武器/);
  const removed=await API.updateLoadout(db,'u1',{index:0,weaponId:null});
  assert.deepEqual(removed.equipped,['rock-fist']);
  assert.deepEqual(db.records.get(API.ROOMS+'/'+first.id).actors[0].manualSkills,['rock-fist']);
});
test('PvP allows gear changes before pairing but rejects them during the duel',async()=>{
  const db=fixture();
  const waiting=await API.start(db,'u1',{mode:'pvp'},NOW);
  const picked=await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  assert.deepEqual(picked.weaponIds,['sword-wind','body-rock']);
  const actor=db.records.get(API.ROOMS+'/'+waiting.id).actors[0];
  assert(actor.manualSkills.includes('rock-fist'),'waiting player should be updated');
  const joined=await API.start(db,'u2',{mode:'pvp',code:waiting.id.slice(6)},NOW+1);
  assert.equal(joined.status,'active');
  const prev=structuredClone(db.records.get(API.MANUALS+'/u1'));
  await assert.rejects(API.updateLoadout(db,'u1',{index:1,weaponId:null}),
    /多人鬥法進行中/);
  assert.deepEqual(db.records.get(API.MANUALS+'/u1'),prev);
});
test('invalid slots and unowned weapons are rejected by the server',async()=>{
  const db=fixture();
  await assert.rejects(API.updateLoadout(db,'u1',{index:3,weaponId:'body-rock'}),/配置不存在/);
  await assert.rejects(API.updateLoadout(db,'u1',{index:1,weaponId:'sword-sky'}),/尚未獲得/);
  await API.updateLoadout(db,'u1',{index:1,weaponId:'body-rock'});
  await assert.rejects(API.updateLoadout(db,'u1',{index:2,weaponId:'body-rock'}),/最多裝備兩把/);
});
test('client exposes equipment editing and adaptive right battle wheel, without a main-weapon switch',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  const style=fs.readFileSync(path.join(__dirname,'../public/styles/tactical-quarter-weapons.css'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-loadout-view.js'),'utf8');
  assert.match(src,/data-battle-unequip/);
  assert.match(src,/data-battle-weapon-picker/);
  assert.match(src,/function editBattleWeapon/);
  assert.match(src,/renderModernWeaponWheel/);
  assert.match(src,/outer\.replaceChildren/);
  assert.match(src,/tc-rightwheel-v3/);
  assert.match(src,/selectedWeaponSlot<0\?/);
  assert.doesNotMatch(src,/energy\.append\(move\)/);
  assert.match(src,/weaponRailOptions\(equipped,Manuals.BY_BOOK\)/);
  assert.match(style,/\.tc-rw-sector--inner/);
  assert.match(style,/\.tc-rw-sector--outer/);
  assert.match(page,/最多裝備兩把武器，每把三招/);
  assert.doesNotMatch(page,/切換為主武器/);
});

test('resuming a pre-weapon PvE room migrates its actor without resetting the battle',async()=>{
  const db=fixture(),created=await API.start(db,'u1',{mode:'pve'},NOW);
  const live=db.records.get(API.ROOMS+'/'+created.id),hero=live.actors.find(a=>a.uid==='u1');
  const before={x:hero.x,y:hero.y,hp:hero.hp,stamina:hero.stamina,revision:live.revision};
  delete hero.manualWeaponMode;delete hero.manualWeaponIds;
  hero.manualSkills=['wind-slash'];
  const previous=db.records.get(API.MANUALS+'/u1');
  db.records.set(API.MANUALS+'/u1',
    Manuals.normalize({...Manuals.weaponize(previous),
      weaponIds:['sword-wind','body-rock']}));
  const resumed=await API.start(db,'u1',{mode:'pve'},NOW+1);
  assert.equal(resumed.id,created.id);
  const actor=resumed.actors.find(a=>a.uid==='u1');
  assert.equal(actor.manualWeaponMode,true);
  assert.deepEqual(actor.manualWeaponIds,['sword-wind','body-rock']);
  assert(actor.manualSkills.includes('rock-fist'));
  assert.deepEqual({x:actor.x,y:actor.y,hp:actor.hp,stamina:actor.stamina,
    revision:resumed.revision},before);
  assert.equal(db.records.get(API.ROOMS+'/'+created.id).actors[0].manualWeaponMode,true);
});
test('room-state polling upgrades legacy PvE actors persistently',async()=>{
  const db=fixture(),created=await API.start(db,'u1',{mode:'pve'},NOW);
  const room=db.records.get(API.ROOMS+'/'+created.id),hero=room.actors[0];
  delete hero.manualWeaponMode;delete hero.manualWeaponIds;
  const snapshot=await API.state(db,'u1',NOW+3,'pve');
  assert.equal(snapshot.actors[0].manualWeaponMode,true);
  assert.deepEqual(snapshot.actors[0].manualWeaponIds,['sword-wind',null]);
  assert.equal(db.records.get(API.ROOMS+'/'+created.id).actors[0].manualWeaponMode,true);
});
test('client does not gate the PvE right ring on a legacy manualWeaponMode flag',()=>{
  const src=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/tactical-combat.js'),'utf8');
  assert.match(src,/if\(quarter\)\{\s*renderModernWeaponWheel\(me,locked,mine\)/);
  assert.match(src,/if\(hero\?\.manualWeaponMode\|\|modernPveWheel\(\)\)/);
  assert.match(src,/function currentWeaponIds\(hero\)/);
  assert.match(src,/rightWheel='two-weapons-v4'/);
});
