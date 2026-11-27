'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/cultivation/weave-weapon-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),O=require('../public/cultivation/weapon-special-objects.js'),G=require('../public/cultivation/weapon-geometry.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const p=(x,y)=>({x,y}),board={width:13,height:13,blocked:()=>false},origin=p(6,6),sk=id=>D.skillAtLevel(id,1,0);
const marks=(points,uid='u',state)=>points.reduce((s,position,i)=>O.add(s,{type:'mark',ownerUid:uid,position,board,generatedAt:i}),state);
const room=(points,position=p(5,5),walls=[])=>{
  const map={width:13,height:13,tiles:Array(169).fill(1)};for(const q of walls)map.tiles[q.y*13+q.x]=0;
  return {map,room:{status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:origin,battleHealth:1000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position,battleHealth:1000,battleMaxHealth:1000}],weaponObjects:marks(points)}};
};
test('weave mark attacks three tiles and preserves FIFO without duplicate refresh',()=>{
  let state;
  for(const aim of [p(7,6),p(6,7),p(5,6),p(6,5)]){
    const {plan}=W.selected(board,origin,sk('weave-mark'),state,'u',aim);
    assert.equal(plan.cells.length,3);state=W.place(state,plan,{uid:'u',board,clock:1,level:1});
  }
  assert.deepEqual(O.owned(state,'u','mark').map(o=>o.position),[p(6,7),p(5,6),p(6,5)]);
  const {plan}=W.selected(board,origin,sk('weave-mark'),state,'u',p(5,6));assert.deepEqual(W.place(state,plan,{uid:'u',board,clock:2}),state);
});
test('all ordered pairs precomputed, no foreign endpoint, reversible paths and walls reject',()=>{
  let state=marks([p(2,2),p(2,7),p(7,2)]);state=marks([p(10,10)],'v',state);
  const all=W.plans(board,origin,sk('weave-thread'),state,'u');assert.equal(all.pairs.length,12);
  for(const pair of all.pairs){
    const a=all.byPair[W.pairKey(pair.first,pair.second)],b=all.byPair[W.pairKey(pair.second,pair.first)];
    assert.deepEqual(a.cells,b.cells.slice().reverse());
    assert.ok(a.cells.every(q=>all.cells.some(c=>G.key(c)===G.key(q))));
  }
  assert.equal(W.selected(board,origin,sk('weave-thread'),state,'u',p(10,10),p(2,2)).plan,null);
  assert.equal(W.selected({...board,blocked:q=>q.x===2&&q.y===4},origin,sk('weave-thread'),state,'u',p(2,7),p(2,2)).plan,null);
});
test('domain two, collinear and polygon powers include boundary and interior, reject broken edges',()=>{
  for(const [points,power] of [[[p(2,2),p(2,8)],2.4],[[p(2,2),p(2,5),p(2,8)],2.8],[[p(2,2),p(2,8),p(8,2)],3.2]]){
    const state=marks(points),plan=W.selected(board,origin,sk('weave-domain'),state,'u',origin).plan;
    assert.equal(plan.power,power);assert.ok(points.every(q=>plan.cells.some(c=>G.key(c)===G.key(q))));
    if(power===3.2){assert.ok(plan.cells.some(q=>q.x===4&&q.y===4));
      const interior=W.selected({...board,blocked:q=>q.x===4&&q.y===4},origin,sk('weave-domain'),state,'u',origin).plan;
      assert.ok(interior);assert.ok(!interior.cells.some(q=>q.x===4&&q.y===4));}
    assert.equal(W.selected({...board,blocked:q=>q.x===2&&q.y===4},origin,sk('weave-domain'),state,'u',origin).plan,null);
  }
  assert.equal(W.selected(board,origin,sk('weave-domain'),marks([p(2,2)]),'u',origin).plan,null);
});
test('actual trial preview uses all pairs, does not mutate and matches dungeon domain damage',()=>{
  const points=[p(2,2),p(2,8),p(8,2)],s=R.create({id:'weave',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:1000,manualSkills:[]}],now:2000000000000});
  Object.assign(s,{width:13,height:13,blocks:[],objective:null,actors:s.actors.slice(0,2),weaponObjects:marks(points)});
  Object.assign(s.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(s.actors[1],{x:4,y:4,hp:1000,maxHp:1000,shield:0,guard:0,counter:0,boss:false,footprint:{width:2,height:2}});
  const before=JSON.stringify(s),out=R.previewCast(s,s.actors[0],sk('weave-domain'),origin);
  assert.equal(out.hits.length,1);assert.equal(out.hits[0].damage,320);assert.equal(JSON.stringify(s),before);
  assert.deepEqual(out.weaponObjects,s.weaponObjects);
  const preview=R.skillPreviewPlan(s,s.actors[0],sk('weave-thread'));assert.equal(preview.pairs.length,12);assert.equal(Object.keys(preview.byPair).length,12);
  const {map,room:r}=room(points,p(4,4)),old=JSON.stringify(r),actual=C.resolveCast(r,'u',map,sk('weave-domain'),{target:origin,seq:1,base:100});
  assert.equal(actual.result.totalDamage,320);assert.equal(actual.result.hits.length,1);assert.deepEqual(actual.weaponObjects,r.weaponObjects);assert.equal(JSON.stringify(r),old);
});
test('actual dungeon arbitrary pair and mark persistence, no resource spent by rejected pair',()=>{
  const {map,room:r}=room([p(2,2),p(2,8)],p(2,4)),before=JSON.stringify(r);
  const out=C.resolveCast(r,'u',map,sk('weave-thread'),{first:p(2,2),target:p(2,8),seq:1,base:100});
  assert.equal(out.result.totalDamage,225);assert.equal(out.members.u.explorationStamina,7);assert.deepEqual(out.weaponObjects,r.weaponObjects);
  assert.throws(()=>C.resolveCast(r,'u',map,sk('weave-thread'),{first:p(3,3),target:p(2,8),seq:1,base:100}),/端點/);
  const mark=C.resolveCast(r,'u',map,sk('weave-mark'),{target:p(7,6),seq:1,base:100});
  assert.equal(O.owned(mark.weaponObjects,'u','mark').length,3);assert.equal(JSON.stringify(r),before);
});
