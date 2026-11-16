'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const API=require('../tactical-combat-api.cjs').__test;
const Rules=require('../public/cultivation/tactical-rules.js');
const Manuals=require('../public/cultivation/manual-rules.js');
const {database}=require('./helpers/tactical-db.cjs');
const NOW=2_000_000_000_000;

function fixture(){
  const db=database();
  db.records.get('users/u1').stats.totalScore=188;
  db.records.set(API.MANUALS+'/u1',Manuals.normalize({
    school:'sword',books:{'sword-wind':{exp:1000000}},
    equipped:['wind-slash'],activeLoadout:0,skillLevels:{'wind-step':3},
    loadouts:[
      {name:'近身斬擊',skillIds:['wind-slash']},
      {name:'閃步',skillIds:['wind-step']},
      {name:'空手',skillIds:[]}
    ]
  }));
  return db;
}
const switchTo=(API,db,roomId,index,requestId,uid='u1')=>
  API.switchBattleLoadout(db,uid,{roomId,index,requestId},NOW+1);

test('switching saved skills inside PvE is free, preserves resources and persists the chosen preset',async()=>{
  const db=fixture();
  const first=await API.start(db,'u1',{mode:'pve'},NOW);
  const initial=first.actors.find(actor=>actor.uid==='u1');
  assert.deepEqual(initial.manualSkills,['wind-slash']);
  assert.equal(initial.manualLoadoutIndex,0);
  const changed=await switchTo(API,db,first.id,1,'switch-loadout-001');
  const hero=changed.actors.find(actor=>actor.uid==='u1');
  assert.deepEqual(hero.manualSkills,['wind-step']);
  assert.equal(hero.manualSkillLevels['wind-step'],3);
  assert.equal(hero.manualLoadoutIndex,1);
  assert.equal(hero.manualLoadoutName,'閃步');
  assert.equal(changed.revision,first.revision+1);
  assert.equal(hero.stamina,initial.stamina);
  assert.equal(hero.actions,initial.actions);
  assert.equal(hero.attacks,initial.attacks);
  assert.equal(hero.hp,initial.hp);
  assert.deepEqual([hero.x,hero.y],[initial.x,initial.y]);
  assert.equal(changed.turn,first.turn);
  assert.equal(changed.turnUid,first.turnUid);
  assert.equal(Rules.manualSkillFor(hero,'wind-slash'),null);
  assert.equal(Rules.manualSkillFor(hero,'wind-step').level,3);
  const stored=db.records.get(API.MANUALS+'/u1');
  assert.equal(stored.activeLoadout,1);
  assert.deepEqual(stored.equipped,['wind-step']);
  assert.deepEqual(db.records.get(API.ROOMS+'/'+first.id).pveMetrics.loadout,['wind-step']);
  assert.throws(()=>Rules.apply(changed,'u1',{type:'manual',skillId:'wind-slash',x:hero.x+1,y:hero.y},NOW+1),
    /尚未裝備或解鎖此功法技能/);
  const replay=await switchTo(API,db,first.id,1,'switch-loadout-001');
  assert.equal(replay.revision,changed.revision);
  const bare=await switchTo(API,db,first.id,2,'switch-loadout-002');
  assert.deepEqual(bare.actors[0].manualSkills,[]);
  assert.equal(Rules.basicFor(bare.actors[0]).id,'attack');
  assert.equal(bare.actors[0].stamina,initial.stamina);
});

test('PvP can switch a preset when it is not the player turn',async()=>{
  const db=fixture();
  const waiting=await API.start(db,'u1',{mode:'pvp'},NOW);
  const joined=await API.start(db,'u2',{mode:'pvp',code:waiting.id.slice(6)},NOW+1);
  assert.equal(joined.status,'active');
  const toSwitch=joined.turnUid==='u1'?'u2':'u1';
  if(toSwitch==='u2'){
    db.records.get('users/u2').stats.totalScore=188;
    db.records.set(API.MANUALS+'/u2',structuredClone(db.records.get(API.MANUALS+'/u1')));
  }
  const before=joined.actors.find(a=>a.uid===toSwitch);
  const changed=await switchTo(API,db,joined.id,1,'switch-pvp-001',toSwitch);
  const after=changed.actors.find(a=>a.uid===toSwitch);
  assert.equal(changed.turnUid,joined.turnUid);
  assert.deepEqual(after.manualSkills,['wind-step']);
  assert.equal(after.actions,before.actions);
  assert.equal(after.stamina,before.stamina);
});

test('nonparticipants, invalid presets and finished rooms cannot switch',async()=>{
  const db=fixture();
  const room=await API.start(db,'u1',{mode:'pve'},NOW);
  const rejected=db.records.get(API.ROOMS+'/'+room.id).revision;
  await assert.rejects(switchTo(API,db,room.id,3,'switch-invalid-01'),/配置不存在/);
  await assert.rejects(switchTo(API,db,room.id,1,'switch-invalid-01','u2'),/不是此戰場/);
  await assert.rejects(switchTo(API,db,'arena-0000000000000000',1,'switch-invalid-02'),/戰場不存在/);
  assert.equal(db.records.get(API.ROOMS+'/'+room.id).revision,rejected);
  db.records.get(API.ROOMS+'/'+room.id).status='finished';
  await assert.rejects(switchTo(API,db,room.id,1,'switch-finished-01'),/不是進行中的戰鬥/);
});

test('client exposes a compact loadout chooser and updates the live PvP skill buttons',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
  const style=fs.readFileSync(path.join(__dirname,'../public/styles/tactical-combat.css'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-training-page.js'),'utf8');
  assert.match(src,/data-loadout-toggle/);
  assert.match(src,/data-loadout-index/);
  assert.match(src,/api\('\/api\/tactical\/loadout'/);
  assert.match(src,/function syncPvpSkillTabs\(\)/);
  assert.match(src,/tabs\.replaceChildren\(move,\.\.\.buttons\)/);
  assert.match(src,/renderBattleLoadouts\(\)/);
  assert.match(src,/syncEquippedAttack\(\);renderer\?\.update/);
  assert.match(style,/\.tc-loadout-popover/);
  assert.match(page,/戰鬥中也能使用戰場上方的「配置」按鈕自由切換/);
});
