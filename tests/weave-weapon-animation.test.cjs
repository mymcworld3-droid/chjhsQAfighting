'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Q=require('../public/cultivation/weave-weapon-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),O=require('../public/cultivation/weapon-special-objects.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),W=require('../public/cultivation/weapon-effects.js'),A=require('../public/cultivation/tactical-animation.js');
const p=(x,y)=>({x,y}),origin=p(6,6),board={width:13,height:13,blocked:()=>false};
const state=[p(2,2),p(2,8),p(8,2)].reduce((s,position,i)=>O.add(s,{type:'mark',ownerUid:'u',position,board,generatedAt:i}),undefined);
const sk=id=>D.skillAtLevel(id,1,0);
const trial=(enemy=p(4,4))=>{
  const s=R.create({id:'weave-animation',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:1000,manualSkills:[]}],now:2000000000000});
  Object.assign(s,{width:13,height:13,blocks:[],objective:null,actors:s.actors.slice(0,2),weaponObjects:state});
  Object.assign(s.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(s.actors[1],{...enemy,hp:1000,maxHp:1000,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
  return s;
};
test('two endpoint selection highlights all legal seconds and casts on second tap, cancels without mutation',()=>{
  const s=trial(),plan=R.skillPreviewPlan(s,s.actors[0],sk('weave-thread')),before=JSON.stringify(s);
  const first=Q.choose(plan,null,p(2,2));assert.equal(first.confirm,false);assert.equal(first.selection.choosing,true);
  assert.equal(Q.selectionPlan(plan,first.selection).aims.length,3);
  const second=Q.choose(plan,first.selection,p(2,8));assert.equal(second.confirm,plan.byPair['2,2|2,8'].valid);assert.equal(second.selection.choosing,false);
  const insufficient={...plan,byPair:{...plan.byPair,'2,2|2,8':{...plan.byPair['2,2|2,8'],valid:false}}};
  assert.equal(Q.choose(insufficient,first.selection,p(2,8)).confirm,false);
  assert.equal(Q.choose(plan,second.selection,p(2,2)).selection,null);
  assert.equal(Q.choose(plan,first.selection,p(1,1)).selection,first.selection);
  assert.equal(JSON.stringify(s),before);
  assert.equal(Q.selected(board,origin,sk('weave-thread'),state,'u',{x:'2',y:8},p(2,2)).plan,null);
});
test('three authoritative weave timelines share committed damage, endpoint geometry and audio beats',()=>{
  const map={width:13,height:13,tiles:Array(169).fill(1)};
  for(const [id,target,first,enemy,damage,duration] of [
    ['weave-mark',p(7,6),null,p(8,6),150,300],
    ['weave-thread',p(2,8),p(2,2),p(2,4),225,360],
    ['weave-domain',origin,null,p(4,4),320,500]]){
    const s=trial(enemy),before=JSON.stringify(s),out=R.previewCast(s,s.actors[0],sk(id),target,first);
    assert.equal(JSON.stringify(s),before);
    const room={status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:origin,battleHealth:1000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position:enemy,battleHealth:1000,battleMaxHealth:1000}],weaponObjects:state};
    const result=C.resolveCast(room,'u',map,sk(id),{target,first,seq:1,base:100});
    const t=W.normalize(out.weaponTimeline),d=W.normalize(result.result.weaponTimeline);assert.ok(t&&d);assert.equal(t.durationMs,duration);assert.equal(d.durationMs,duration);
    assert.equal(d.segments[0].hits[0].damage,damage);assert.equal(t.segments[0].hits[0].damage,damage);assert.equal(result.result.totalDamage,damage);
    assert.equal(W.numberFrames(t,(t.segments[0].impact-1)/duration).length,0);
    assert.equal(W.numberFrames(t,(t.segments[0].impact+1)/duration)[0].damage,damage);
    assert.equal(O.owned(result.weaponObjects,'u','mark').length,3);
    if(id!=='weave-mark')assert.deepEqual(result.weaponObjects,state);
    const sounds=[],played=new Set();for(let ms=0;ms<duration;ms++)W.advanceWeaveSound(t,id,ms,played,(id,opts)=>sounds.push(opts.key),'cast');
    assert.equal(sounds.length,id==='weave-mark'?1:2);assert.equal(new Set(sounds).size,sounds.length);
    const previous={...s,events:[],revision:1},changes=[{uid:s.actors[1].uid,hp:1000-damage}];
    const next={...previous,revision:2,events:[{id:'2:1',actor:'u',type:'cast',skill:id,animation:{kind:'cast',style:id,weaponTimeline:t,weaponGroup:'g',changes}},{id:'2:2',actor:'u',type:'damage',animation:{kind:'damage',weaponGroup:'g'}}]};
    assert.equal(A.plan(previous,next,'u').length,1);
  }
});
test('formation and persistent marks render bounded normal and reduced layers',()=>{
  const plan=Q.selected(board,origin,sk('weave-domain'),state,'u',origin).plan;
  const t=W.normalize(Q.timeline(plan,sk('weave-domain'),[{uid:'e',damage:320,absorbed:0,cell:p(4,4)}]));
  const before=JSON.stringify([t,state]);const view={ox:0,oy:0,cell:36,width:13,height:13};
  for(const reduced of [false,true]){
    let depth=0,draws=0;
    const ctx=new Proxy({},{get(o,k){if(k in o)return o[k];return (...args)=>{if(k==='save')depth++;if(k==='restore')depth--;if(k==='stroke'||k==='fillRect'||k==='fill')draws++;for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v));}},set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v));o[k]=v;return true;}});
    for(let ms=0;ms<=500;ms+=10){
      W.drawObjects(ctx,state,[],view,ms,{reduced});
      for(const above of [false,true])assert.equal(W.draw(ctx,t,ms/500,view,above,{reduced}),true);
      assert.equal(depth,0);
    }
    assert.ok(draws>0);
  }
  assert.equal(JSON.stringify([t,state]),before);
});
