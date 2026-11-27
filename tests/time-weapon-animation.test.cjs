'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../public/cultivation/time-weapon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js');
const W=require('../public/cultivation/weapon-effects.js'),A=require('../public/cultivation/tactical-animation.js');
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


test('temporal rays use independent origins, simultaneous impact and committed damage',()=>{
 const state=echo(echo(undefined,p(5,3)),p(8,6));
 for(const [id,duration,impact,number] of [['time-slash',280,145,1],['time-double',350,220,2],['time-union',550,300,3]]){
  const aim=p(6,6),s=trial(aim,[],state),before=JSON.stringify(s);
  const preview=R.previewCast(s,s.actors[0],sk(id),aim),{room,map}=dungeon(aim,[],state);
  const actual=C.resolveCast(room,'u',map,sk(id),{target:aim,seq:1,base:100});
  const t=W.normalize(preview.weaponTimeline),d=W.normalize(actual.result.weaponTimeline);
  assert.ok(t&&d);assert.equal(actual.result.visualVersion,2);assert.equal(t.durationMs,duration);
  assert.equal(t.segments.length,number);assert.ok(t.segments.every(s=>s.impact===impact&&s.time));
  assert.deepEqual(t.segments.map(s=>s.origin),preview.timePlan.rays.map(r=>r.origin));
  assert.deepEqual(d.segments.map(s=>s.origin),t.segments.map(s=>s.origin));
  assert.equal(t.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0),actual.result.totalDamage);
  assert.equal(W.numberFrames(t,(impact-1)/duration).length,0);
  assert.equal(W.numberFrames(t,(impact+1)/duration).reduce((n,h)=>n+h.damage,0),actual.result.totalDamage);
  assert.equal(JSON.stringify(s),before);
 }
});
test('blocked consumed echo fades without creating a hit or ray; cues are bounded and deduped',()=>{
 const state=echo(echo(undefined,p(5,3)),p(9,6)),s=trial(p(6,6),[p(7,6)],state);
 const t=W.normalize(R.previewCast(s,s.actors[0],sk('time-union'),p(6,6)).weaponTimeline);
 const blocked=t.segments.find(s=>s.kind==='echo');assert.ok(blocked&&blocked.timeConsume);assert.equal(blocked.hits.length,0);assert.equal(blocked.rays.length,0);
 const played=new Set(),calls=[];
 for(let ms=0;ms<=550;ms+=5)W.advanceTimeSound(t,'time-union',ms,played,(id,o)=>calls.push({id,key:o.key}),'cast');
 assert.equal(calls.length,2);assert.equal(new Set(calls.map(c=>c.key)).size,2);
});
test('time wheel and consumed echoes draw with finite coordinates and balanced canvas state',()=>{
 const state=echo(echo(undefined,p(5,3)),p(8,6)),s=trial(p(6,6),[],state),t=W.normalize(R.previewCast(s,s.actors[0],sk('time-union'),p(6,6)).weaponTimeline);
 const saved=JSON.stringify([t,state]),view={ox:0,oy:0,cell:32,width:13,height:13};
 for(const reduced of [true,false]){
  let depth=0,draws=0;const ctx=new Proxy({},{get(o,k){if(k in o)return o[k];return (...args)=>{if(k==='save')depth++;if(k==='restore')depth--;if(k==='stroke'||k==='fill')draws++;for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n));}},set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v));o[k]=v;return true;}});
  for(let ms=0;ms<=550;ms+=10){W.drawObjects(ctx,state,[],view,ms,{reduced});W.draw(ctx,t,ms/550,view,false,{reduced});W.draw(ctx,t,ms/550,view,true,{reduced});assert.equal(depth,0);}
  assert.ok(draws>0);
 }
 assert.equal(JSON.stringify([t,state]),saved);
});
