'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/mirror-weapon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),Manuals=require('../public/cultivation/manual-rules.js');
const p=(x,y)=>({x,y}),board={width:19,height:13,blocked:()=>false},origin=p(3,6);
const sk=id=>Manuals.BY_SKILL[id]?Manuals.skillAtLevel(Manuals.BY_SKILL[id],1,0):D.skillAtLevel(id,1,0);
const object=O.add(undefined,{type:'mirror',ownerUid:'u',board,generatedAt:1});
function trial(enemy,walls=[],from=origin,state=object){
 const s=R.create({id:'copy-test',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
 Object.assign(s,{width:19,height:13,blocks:walls,objective:null,actors:s.actors.slice(0,2),weaponObjects:state});
 Object.assign(s.actors[0],{...from,atk:100,stamina:10});
 Object.assign(s.actors[1],{...enemy,hp:10000,maxHp:10000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
 return s;
}
function dungeon(enemy,walls=[],from=origin,state=object){
 const map={width:19,height:13,tiles:Array(247).fill(1)};for(const q of walls)map.tiles[q.y*19+q.x]=0;
 return {map,room:{status:'assembled',battleAppliedTick:1,members:{u:{uid:'u',position:from,battleHealth:10000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:enemy,battleHealth:10000,battleMaxHealth:10000}],weaponObjects:state}};
}
function pair(id,aim,enemy,walls=[],from=origin){
 const s=trial(enemy,walls,from),before=JSON.stringify(s),out=R.previewCast(s,s.actors[0],sk(id),aim);
 assert.equal(JSON.stringify(s),before);
 const {room,map}=dungeon(enemy,walls,from),old=JSON.stringify(room),actual=C.resolveCast(room,'u',map,sk(id),{target:aim,seq:1,base:100});
 assert.equal(JSON.stringify(room),old);assert.equal(actual.members.u.explorationStamina,10-sk(id).cost);
 assert.deepEqual(out.mirrorSteps.map(s=>s.cells),actual.result.mirrorSteps.map(s=>s.cells));
 assert.equal(out.hits.reduce((n,h)=>n+h.damage,0),actual.result.totalDamage);
 assert.deepEqual(out.mirrorSteps.map(s=>s.hits.reduce((n,h)=>n+h.damage,0)),actual.result.mirrorSteps.map(s=>s.hits.reduce((n,h)=>n+h.damage,0)));
 return {out,actual};
}
test('straight fists and T-shaped punches independently rotate and check obstacles',()=>{
 let a=pair('rock-fist',p(4,6),p(14,6));assert.equal(a.actual.result.totalDamage,39);
 a=pair('rock-break',p(4,6),p(13,7));assert.equal(a.actual.result.totalDamage,59);assert.deepEqual(a.actual.enemies[0].position,p(10,7));
 a=pair('rock-fist',p(4,6),p(13,6),[p(14,6)]);assert.equal(a.actual.result.totalDamage,0);
 const part=M.copyGeometry(board,origin,sk('rock-break'),{direction:p(1,0),power:1.95});
 assert.equal(part.cells.length,4);assert.deepEqual(part.source,p(15,6));assert.ok(part.cells.some(q=>q.x===13&&q.y===7));
});
test('dash and two punches use reflected landing and one resource charge',()=>{
 const a=pair('tiger-step',p(5,6),p(12,6));
 assert.equal(a.actual.result.totalDamage,96);assert.deepEqual(a.actual.result.mirrorSteps.map(s=>s.source),[p(13,6),p(13,6)]);
 assert.deepEqual(a.actual.members.u.position,p(5,6));assert.equal(a.out.hits.length,2);
 const blocked=pair('tiger-step',p(5,6),p(12,6),[p(13,6)]);assert.equal(blocked.actual.result.totalDamage,0);
});
test('four-step chain recomputes reflected origin each beat, skips wall then resumes',()=>{
 const a=pair('dragon-guard',p(4,6),p(11,7),[p(14,6)]);
 // The second origin lies inside a wall; the living target is on open terrain.
 assert.deepEqual(a.actual.result.mirrorSteps.map(s=>s.source),[p(15,6),p(14,6),p(13,6),p(12,6)]);
 assert.equal(a.actual.result.mirrorSteps[1].suppressed,true);
 assert.equal(a.actual.result.mirrorSteps[2].suppressed,false);
 const b=pair('dragon-guard',p(4,6),p(14,6));
 assert.equal(b.actual.result.totalDamage,144);assert.deepEqual(b.actual.enemies[0].position,p(10,6));
 assert.deepEqual(b.actual.members.u.position,p(7,6));
});
test('reflected throw checks actual landing and echo re-evaluates each ring',()=>{
 const a=pair('tiger-throw',p(4,6),p(14,6));assert.equal(a.actual.result.totalDamage,90);assert.deepEqual(a.actual.enemies[0].position,p(16,6));
 const blocked=pair('tiger-throw',p(4,6),p(14,6),[p(16,6)]);assert.equal(blocked.actual.result.totalDamage,0);
 const b=pair('bell-echo',origin,p(14,6));assert.equal(b.actual.result.totalDamage,80);assert.deepEqual(b.actual.enemies[0].position,p(10,6));
 assert.deepEqual(b.actual.result.mirrorSteps.map(q=>q.hits.length),[1,1,1,1]);
 const timeline=b.actual.result.weaponTimeline;
 assert.equal(timeline.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0),80);
});
test('special state and swords never replicate; the shadow has no actor or independent energy',()=>{
 for(const id of ['dragon-roar','flight-summon','weave-domain','mirror-summon','mirror-swap','gravity-core','gravity-crash'])assert.equal(M.canCopy(sk(id)),false);
 for(const id of ['rock-fist','dragon-guard','bell-echo','gravity-strike'])assert.equal(M.canCopy(sk(id)),true);
 const s=trial(p(14,6)),out=R.previewCast(s,s.actors[0],sk('dragon-roar'),origin);
 assert.equal(out.mirrorSteps,undefined);assert.equal(out.hits.length,0);assert.equal(s.actors.length,2);
});
