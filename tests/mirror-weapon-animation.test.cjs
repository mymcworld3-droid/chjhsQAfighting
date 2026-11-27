'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/cultivation/mirror-weapon-rules.js'),O=require('../public/cultivation/weapon-special-objects.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),Manuals=require('../public/cultivation/manual-rules.js'),W=require('../public/cultivation/weapon-effects.js'),A=require('../public/cultivation/tactical-animation.js');
const p=(x,y)=>({x,y}),board={width:19,height:13,blocked:()=>false},origin=p(3,6);
const sk=id=>Manuals.BY_SKILL[id]?Manuals.skillAtLevel(Manuals.BY_SKILL[id],1,0):D.skillAtLevel(id,1,0);
const object=O.add(undefined,{type:'mirror',ownerUid:'u',board,generatedAt:1});
function fixture(id,from,target,enemy,walls=[],state=object){
 const s=R.create({id:'mirror-vfx',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
 Object.assign(s,{width:19,height:13,blocks:walls,objective:null,actors:s.actors.slice(0,2),weaponObjects:state});
 Object.assign(s.actors[0],{...from,atk:100,stamina:10});
 Object.assign(s.actors[1],{...enemy,hp:10000,maxHp:10000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
 const map={width:19,height:13,tiles:Array(247).fill(1)};for(const q of walls)map.tiles[q.y*19+q.x]=0;
 const room={status:'assembled',battleAppliedTick:1,members:{u:{uid:'u',position:from,battleHealth:10000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:enemy,battleHealth:10000,battleMaxHealth:10000}],weaponObjects:state};
 const out=R.previewCast(s,s.actors[0],sk(id),target);
 const actual=C.resolveCast(room,'u',map,sk(id),{target,seq:1,base:100});
 const trial=W.normalize(out.weaponTimeline),dungeon=W.normalize(actual.result.weaponTimeline);
 assert.ok(trial&&dungeon);assert.equal(actual.result.visualVersion,2);
 const sum=t=>t.segments.flatMap(s=>s.hits).reduce((n,h)=>n+h.damage,0);
 assert.equal(sum(trial),out.hits.reduce((n,h)=>n+h.damage,0));assert.equal(sum(dungeon),actual.result.totalDamage);assert.equal(sum(trial),sum(dungeon));
 return {s,room,out,actual,trial,dungeon};
}
test('mirror strike, summon and swap share synchronized attack times and preserve damage',()=>{
 for(const [id,from,target,enemy,walls,state] of [
  ['mirror-strike',origin,p(4,6),p(14,6),[],object],
  ['mirror-summon',origin,origin,p(14,6),[],O.empty()],
  ['mirror-summon',origin,origin,p(14,6),[p(15,6)],O.empty()],
  ['mirror-swap',p(8,6),p(8,6),p(9,6),[],object]]){
  const a=fixture(id,from,target,enemy,walls,state);
  for(const t of [a.trial,a.dungeon]){
   assert.equal(t.segments.length,2);assert.equal(t.segments[0].impact,t.segments[1].impact);
   assert.equal(t.segments[1].tone,'violet');assert.equal(W.numberFrames(t,(t.segments[0].impact-1)/t.durationMs).length,0);
   if(walls.length){assert.equal(t.segments[1].mirrorSuppressed,true);assert.equal(t.segments[1].hits.length,0);}
   if(id==='mirror-swap'){
    const mid=W.motionPose(t,'u',.25);assert.ok(mid.x>8&&mid.x<10);
    assert.equal(W.motionPose(t,'u',t.segments[0].impact/t.durationMs).x,10);
   }
  }
 }
});
test('copied two-hit dash and four-step chain synchronize every distinct beat and actual motion',()=>{
 for(const [id,target,enemy,walls,count,final] of [
  ['tiger-step',p(5,6),p(12,6),[],2,p(5,6)],
  ['dragon-guard',p(4,6),p(11,7),[p(14,6)],4,p(7,6)],
  ['bell-echo',origin,p(14,6),[],4,origin]]){
  const a=fixture(id,origin,target,enemy,walls);
  for(const t of [a.trial,a.dungeon]){
   assert.equal(t.segments.length,2*count);
   for(let i=0;i<count;i++)assert.equal(t.segments[2*i].impact,t.segments[2*i+1].impact);
   if(id==='dragon-guard'){assert.equal(t.segments[3].mirrorSuppressed,true);assert.equal(t.segments[5].mirrorSuppressed,false);}
   if(id!=='bell-echo')assert.deepEqual(p(W.motionPose(t,'u',1).x,W.motionPose(t,'u',1).y),final);
  }
  const timeline=a.trial,previous={...a.s,events:[],revision:1};
  const changes=a.s.actors.map(x=>({...x,...a.out.finalPositions.find(y=>y.uid===x.uid),hp:x.hp-timeline.segments.flatMap(q=>q.hits).filter(h=>h.uid===x.uid).reduce((n,h)=>n+h.damage,0)}));
  const next={...previous,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:id,animation:{kind:'cast',style:id,weaponTimeline:timeline,weaponGroup:'g',changes}},{id:'2:2',actor:'u',type:'damage',animation:{kind:'damage',weaponGroup:'g'}},{id:'2:3',actor:'u',type:'displace',path:[origin,final],animation:{kind:'move',weaponGroup:'g'}}]};
  assert.equal(A.plan(previous,next,'u').length,1);
 }
});
test('mirror effects and blocked persistent avatar are bounded and read-only',()=>{
 const a=fixture('mirror-summon',origin,origin,p(14,6),[p(15,6)],O.empty()),t=a.trial,view={ox:0,oy:0,cell:32,width:19,height:13};
 const saved=JSON.stringify([t,object]);
 for(const reduced of [false,true]){
  let depth=0,draws=0;
  const ctx=new Proxy({},{get(o,k){if(k in o)return o[k];return (...args)=>{if(k==='save')depth++;if(k==='restore')depth--;if(k==='stroke'||k==='fill')draws++;for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v));}},set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v));o[k]=v;return true;}});
  for(let ms=0;ms<=400;ms+=10){
   W.drawObjects(ctx,object,[{uid:'u',...origin,hp:100}],view,ms,{reduced,blocked:q=>q.x===15&&q.y===6});
   W.draw(ctx,t,ms/400,view,false,{reduced});W.draw(ctx,t,ms/400,view,true,{reduced});
   assert.equal(depth,0);
  }
  assert.ok(draws>0);
 }
 assert.equal(JSON.stringify([t,object]),saved);
});
