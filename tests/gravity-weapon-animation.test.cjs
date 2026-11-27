'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../public/cultivation/gravity-weapon-rules.js'),Geo=require('../public/cultivation/weapon-geometry.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const W=require('../public/cultivation/weapon-effects.js');
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

test('gravity strike, core and crash V2 retain committed damage and synchronized landings',()=>{
 for(const [id,target,enemy,duration,impact,state] of [
 ['gravity-strike',p(6,6),p(7,6),280,145,undefined],
 ['gravity-core',p(6,6),p(8,6),350,240,undefined],
 ['gravity-crash',p(6,6),p(7,6),600,300,makeCore()]]){
  const s=trial(enemy,[],state),out=R.previewCast(s,s.actors[0],sk(id),target);
  const {room,map}=dungeon(enemy,[],state),actual=C.resolveCast(room,'u',map,sk(id),{target,seq:1,base:100});
  const t=W.normalize(out.weaponTimeline),d=W.normalize(actual.result.weaponTimeline);
  assert.ok(t&&d);assert.equal(t.durationMs,duration);assert.equal(d.durationMs,duration);
  assert.equal(t.segments[0].impact,impact);assert.equal(actual.result.visualVersion,2);
  for(const timeline of [t,d]){
   assert.equal(W.numberFrames(timeline,(impact-1)/duration).length,0);
   assert.equal(W.numberFrames(timeline,(impact+1)/duration).reduce((n,h)=>n+h.damage,0),actual.result.totalDamage);
   for(const m of timeline.segments[0].moves){
    const pose=W.motionPose(timeline,m.uid,impact/duration);assert.deepEqual(p(pose.x,pose.y),m.path.at(-1));
    assert.ok(W.motionPose(timeline,m.uid,(impact-20)/duration));
   }
  }
 }
});
test('one core beat moves multiple enemies concurrently without replaying their damage',()=>{
 const s=trial(p(8,6)),e=s.actors[1];s.actors.push({...e,uid:'extra',x:6,y:3});
 const out=R.previewCast(s,s.actors[0],sk('gravity-core'),p(6,6)),t=W.normalize(out.weaponTimeline);
 assert.equal(t.segments.length,1);assert.equal(t.segments[0].moves.length,2);assert.equal(t.segments[0].hits.length,2);
 for(const m of t.segments[0].moves){const a=W.motionPose(t,m.uid,.35);assert.ok(a.x!==m.path[0].x||a.y!==m.path[0].y);}
 const initial=out.weaponObjects;s.weaponObjects=initial;let next=R.apply(s,'u',{type:'end'},2000000000001);
 const events=next.events.filter(e=>e.animation?.weaponTimeline?.segments.some(q=>q.gravity==='pull'));
 assert.equal(events.length,2);assert.ok(events.every(e=>W.normalize(e.animation.weaponTimeline)?.durationMs===280));
});
test('gravity timeline paints finite coordinates, arcs and reduced motion without state mutation',()=>{
 const s=trial(p(7,6),[],makeCore()),t=W.normalize(R.previewCast(s,s.actors[0],sk('gravity-crash'),p(6,6)).weaponTimeline);
 const saved=JSON.stringify([s,t]),view={ox:0,oy:0,cell:32,width:13,height:13};
 for(const reduced of [true,false]){
  let depth=0,draws=0;const ctx=new Proxy({},{get(o,k){if(k in o)return o[k];return (...args)=>{if(k==='save')depth++;if(k==='restore')depth--;if(k==='stroke'||k==='fill')draws++;for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n));}},set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v));o[k]=v;return true;}});
  for(let ms=0;ms<=600;ms+=10){W.drawObjects(ctx,s.weaponObjects,s.actors,view,ms,{reduced});W.draw(ctx,t,ms/600,view,false,{reduced});W.draw(ctx,t,ms/600,view,true,{reduced});assert.equal(depth,0);}
  assert.ok(draws>0);
 }
 assert.equal(JSON.stringify([s,t]),saved);
});
