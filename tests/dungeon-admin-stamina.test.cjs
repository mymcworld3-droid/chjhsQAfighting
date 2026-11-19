
'use strict';
// Fixed-energy admin privilege is sourced only from Firebase A users.isAdmin.
// Plain room data used in pure tests deliberately distinguishes admin/normal.
const test=require('node:test'),assert=require('node:assert/strict');
const Stamina=require('../dungeon-stamina-rules.cjs');
const Movement=require('../dungeon-movement.cjs');
const Strike=require('../dungeon-player-combat.cjs');
const Skills=require('../dungeon-skill-combat.cjs');
const Rescue=require('../dungeon-team-rescue.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Credits=require('../dungeon-quiz-credit.cjs');
const API=require('../dungeon-room-api.cjs').__test;
const map={width:32,height:16,tiles:Array(32*16).fill(1),
  spawn:{x:2,y:2},spawnPads:[{x:2,y:2},{x:4,y:2}]};
const actor=(uid,admin=false,x=2,y=2)=>({uid,name:uid,
  dungeonAdmin:admin,position:{x,y},explorationStamina:10,
  battleHealth:100,battleMaxHealth:100,downed:false,
  moveSeq:0,strikeSeq:0,skillSeq:0,rescueSeq:0,guardSeq:0});
const memberRoom=(admin=false)=>({
  id:'dungroom000001',mode:'dungeon',status:'assembled',
  dungeonArena:'exploration',assembledAtMs:1800000000000,
  battleAppliedTick:0,
  members:{a:actor('a',admin)},enemies:[]});
const next=(room,out)=>({...room,members:out.members,
  ...(out.enemies?{enemies:out.enemies}:{})});
test('pure stamina rules show ten for admins and ordinary costs for non-admins',()=>{
  assert.equal(Stamina.staminaFor({dungeonAdmin:true,explorationStamina:0}),10);
  assert.equal(Stamina.staminaAfterCost({dungeonAdmin:true,explorationStamina:0},8),10);
  assert.equal(Stamina.staminaAfterCost({dungeonAdmin:false,explorationStamina:10},8),2);
  assert.equal(Stamina.staminaFor({isAdmin:true,explorationStamina:0}),0,
    'isAdmin in client input is not a trusted dungeon permission');
  assert.equal(API.makeMember('a','Admin',0,{isAdmin:true}).dungeonAdmin,true);
  assert.equal(API.makeMember('b','Regular',0,{isAdmin:'true'}).dungeonAdmin,false);
});
test('admin can walk more than ten tiles in one authoritative route without stamina loss',()=>{
  const vectors=Array.from({length:12},()=>({dx:1,dy:0}));
  const admin=memberRoom(true),normal=memberRoom(false);
  const out=Movement.moveRouteOnMap(admin,'a',map,{vectors,step:1});
  assert.deepEqual(out.member.position,{x:14,y:2});
  assert.equal(out.member.explorationStamina,10);
  assert.equal(out.member.moveSeq,12);
  assert.throws(()=>Movement.moveRouteOnMap(normal,'a',map,{vectors,step:1}),
    /探索體力不足/);
  assert.equal(normal.members.a.explorationStamina,10,'failed route is atomic');
  const short=Movement.moveRouteOnMap(normal,'a',map,{vectors:vectors.slice(0,3),step:1});
  assert.equal(short.member.explorationStamina,7);
});
test('admin basic attacks and equipped skills retain ten energy after repeated casts',()=>{
  const admin=memberRoom(true),ordinary=memberRoom(false);
  const enemy={id:'beast-1',kind:'wolf',position:{x:3,y:2},
    battleHealth:10000,battleMaxHealth:10000};
  admin.enemies=[enemy];ordinary.enemies=[enemy];
  let state=admin;
  for(let seq=1;seq<=7;seq++){
    const out=Strike.strikeEnemy(state,'a',map,{enemyId:'beast-1',seq});
    assert.equal(out.members.a.explorationStamina,10);
    state=next(state,out);
  }
  const normal=Strike.strikeEnemy(ordinary,'a',map,{enemyId:'beast-1',seq:1});
  assert.equal(normal.members.a.explorationStamina,8);
  const record={school:'body',books:{'body-dragon':{exp:2500}},
    equipped:['dragon-strike','dragon-guard','dragon-roar'],
    loadouts:[{name:'admin',skillIds:['dragon-strike','dragon-guard','dragon-roar']}],
    activeLoadout:0};
  const initial=Skills.initialCombatLoadout(admin.members.a,record);
  let magic={...admin,members:{a:{...admin.members.a,...initial}},enemies:[
    {id:'beast-1',kind:'golem',position:{x:5,y:2},
      battleHealth:10000,battleMaxHealth:10000}
  ]};
  for(let seq=1;seq<=7;seq++){
    const out=Skills.castSkill(magic,'a',map,record,{
      skillId:'dragon-strike',target:{x:5,y:2},seq});
    assert.equal(out.members.a.explorationStamina,10);
    magic=next(magic,out);
  }
  assert.equal(magic.members.a.skillSeq,7);
});
test('admin rescue and boss guarding spend zero effective stamina but obey normal limits',()=>{
  const admin=memberRoom(true);
  admin.members.b={...actor('b',false,3,2),battleHealth:0,downed:true};
  const saved=Rescue.help(admin,'a',map,{targetUid:'b',seq:1});
  assert.equal(saved.members.a.explorationStamina,10);
  assert.equal(saved.members.b.downed,false);
  assert.equal(saved.members.b.allyReviveCount,1);
  const self={...memberRoom(true),members:{
    a:{...actor('a',true,2,2),battleHealth:0,downed:true}
  }};
  const revived=Rescue.help(self,'a',map,{targetUid:'a',seq:1});
  assert.equal(revived.members.a.explorationStamina,10);
  assert.equal(revived.members.a.selfRescueCount,1);
  const arena={...memberRoom(true),dungeonArena:'boss',
    bossEncounter:{status:'fighting'},members:{
      a:actor('a',true,2,2),b:actor('b',false,3,2)
    }};
  const out=Boss.guard(arena,'a',map,{targetUid:'b',seq:1});
  assert.equal(out.members.a.explorationStamina,10);
  const normal={...arena,members:{...arena.members,
    a:actor('a',false,2,2)}};
  const spent=Boss.guard(normal,'a',map,{targetUid:'b',seq:1});
  assert.equal(spent.members.a.explorationStamina,7);
});
test('admin receives no extra stamina from answered quiz but still advances trusted receipt',()=>{
  const admin=memberRoom(true),uid='a',id=admin.id;
  admin.members.a.explorationStamina=0; // legacy/stale C data
  const key=id+':'+admin.assembledAtMs;
  const q={uid,questionId:'q1',index:1,correct:true,amount:4};
  const source={sessionKey:key,roomId:id,reviews:{q1:q}};
  const grant=Credits.credit(admin,uid,source,'q1',id);
  assert.equal(grant.members.a.explorationStamina,10);
  assert.equal(grant.credit.granted,0);
  assert.equal(grant.members.a.quizCreditSeq,1);
  assert.equal(Credits.credit({...admin,members:grant.members},
    uid,source,'q1',id).duplicate,true);
  const ordinary=memberRoom(false);
  ordinary.members.a.explorationStamina=2;
  const regular=Credits.credit(ordinary,uid,source,'q1',id);
  assert.equal(regular.members.a.explorationStamina,6);
  assert.equal(regular.credit.granted,4);
});
