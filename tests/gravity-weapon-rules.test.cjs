'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../public/cultivation/gravity-weapon-rules.js'),Geo=require('../public/cultivation/weapon-geometry.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
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


const makeCore=(position=p(6,6),clock=1)=>O.add(undefined,{type:'core',ownerUid:'u',position,board,generatedAt:clock});
test('gravity strike and immediate core pull use shared geometry in both modes',()=>{
 for(const [id,target,enemy,expected] of [['gravity-strike',p(6,6),p(7,6),200],['gravity-core',p(6,6),p(8,6),80]]){
  const s=trial(enemy),before=JSON.stringify(s),out=R.previewCast(s,s.actors[0],sk(id),target);
  const {room,map}=dungeon(enemy),actual=C.resolveCast(room,'u',map,sk(id),{target,seq:1,base:100});
  assert.equal(out.hits.reduce((n,h)=>n+h.damage,0),expected);assert.equal(actual.result.totalDamage,expected);assert.equal(JSON.stringify(s),before);
  assert.equal(actual.members.u.explorationStamina,10-sk(id).cost);
  if(id==='gravity-core'){
   assert.equal(G.core(actual.weaponObjects,'u').remainingTriggers,4);assert.equal(G.core(out.weaponObjects,'u').remainingTriggers,4);
   assert.deepEqual(actual.enemies[0].position,p(7,6));assert.deepEqual(out.gravityBeat.moves[0].to,p(7,6));
  }
 }
});
test('core trigger is monotone, five uses only, exhausted persists until owner end',()=>{
 let state=makeCore(),e={id:'e',position:p(8,6),battleHealth:10000},damage=0;
 const options={board,actors:[e],targets:[e],alive:t=>t.battleHealth>0,move:(t,to)=>{t.position=to;},apply:(t,power)=>{damage+=power*100;return {damage:power*100};}};
 for(const step of [1,1,2,2,3,4,5,5,6]){
  const out=G.trigger(state,'u',step,options);state=out.state;
 }
 assert.equal(damage,400);assert.equal(G.core(state,'u').remainingTriggers,0);assert.deepEqual(e.position,p(7,6));
 assert.ok(G.core(G.endOwnerWindow(state,'u',4),'u'));assert.equal(G.core(G.endOwnerWindow(state,'u',5),'u'),null);
});
test('rightward rotation reserves footprints, does not pull into any core, and stationary targets still take damage',()=>{
 const state=makeCore(),targets=[{id:'a',position:p(8,6),hp:1000},{id:'b',position:p(7,5),hp:1000},{id:'c',position:p(4,5),hp:1000,footprint:{width:2,height:2}},{id:'d',position:p(6,7),hp:1000}];
 const b={...board,blocked:q=>q.x===7&&q.y===6};let moved=[],hits=[];
 const out=G.trigger(state,'u',1,{board:b,actors:targets,targets,alive:e=>e.hp>0,move:(e,to)=>{moved.push(e.id);e.position=to;},apply:(e,power)=>{hits.push(e.id);return {damage:power*100};}});
 const cells=targets.flatMap(e=>Geo.footprint(e)).map(Geo.key);
 assert.equal(new Set(cells).size,cells.length);assert.ok(!cells.includes('6,6'));assert.equal(hits.length,4);assert.equal(out.beat.moves.filter(m=>m.moved).length,moved.length);
 assert.ok(!moved.includes('d'));assert.ok(hits.includes('d'));
});
test('one enemy-side beat for all monsters and one own-side beat, fifth survives until end',()=>{
 let s=trial(p(8,6));s.actors[1].intent={kind:'wait',cells:[]};s.actors[1].atk=0;
 const initial=R.previewCast(s,s.actors[0],sk('gravity-core'),p(6,6));
 s.weaponObjects=initial.weaponObjects;Object.assign(s.actors[1],p(7,6),{hp:920});
 for(let i=0;i<2;i++){s=R.apply(s,'u',{type:'end'},2000000000001+i);assert.equal(G.core(s.weaponObjects,'u').remainingTriggers,2-2*i);}
 assert.equal(G.core(s.weaponObjects,'u').remainingTriggers,0);
 s=R.apply(s,'u',{type:'end'},2000000000003);assert.equal(G.core(s.weaponObjects,'u'),null);
});
test('crash selects highest footprint zone once and consumes only owner core',()=>{
 for(const [enemy,damage] of [[p(7,6),550],[p(8,6),300],[p(9,6),150]]){
  const state=makeCore(),s=trial(enemy,[],state),out=R.previewCast(s,s.actors[0],sk('gravity-crash'),p(6,6));
  const {room,map}=dungeon(enemy,[],state),actual=C.resolveCast(room,'u',map,sk('gravity-crash'),{target:p(6,6),seq:1,base:100});
  assert.equal(out.hits[0].damage,damage);assert.equal(actual.result.totalDamage,damage);assert.deepEqual(actual.members.u.position,p(6,6));assert.equal(G.core(actual.weaponObjects,'u'),null);
 }
 const s=trial(p(7,5),[],makeCore());s.actors[1].footprint={width:2,height:2};
 const out=R.previewCast(s,s.actors[0],sk('gravity-crash'),p(6,6));assert.equal(out.hits.length,1);assert.equal(out.hits[0].damage,550);
 assert.equal(R.skillPreviewPlan(trial(p(8,6)),s.actors[0],sk('gravity-crash')).aims.length,0);
});
test('mirror can copy gravity strike only; invalid placement or landing rejected',()=>{
 const state=O.add(undefined,{type:'mirror',ownerUid:'u',board,generatedAt:1}),s=trial(p(8,6),[],state,p(3,6));
 const out=R.previewCast(s,s.actors[0],sk('gravity-strike'),p(4,6));assert.equal(out.hits[0].damage,60);
 assert.throws(()=>R.previewCast(s,s.actors[0],sk('gravity-core'),p(3,6)),/空地/);
 const occupied=trial(p(6,6),[],makeCore());assert.throws(()=>R.previewCast(occupied,occupied.actors[0],sk('gravity-crash'),p(6,6)),/落點/);
});
