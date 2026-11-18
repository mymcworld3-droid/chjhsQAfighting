'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const M=require('../dungeon-movement.cjs');
const SECRET='0123456789abcdef01234567';
const clone=value=>structuredClone(value);
const party=(layout,ids=['a','b','c','d'])=>{
 const room={status:'assembled',members:Object.fromEntries(ids.map((uid,i)=>[
 uid,{uid,joinedAtMs:i+1,ready:true,moveSeq:0}]))};
 return {...room,members:M.startExplorationMembers(room,layout)};
};
const catchStatus=(fn,status)=>{
 assert.throws(fn,error=>error?.status===status);
};
test('four distinct server spawn pads are chosen deterministically by join order',()=>{
 const map=generateDungeonLayout(SECRET),room=party(map);
 for(let i=0;i<4;i++){
  const member=room.members['abcd'[i]];
  assert.deepEqual(member.position,map.spawnPads[i]);
  assert.equal(member.explorationStamina,M.START_STAMINA);
  assert.equal(member.moveSeq,0);
  assert.equal(walkable(map,member.position),true);
 }
 const shuffled={status:'assembled',members:{
  b:{uid:'b',joinedAtMs:12},a:{uid:'a',joinedAtMs:11}
 }};
 assert.deepEqual(M.spawnFor(shuffled,'b',map),map.spawnPads[1]);
 assert.deepEqual(M.spawnFor(shuffled,'a',map),map.spawnPads[0]);
 catchStatus(()=>M.spawnFor(shuffled,'stranger',map),403);
});
test('cardinal move subtracts exactly one private exploration stamina and never mutates the original room',()=>{
 const map=generateDungeonLayout(SECRET),room=party(map,['a','b']);
 const start=room.members.a.position;
 const [dx,dy]=[[1,0],[0,1],[-1,0],[0,-1]]
   .find(([dx,dy])=>walkable(map,{x:start.x+dx,y:start.y+dy}));
 assert.ok(dx!==undefined);
 const before=clone(room);
 const r=M.moveOnMap(room,'a',map,{dx,dy,step:1});
 assert.equal(r.duplicate,false);
 assert.deepEqual(r.member.position,{x:start.x+dx,y:start.y+dy});
 assert.equal(r.member.moveSeq,1);
 assert.equal(r.member.explorationStamina,M.START_STAMINA-M.STEP_COST);
 assert.deepEqual(r.members.b,room.members.b);
 assert.deepEqual(room,before);
 const repeat=M.moveOnMap({...room,members:r.members},'a',map,{dx,dy,step:1});
 assert.equal(repeat.duplicate,true);
 assert.equal(repeat.member.explorationStamina,M.START_STAMINA-1);
 catchStatus(()=>M.moveOnMap({...room,members:r.members},'a',map,{dx:-dx,dy:-dy,step:1}),409);
 catchStatus(()=>M.moveOnMap({...room,members:r.members},'a',map,{dx,dy,step:3}),409);
});
test('reject teleport, diagonal, zero-step, invalid directions and impersonation',()=>{
 const map=generateDungeonLayout(SECRET),room=party(map);
 for(const [dx,dy]of [[0,0],[2,0],[1,1],[-1,-1],[-3,0],
   ['1',0],[NaN,0],[Infinity,0],[0,null]]){
  catchStatus(()=>M.moveOnMap(room,'a',map,{dx,dy,step:1}),400);
 }
 for(const step of [-1,0,1.2,'1',Number.MAX_SAFE_INTEGER+1]){
  catchStatus(()=>M.moveOnMap(room,'a',map,{dx:1,dy:0,step}),400);
 }
 catchStatus(()=>M.moveOnMap(room,'intruder',map,{dx:1,dy:0,step:1}),403);
 const waiting={...room,status:'waiting'};
 catchStatus(()=>M.moveOnMap(waiting,'a',map,{dx:1,dy:0,step:1}),409);
});
test('solid walls stop players and never spend energy; co-op members may share a tile',()=>{
 const map=generateDungeonLayout(SECRET),room=party(map);
 let wall=null;
 for(let y=1;y<map.height-1&&!wall;y++)for(let x=1;x<map.width-1;x++){
  if(!walkable(map,{x,y}))continue;
  const direction=[[0,-1],[1,0],[0,1],[-1,0]]
    .find(([dx,dy])=>!walkable(map,{x:x+dx,y:y+dy}));
  if(direction){wall={x,y,dx:direction[0],dy:direction[1]};break;}
 }
 assert.ok(wall);
 room.members.a.position={x:wall.x,y:wall.y};
 const energy=room.members.a.explorationStamina;
 catchStatus(()=>M.moveOnMap(room,'a',map,{dx:wall.dx,dy:wall.dy,step:1}),409);
 assert.equal(room.members.a.explorationStamina,energy);
 room.members.b.position={x:wall.x,y:wall.y};
 const dir=[[0,-1],[1,0],[0,1],[-1,0]]
   .find(([dx,dy])=>walkable(map,{x:wall.x+dx,y:wall.y+dy}));
 assert.ok(dir);
 room.members.b.position={x:wall.x+dir[0],y:wall.y+dir[1]};
 const success=M.moveOnMap(room,'b',map,{dx:-dir[0],dy:-dir[1],step:1});
 assert.deepEqual(success.member.position,room.members.a.position);
});
test('zero stamina cannot move; successful play decreases to zero without underflow',()=>{
 const map=generateDungeonLayout(SECRET),room=party(map,['a']);
 const pos=room.members.a.position;
 const direction=[[0,1],[1,0],[0,-1],[-1,0]]
   .find(([dx,dy])=>walkable(map,{x:pos.x+dx,y:pos.y+dy}));
 room.members.a.explorationStamina=1;
 const result=M.moveOnMap(room,'a',map,{dx:direction[0],dy:direction[1],step:1});
 assert.equal(result.member.explorationStamina,0);
 catchStatus(()=>M.moveOnMap({...room,members:result.members},'a',map,{
   dx:-direction[0],dy:-direction[1],step:2
 }),409);
});
test('1200 seeds have safe spawn tiles and at least one legal initial step',()=>{
 for(let i=0;i<1200;i++){
  const map=generateDungeonLayout('movement-seed-'+i);
  const room=party(map);
  for(const uid of 'abcd'){
   const pos=room.members[uid].position;
   const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
   assert.ok(dirs.some(([dx,dy])=>walkable(map,{x:pos.x+dx,y:pos.y+dy})),uid+' '+i);
  }
 }
});
