'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,
  '../public/cultivation/dungeon-movement-animation.js'),'utf8')
  .replace(/^export /gm,'');
const {dungeonMovementEvents,sampleDungeonMovement,continueDungeonMovement}=
  new Function(src+'\nreturn {dungeonMovementEvents,sampleDungeonMovement,continueDungeonMovement};')();
const A=require('../public/cultivation/tactical-animation.js');
const map={width:14,height:12,tiles:Array(14*12).fill(1)};
const room=()=>({id:'dungroom000001',status:'assembled',assembledAtMs:1000,
  dungeonArena:'exploration',battleAppliedTick:0,
  members:{a:{uid:'a',position:{x:2,y:2},moveSeq:0},
    b:{uid:'b',position:{x:4,y:4},moveSeq:0}},
  enemies:[{id:'beast-1',kind:'wolf',position:{x:6,y:6}}]});
const sample=(e,progress)=>sampleDungeonMovement({...e,startedAt:1000},
  1000+e.scene.duration*progress,A);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,
  actual+' is not '+expected);
test('a legitimate one-tile move uses the same tactical smoothstep sampler, not a jump',()=>{
  const old=room(),next=structuredClone(old);
  next.members.a.position={x:3,y:2};next.members.a.moveSeq=1;
  next.members.a.lastMove={step:1,dx:1,dy:0};
  const [walk]=dungeonMovementEvents(old,next,map);
  assert.ok(walk);assert.equal(walk.scene.kind,'move');
  assert.equal(walk.scene.duration,285);
  assert.deepEqual(sample(walk,0).position,{x:2,y:2});
  near(sample(walk,.25).position.x,2.15625);
  near(sample(walk,.5).position.x,2.5);
  assert.deepEqual(sample(walk,1).position,{x:3,y:2});
  assert.deepEqual(old.members.a.position,{x:2,y:2});
  assert.deepEqual(next.members.a.position,{x:3,y:2});
  assert.equal(dungeonMovementEvents(next,structuredClone(next),map).length,0);
});
test('validated atomic multi-step routes animate every turn, never diagonally',()=>{
  const old=room(),next=structuredClone(old);
  next.members.a.position={x:4,y:3};next.members.a.moveSeq=3;
  next.members.a.lastRoute={step:1,key:'1,0;1,0;0,1'};
  next.members.a.lastMove={step:3,dx:0,dy:1};
  const e=dungeonMovementEvents(old,next,map)[0];
  assert.deepEqual(e.scene.moves[0].path,
    [{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:4,y:3}]);
  near(sample(e,.5).position.x,3.5);
  near(sample(e,.5).position.y,2);
  assert.deepEqual(sample(e,1).position,{x:4,y:3});
  const forged=structuredClone(next);forged.members.a.lastRoute.key='1,0;1,0;1,0';
  assert.equal(dungeonMovementEvents(old,forged,map).length,0,
    'a corrupt visual route must not draw an impossible walk');
  const blocked={...map,tiles:map.tiles.slice()};
  blocked.tiles[2*map.width+3]=0;
  assert.equal(dungeonMovementEvents(old,next,blocked).length,0);
});
test('NPCs walk on adjacent authoritative ticks, never through skipped positions',()=>{
  const before=room(),after=structuredClone(before);
  after.battleAppliedTick=1;after.enemies[0].position={x:7,y:6};
  const [move]=dungeonMovementEvents(before,after,map);
  assert.equal(move.key,'enemy:beast-1');
  assert.ok(sample(move,.5).lift>=0);
  near(sample(move,.5).position.x,6.5);
  const jump=structuredClone(after);jump.enemies[0].position={x:10,y:6};
  assert.equal(dungeonMovementEvents(before,jump,map).length,0);
  const oldArena=structuredClone(before);oldArena.dungeonArena='boss';
  assert.equal(dungeonMovementEvents(oldArena,after,map).length,0);
});
test('skill dash and server-confirmed knockback animate without changing rules',()=>{
  const before=room(),after=structuredClone(before);
  after.members.a.position={x:3,y:2};
  after.members.a.lastSkill={seq:1,visualVersion:1,position:{x:3,y:2},
    visualMoves:[{enemyId:'beast-1',from:{x:6,y:6},to:{x:5,y:6}}]};
  after.enemies[0].position={x:5,y:6};
  const events=dungeonMovementEvents(before,after,map);
  assert.equal(events.length,2);
  assert.equal(events[0].scene.style,'dash');
  assert.equal(events[1].scene.style,'push');
  assert.ok(sample(events[0],.3).position.x>2);
  assert.equal(after.members.a.moveSeq,0,'skill motion cannot counterfeit a move');
  const stale=structuredClone(after);
  assert.equal(dungeonMovementEvents(after,stale,map).length,0);
});
test('a new SSE move during an unfinished walk joins the visible position',()=>{
  const old=room(),one=structuredClone(old);
  one.members.a.position.x=3;one.members.a.moveSeq=1;
  one.members.a.lastMove={step:1,dx:1,dy:0};
  const first={...dungeonMovementEvents(old,one,map)[0],startedAt:1000};
  const two=structuredClone(one);
  two.members.a.position.y=3;two.members.a.moveSeq=2;
  two.members.a.lastMove={step:2,dx:0,dy:1};
  const future=dungeonMovementEvents(one,two,map)[0];
  const joined=continueDungeonMovement(future,first,1100,A);
  const visible=sampleDungeonMovement(first,1100,A).position;
  const nextVisible=sampleDungeonMovement({...joined,startedAt:1100},1100,A).position;
  near(nextVisible.x,visible.x);near(nextVisible.y,visible.y);
  assert.deepEqual(joined.scene.moves[0].path.at(-1),{x:3,y:3});
  const input=JSON.stringify(two);
  sampleDungeonMovement({...joined,startedAt:1100},1400,A);
  assert.equal(JSON.stringify(two),input);
});
test('locked camera and fractional avatar marker follow smooth animation center',()=>{
  const cameraSource=fs.readFileSync(path.join(__dirname,
    '../public/cultivation/dungeon-map-camera.js'),'utf8').replace(/^export /gm,'');
  const cam=new Function(cameraSource+'\nreturn {lockToPlayer,mapPoint};')();
  const c=cam.lockToPlayer({x:2.35,y:4.7},map,390,810);
  near(c.target.x,2.35);near(c.target.y,4.7);
  near(cam.mapPoint(c,{x:2.35,y:4.7},map,390,810).x,195);
  near(cam.mapPoint(c,{x:2.35,y:4.7},map,390,810).y,405);
});
