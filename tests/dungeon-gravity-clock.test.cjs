'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const AI=require('../dungeon-enemy-ai.cjs'),G=require('../dungeon-gravity-clock.cjs'),O=require('../public/cultivation/weapon-special-objects.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),D=require('../public/cultivation/new-weapon-drafts.js'),Boss=require('../dungeon-boss-battle.cjs');
const p=(x,y)=>({x,y}),time=1800000000000,board={width:15,height:15,blocked:()=>false},map={width:15,height:15,tiles:Array(225).fill(1),mainRoute:[],branches:[]};
function fixture(){
 const member={uid:'u',position:p(5,6),battleHealth:10000,battleMaxHealth:10000,explorationStamina:10,dungeonAttack:100,skillSeq:0};
 const enemy={id:'beast-1',name:'wolf',kind:'wolf',position:p(8,6),battleHealth:1000,battleMaxHealth:1000,cadence:99,zone:'main-east',attack:null};
 const room={mode:'dungeon',status:'assembled',assembledAtMs:time,battleStartedAtMs:time,battleAppliedTick:0,enemyAiVersion:1,members:{u:member},enemies:[enemy]};
 const out=C.resolveCast(room,'u',map,D.skillAtLevel('gravity-core',1,0),{target:p(6,6),seq:1,base:100});
 return {...room,members:out.members,enemies:out.enemies,weaponObjects:out.weaponObjects};
}
test('world clock is party-wide, deterministic and preserves fifth pulse window',()=>{
 let room=fixture();const start=JSON.stringify(room);
 assert.equal(room.enemies[0].battleHealth,920);assert.equal(O.owned(room.weaponObjects,'u','core')[0].remainingTriggers,4);
 const a=AI.advanceWorld(room,map,time+4000),b=AI.advanceWorld(room,map,time+4000);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(room),start);
 room={...room,...a};assert.equal(room.enemies[0].battleHealth,840);assert.equal(AI.advanceWorld(room,map,time+4000),null);
 for(let tick=5;tick<=16;tick++){const next=AI.advanceWorld(room,map,time+1000*tick);room={...room,...next};}
 assert.equal(room.enemies[0].battleHealth,600);assert.equal(room.gravityEvents.length,4);
 assert.equal(new Set(room.gravityEvents.map(e=>e.id)).size,4);assert.equal(room.members.u.skillSeq,1);
 assert.equal(O.owned(room.weaponObjects,'u','core')[0].remainingTriggers,0);
 assert.equal(room.gravityEvents[3].result.weaponTimeline.durationMs,280);
 room={...room,...AI.advanceWorld(room,map,time+19000)};assert.equal(O.owned(room.weaponObjects,'u','core').length,1);
 room={...room,...AI.advanceWorld(room,map,time+20000)};assert.equal(O.owned(room.weaponObjects,'u','core').length,0);assert.equal(room.enemies[0].battleHealth,600);
});
test('idle catch-up produces only one pulse, not four retroactive attacks',()=>{
 const room=fixture(),delta=AI.advanceWorld(room,map,time+60000);
 assert.equal(delta.enemies[0].battleHealth,840);assert.equal(delta.gravityEvents.length,1);
 assert.equal(O.owned(delta.weaponObjects,'u','core')[0].lastTrigger,60);
});
test('multiple owners have independent clocks and no same-tick duplicate',()=>{
 let room=fixture(),state=O.add(room.weaponObjects,{type:'core',ownerUid:'v',position:p(9,6),generatedAt:0,board});
 state=O.triggerCore(state,'v',0).state;room={...room,weaponObjects:state,members:{...room.members,v:{...room.members.u,uid:'v',position:p(10,6)}}};
 const out=AI.advanceWorld(room,map,time+4000);
 assert.equal(out.gravityEvents.length,2);assert.equal(out.enemies[0].battleHealth,760);
 assert.equal(out.gravityEvents[0].uid,'u');assert.equal(out.gravityEvents[1].uid,'v');
});
test('automatic gravity can finish the guardian or boss with authoritative proof',()=>{
 let room=fixture();room.enemies=[{...room.enemies[0],id:'guardian-1',kind:'guardian',battleHealth:60}];room.dungeonProgress={version:1,guardianStatus:'alive'};
 const delta=AI.advanceWorld(room,map,time+4000);
 assert.equal(delta.enemies.length,0);assert.equal(delta.dungeonProgress.guardianStatus,'defeated');assert.equal(delta.dungeonProgress.defeatedByUid,'u');
 const arena=Boss.mapFor('gravity-test'),boss=Boss.initialBoss();
 boss.battleHealth=40;boss.shield=0;boss.nextActionTick=99;
 const center=p(boss.position.x-1,boss.position.y),b={width:arena.width,height:arena.height,blocked:q=>!arena.tiles[q.y*arena.width+q.x]};
 let state=O.add(undefined,{type:'core',ownerUid:'u',position:center,board:b,generatedAt:0});state=O.triggerCore(state,'u',0).state;
 room={...room,dungeonArena:'boss',bossEncounter:{version:1,status:'fighting'},enemies:[boss],weaponObjects:state};
 const win=AI.advanceWorld(room,arena,time+4000);
 assert.equal(win.enemies.length,0);assert.equal(win.bossEncounter.status,'defeated');assert.equal(win.bossEncounter.defeatedAtTick,4);assert.equal(win.weaponObjects.objects.length,0);
});
test('movement interrupts an actual windup; a blocked target retains its attack',()=>{
 const room=fixture(),session=G.create(room,map),attack={cells:[p(5,6)],startedAtTick:1,resolvesAtTick:5};
 const moved={...room.enemies[0],position:p(8,6),attack},blocked={...room.enemies[0],id:'beast-2',position:p(6,7),attack};
 const next=session.beforeTick([moved,blocked],room.members,4);
 assert.equal(next[0].attack,null);assert.equal(next[0].gravityStaggerTick,4);assert.deepEqual(next[1].attack,attack);assert.equal(next[1].battleHealth,840);
});
