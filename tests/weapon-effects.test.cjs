'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../public/cultivation/weapon-effects.js');
const A=require('../public/cultivation/tactical-animation.js');
const F=require('../public/cultivation/tactical-skill-effects.js');
const p=(x,y)=>({x,y}),v={ox:0,oy:0,cell:40,width:9,height:7};
const event={version:2,durationMs:600,segments:[
  {kind:'ray',start:0,impact:140,end:260,tone:'ice',rays:[{cells:[p(1,1),p(2,1),p(3,1)]},{cells:[p(1,1),p(1,2)]}],hits:[{uid:'b',damage:40,cell:p(3,1)}]},
  {kind:'shock',start:180,impact:270,end:380,origin:p(1,1),radius:2,cells:[p(3,1)],hits:[{uid:'b',damage:20,cell:p(3,1)}],moves:[{uid:'b',path:[p(3,1),p(4,1)],style:'slide'}]},
  {kind:'vortex',start:380,impact:450,end:600,origin:p(2,2),radius:3,cells:[p(4,1)],hits:[{uid:'b',damage:10,cell:p(4,1)}],moves:[{uid:'b',path:[p(4,1),p(3,1)],style:'arc'}]}
]};
function ctx(){const calls=[];let depth=0;return new Proxy({calls,depth:()=>depth},{get(o,k){if(k in o)return o[k];return (...args)=>{for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a),String(k));if(k==='save')depth++;if(k==='restore')depth--;calls.push([k,...args]);}},set(o,k,value){if(typeof value==='number')assert.ok(Number.isFinite(value));o[k]=value;return true;}});}
test('parallel rays share one segment and ordered hits appear only at committed impact',()=>{
  const t=W.normalize(event);assert.ok(t);assert.equal(W.active(t,.1)[0].rays.length,2);
  assert.equal(W.numberFrames(t,.2).length,0);
  assert.equal(W.numberFrames(t,.25)[0].damage,40);
  assert.ok(W.numberFrames(t,.5).some(h=>h.damage===20));
  assert.ok(W.numberFrames(t,.8).some(h=>h.damage===10));
  assert.deepEqual(W.numberFrames(t,1),[]);
});
test('repeated displacements use committed intermediate and final positions',()=>{
  const t=W.normalize(event);assert.deepEqual(W.motionPose(t,'b',.2),{x:3,y:1,lift:0,opacity:1});
  const moving=W.motionPose(t,'b',.55);assert.ok(moving.x>3&&moving.x<4);
  assert.equal(W.motionPose(t,'b',.69).x,4);assert.equal(W.motionPose(t,'b',1).x,3);
  const before=[{uid:'b',x:3,y:1,hp:100,shield:0}],after=[{...before[0],hp:30}];
  assert.equal(W.sample(t,before,after,.1)[0].hp,100);assert.equal(W.sample(t,before,after,1)[0].hp,30);
});
test('six primitives are read only in both layers and reduced motion; no early impact',()=>{
  const raw={version:2,durationMs:500,segments:['ray','shock','domain','echo','vortex','crash'].map(kind=>({kind,start:0,impact:200,end:500,origin:p(1,1),target:p(3,3),radius:2,cells:[p(2,2)],vertices:[p(1,1),p(2,2),p(1,2)],rays:[{cells:[p(1,1),p(2,2)],collision:p(2,2)}],echoes:[{position:p(3,3),to:p(4,4),type:'mirror'}],hits:[{uid:'b',damage:10,cell:p(2,2)}]}))};
  const t=W.normalize(raw),before=JSON.stringify(t);
  for(const reduced of [false,true])for(const above of [false,true])for(const q of [.1,.5,.8]){
    const c=ctx();assert.equal(W.draw(c,t,q,v,above,{reduced}),true);
    if(above&&q<.4)assert.deepEqual(c.calls,[['save'],['restore']]);else assert.ok(c.calls.length>2);
    assert.equal(c.depth(),0);
  }
  assert.equal(JSON.stringify(t),before);
});
test('special objects render without changing authoritative state',()=>{
  const state={version:1,objects:[{type:'mark',active:true,position:p(1,1)},{type:'mirror',active:true,ownerUid:'u',positionMode:'point-symmetric'},{type:'echo',active:true,position:p(3,3)},{type:'core',active:true,position:p(4,4)}]};
  const before=JSON.stringify(state),c=ctx();assert.ok(W.drawObjects(c,state,[{uid:'u',x:2,y:2}],v,500));assert.equal(c.depth(),0);assert.equal(JSON.stringify(state),before);
});
test('invalid version, duration and unordered impacts are rejected',()=>{
  assert.equal(W.normalize({...event,version:1}),null);assert.equal(W.normalize({...event,durationMs:1000}),null);
  assert.equal(W.normalize({...event,segments:[...event.segments].reverse()}),null);
});
test('trial planner and shared skill effects consume committed V2 without legacy regrouping',()=>{
  const actors=[{uid:'u',x:1,y:1,hp:100,shield:0},{uid:'b',x:3,y:1,hp:100,shield:0}];
  const previous={id:'battle',revision:1,width:9,height:7,actors,events:[]};
  const next={...previous,revision:2,actors:[actors[0],{...actors[1],hp:30}],events:[{id:'1:1',actor:'u',skill:'bell-echo',type:'cast',animation:{kind:'cast',style:'bell-echo',origin:p(1,1),target:p(3,1),weaponTimeline:event,changes:[{uid:'b',hp:30}]}}]};
  const scenes=A.plan(previous,next,'u');assert.equal(scenes.length,1);assert.equal(scenes[0].duration,600);
  assert.equal(A.sample(scenes[0],1)[1].hp,30);assert.equal(F.draw(ctx(),scenes[0],.5,v,false),true);
});
