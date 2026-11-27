'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../public/cultivation/time-weapon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y}),sk=id=>D.skillAtLevel(id,1,0),board={width:13,height:13,blocked:()=>false},origin=p(5,6);
const echo=(state,pos,uid='u')=>O.add(state,{type:'echo',ownerUid:uid,position:pos,board,generatedAt:1});
function trial(enemy,blocks=[],state,from=origin){
 const s=R.create({id:'mirror-test',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
 Object.assign(s,{width:13,height:13,blocks,objective:null,actors:s.actors.slice(0,2),...(state?{weaponObjects:state}:{})});
 Object.assign(s.actors[0],{...from,atk:100,stamina:10});
 Object.assign(s.actors[1],{...enemy,hp:1000,maxHp:1000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
 return s;
}
function dungeon(enemy,blocks=[],state,from=origin){
 const map={width:13,height:13,tiles:Array(169).fill(1)};for(const q of blocks)map.tiles[q.y*13+q.x]=0;
 return {map,room:{status:'assembled',battleAppliedTick:1,members:{u:{uid:'u',position:from,battleHealth:10000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:enemy,battleHealth:1000,battleMaxHealth:1000}],...(state?{weaponObjects:state}:{})}};
}

test('slash saves its original tile, keeps two newest echoes and never follows the player',()=>{
 let state;
 for(const [from,aim] of [[p(2,2),p(3,2)],[p(4,2),p(5,2)],[p(6,2),p(7,2)]]){
  const s=trial(p(8,2),[],state,from),before=JSON.stringify(s);
  const out=R.previewCast(s,s.actors[0],sk('time-slash'),aim);
  assert.equal(JSON.stringify(s),before);
  const {room,map}=dungeon(p(8,2),[],state,from);
  const actual=C.resolveCast(room,'u',map,sk('time-slash'),{target:aim,seq:1,base:100});
  state=actual.weaponObjects;
  assert.deepEqual(O.owned(state,'u','echo').map(e=>e.position),O.owned(out.weaponObjects,'u','echo').map(e=>e.position));
 }
 assert.deepEqual(O.owned(state,'u','echo').map(e=>e.position),[p(4,2),p(6,2)]);
});
test('double uses newest echo only, union uses all three independent rays and consumes own echoes',()=>{
 const state=echo(echo(echo(undefined,p(5,3)),p(8,6)),p(1,1),'v');
 for(const [id,damage,count] of [['time-double',400,2],['time-union',600,0]]){
  const s=trial(p(6,6),[],state),before=JSON.stringify(s);
  const out=R.previewCast(s,s.actors[0],sk(id),p(6,6));
  assert.equal(out.hits.reduce((n,h)=>n+h.damage,0),damage);assert.equal(JSON.stringify(s),before);
  assert.equal(O.owned(out.weaponObjects,'u','echo').length,count);
  assert.equal(O.owned(out.weaponObjects,'v','echo').length,1);
  const {room,map}=dungeon(p(6,6),[],state);
  const actual=C.resolveCast(room,'u',map,sk(id),{target:p(6,6),seq:1,base:100});
  assert.equal(actual.result.totalDamage,damage);assert.equal(O.owned(actual.weaponObjects,'u','echo').length,count);
  assert.equal(actual.members.u.explorationStamina,10-sk(id).cost);
 }
});
test('one blocked or out-of-range origin cannot cancel a valid remaining origin',()=>{
 const state=echo(undefined,p(9,6)),wall=[p(7,6)],aim=p(6,6);
 const s=trial(aim,wall,state),out=R.previewCast(s,s.actors[0],sk('time-double'),aim);
 assert.equal(out.hits.length,1);assert.equal(out.hits[0].damage,200);
 assert.equal(out.timePlan.rays.length,1);
 const {room,map}=dungeon(aim,wall,state);
 assert.equal(C.resolveCast(room,'u',map,sk('time-double'),{target:aim,seq:1,base:100}).result.totalDamage,200);
 const remote=echo(undefined,p(11,6)),plan=T.selected(board,origin,sk('time-double'),remote,'u',p(12,6)).plan;
 assert.deepEqual(plan.rays.map(r=>r.origin),[p(11,6)]);
});
test('no echo, wall target or all blocked origins rejects without spending resources',()=>{
 for(const id of ['time-double','time-union']){
  const s=trial(p(6,6)),before=JSON.stringify(s);
  assert.equal(R.skillPreviewPlan(s,s.actors[0],sk(id)).aims.length,0);
  assert.throws(()=>R.previewCast(s,s.actors[0],sk(id),p(6,6)),/殘影/);assert.equal(JSON.stringify(s),before);
  const {room,map}=dungeon(p(6,6));assert.throws(()=>C.resolveCast(room,'u',map,sk(id),{target:p(6,6),seq:1,base:100}),/殘影/);
 }
});
test('large footprints deduplicate within each ray and equipment cleanup preserves other owners',()=>{
 const state=echo(echo(echo(undefined,p(5,3)),p(8,6)),p(1,1),'v');
 const s=trial(p(6,6),[],state);s.actors[1].footprint={width:2,height:2};
 assert.equal(R.previewCast(s,s.actors[0],sk('time-union'),p(6,6)).hits.length,3);
 assert.equal(O.owned(O.reconcileEquipment(state,'u',['body-mirror']),'u','echo').length,0);
 assert.equal(O.owned(O.reconcileEquipment(state,'u',['body-mirror']),'v','echo').length,1);
});
