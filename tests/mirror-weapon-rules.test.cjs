'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/mirror-weapon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y}),sk=id=>D.skillAtLevel(id,1,0),board={width:13,height:13,blocked:()=>false},origin=p(5,6);
const object=(b=board,uid='u')=>O.add(undefined,{type:'mirror',ownerUid:uid,board:b,generatedAt:1});
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
test('mirror is absent until summoned, uniquely owned and point symmetric on odd and even maps',()=>{
 for(const b of [board,{...board,width:12,height:8}]){
  assert.equal(M.location(b,p(1,2),undefined,'u'),null);
  const plan=M.selected(b,p(1,2),sk('mirror-summon'),undefined,'u',p(1,2)).plan;
  let state=M.activate(undefined,plan,{uid:'u',board:b,clock:1});
  assert.equal(O.owned(state,'u','mirror').length,1);
  for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
   assert.deepEqual(M.location(b,p(x,y),state,'u'),p(b.width-1-x,b.height-1-y));
  }
  assert.equal(M.location(b,p(1,2),state,'other'),null);
  assert.deepEqual(M.activate(state,plan,{uid:'u',board:b,clock:2}),state);
  assert.equal(M.location(b,p(1,2),M.reconcileEquipment(state,'u',['body-bell']),'u'),null);
  assert.equal(M.location(b,p(1,2),M.finish(state),'u'),null);
 }
});
test('summon activates even in a wall, attacks nine cells only when legal, and preserves owner position',()=>{
 for(const blocked of [false,true]){
  const walls=blocked?[p(7,6)]:[],enemy=p(8,6),s=trial(enemy,walls),before=JSON.stringify(s);
  const out=R.previewCast(s,s.actors[0],sk('mirror-summon'),origin);
  assert.equal(out.cells.length,blocked?0:9);assert.equal(out.hits.length,blocked?0:1);
  assert.equal(O.owned(out.weaponObjects,'u','mirror').length,1);assert.equal(JSON.stringify(s),before);assert.equal(out.finalPositions.length,0);
  const {room,map}=dungeon(enemy,walls),actual=C.resolveCast(room,'u',map,sk('mirror-summon'),{target:origin,seq:1,base:100});
  assert.equal(actual.result.totalDamage,blocked?0:280);assert.deepEqual(actual.members.u.position,origin);
  assert.equal(actual.members.u.explorationStamina,6);assert.equal(O.owned(actual.weaponObjects,'u','mirror').length,1);
 }
});
test('mirror strike uses actual opposite direction, 30 percent and independent obstacle checks',()=>{
 const state=object(),from=p(3,6),aim=p(4,6),shadow=p(9,6),enemy=p(8,6);
 for(const walls of [[],[shadow],[enemy]]){
  const b={...board,blocked:q=>walls.some(w=>w.x===q.x&&w.y===q.y)},plan=M.selected(b,from,sk('mirror-strike'),state,'u',aim).plan;
  assert.equal(plan.parts.length,walls.length?1:2);
 }
 for(const [stateNow,enemyNow,damage] of [[undefined,p(4,6),160],[state,p(8,6),48]]){
  const s=trial(enemyNow,[],stateNow,from),out=R.previewCast(s,s.actors[0],sk('mirror-strike'),aim);
  assert.equal(out.hits[0].damage,damage);
  const {room,map}=dungeon(enemyNow,[],stateNow,from),actual=C.resolveCast(room,'u',map,sk('mirror-strike'),{target:aim,seq:1,base:100});
  assert.equal(actual.result.totalDamage,damage);assert.equal(actual.members.u.explorationStamina,8);
 }
});
test('swap relocates real owner, keeps symmetric avatar, and overlapping nine-cell bursts each damage once',()=>{
 const state=object(),s=trial(p(6,6),[],state),old=JSON.stringify(s);
 const out=R.previewCast(s,s.actors[0],sk('mirror-swap'),origin);
 assert.deepEqual(out.hits.map(h=>h.damage),[160,160]);assert.deepEqual(out.finalPositions,[{uid:'u',x:7,y:6}]);assert.equal(JSON.stringify(s),old);
 const {room,map}=dungeon(p(6,6),[],state),actual=C.resolveCast(room,'u',map,sk('mirror-swap'),{target:origin,seq:1,base:100});
 assert.equal(actual.result.totalDamage,320);assert.deepEqual(actual.members.u.position,p(7,6));assert.equal(actual.members.u.explorationStamina,6);
 assert.deepEqual(M.location(board,actual.members.u.position,state,'u'),origin);
});
test('missing avatar, occupied landing and wall refuse swap; large enemy deduplicates each burst',()=>{
 for(const [state,enemy,walls] of [[undefined,p(6,6),[]],[object(),p(7,6),[]],[object(),p(6,6),[p(7,6)]]]){
  const s=trial(enemy,walls,state),plan=R.skillPreviewPlan(s,s.actors[0],sk('mirror-swap'));
  assert.equal(plan.aims.length,0);assert.ok(plan.reason);
  const {room,map}=dungeon(enemy,walls,state);assert.throws(()=>C.resolveCast(room,'u',map,sk('mirror-swap'),{target:origin,seq:1,base:100}),/蜃影/);
 }
 const s=trial(p(5,7),[],object());s.actors[1].footprint={width:2,height:2};
 const out=R.previewCast(s,s.actors[0],sk('mirror-swap'),origin);assert.equal(out.hits.length,2);
 const {room,map}=dungeon(p(6,6),[],object());room.members.v={uid:'v',position:p(7,6),battleHealth:100};
 assert.throws(()=>C.resolveCast(room,'u',map,sk('mirror-swap'),{target:origin,seq:1,base:100}),/占用/);
});
