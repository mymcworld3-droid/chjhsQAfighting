'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Catalog=require('../public/cultivation/manual-rules.js');
const R=require('../public/cultivation/tactical-rules.js');
const API=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
const bookRecord=db=>db.records.get(API.MANUALS+'/u1');
const lowBeast=(id,x,y,hp=80)=>R.actor({
  uid:id,name:id,bot:true,team:'monster',atk:15,maxHp:hp
},{x,y});

test('four scriptures each contain three skills and separate, exact killing-blow unlock thresholds',()=>{
  assert.equal(Catalog.BOOKS.length,4);
  assert.equal(Catalog.BOOKS.filter(book=>book.school==='sword').length,2);
  assert.equal(Catalog.BOOKS.filter(book=>book.school==='body').length,2);
  for(const book of Catalog.BOOKS){
    assert.equal(book.skills.length,3);
    assert.deepEqual(book.skills.map(skill=>skill.killsRequired),[0,3,8]);
  }
  const raw={school:'sword',books:{'sword-wind':{kills:3}},equipped:['wind-slash','wind-step','wind-thousand','wind-slash']};
  assert.deepEqual(Catalog.normalize(raw).equipped,['wind-slash','wind-step']);
  assert.equal(Catalog.unlocked(raw,'wind-thousand'),false);
});

test('school selection grants one starter book and switching does not duplicate its grant',async()=>{
  const db=database();
  const first=await API.chooseSchool(db,'u1',{school:'sword'});
  assert.equal(first.school,'sword');
  assert.equal(first.library.find(book=>book.id==='sword-wind').owned,true);
  assert.deepEqual(first.equipped,['wind-slash']);
  const second=await API.chooseSchool(db,'u1',{school:'body'});
  assert.equal(second.school,'body');
  assert.equal(second.library.filter(book=>book.owned).length,1);
  assert.deepEqual(second.equipped,['wind-slash'],'cross-school skills remain selectable');
  assert.equal(bookRecord(db).starterClaimed,true);
});

test('server rejects unowned, locked, duplicate and four-slot loadouts',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'body'});
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['rock-break']}),/尚未解鎖/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['wind-slash']}),/尚未解鎖/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['rock-fist','rock-fist']}),/不重複/);
  await assert.rejects(API.equipManualSkills(db,'u1',{skillIds:['a','b','c','d']}),/最多/);
  const state=await API.equipManualSkills(db,'u1',{skillIds:[]});
  assert.equal(state.equipped.length,0);
  assert.equal((await API.manualsState(db,'u2')).books['body-rock'],undefined);
});

test('only equipped manual attacks can execute, and killing creatures grants mastery exactly once',async()=>{
  const db=database();await API.chooseSchool(db,'u1',{school:'sword'});
  const state=await API.start(db,'u1',{mode:'pve'},now),raw=db.records.get(API.ROOMS+'/'+state.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:3,stamina:10});
  raw.actors=[raw.actors[0],lowBeast('m1',2,3),lowBeast('m2',3,3),lowBeast('m3',4,3),lowBeast('keep',6,6,1000)];
  const request={roomId:state.id,revision:state.revision,requestId:'manual-kill-once-01',
    type:'manual',skillId:'wind-slash',x:2,y:3};
  const first=await API.command(db,'u1',request,now);
  assert.equal(first.manualKills.u1['sword-wind'],3);
  assert.equal(bookRecord(db).books['sword-wind'].kills,3);
  assert.equal(Catalog.unlocked(bookRecord(db),'wind-step'),true);
  assert.equal(first.actors[0].stamina,7);
  const again=await API.command(db,'u1',request,now);
  assert.equal(again.manualKills.u1['sword-wind'],3);
  assert.equal(bookRecord(db).books['sword-wind'].kills,3);
  await assert.rejects(API.command(db,'u1',{...request,requestId:'manual-forged-02',
    skillId:'wind-thousand',revision:first.revision},now),/尚未裝備/);
  assert.equal(bookRecord(db).books['sword-wind'].kills,3);
});

test('ordinary and golden-core kills cannot grant manual mastery',()=>{
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',
    players:[{uid:'u1',name:'u1',atk:200,maxHp:1000,manualSkills:['rock-fist']}],now});
  s.blocks=[];Object.assign(s.actors[0],{x:1,y:3,stamina:10});
  s.actors=[s.actors[0],lowBeast('weak',2,3),lowBeast('far',6,6,900)];
  const killed=R.apply(s,'u1',{type:'attack',x:2,y:3},now);
  assert.equal(killed.manualKills,undefined);
});

test('trial clear awards an unowned book with pity, once, in the same transaction',async()=>{
  const db=database();
  await API.chooseSchool(db,'u1',{school:'body'});
  const ref=API.MANUALS+'/u1';db.records.get(ref).dropMisses=3;
  const state=await API.start(db,'u1',{mode:'pve'},now),raw=db.records.get(API.ROOMS+'/'+state.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:3,stamina:10,correct:1});
  raw.actors=[raw.actors[0],lowBeast('last',2,3)];
  const request={roomId:state.id,revision:state.revision,requestId:'manual-clear-0001',type:'attack',x:2,y:3};
  const complete=await API.command(db,'u1',request,now);
  assert.equal(complete.status,'finished');
  const drop=complete.manualDrops?.u1;
  assert.ok(drop?.id&&drop?.name);
  assert.equal(bookRecord(db).books[drop.id].kills,0);
  const count=Object.keys(bookRecord(db).books).length;
  const replay=await API.command(db,'u1',request,now);
  assert.equal(replay.manualDrops?.u1?.id,drop.id);
  assert.equal(Object.keys(bookRecord(db).books).length,count);
  assert.equal(db.records.get(API.PLAYERS+'/u1').trial.stage,2);
  assert.equal(db.records.get('users/u1').stats.gold,35);
});
