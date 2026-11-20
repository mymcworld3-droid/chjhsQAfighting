'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const source=read('public/cultivation/dungeon-map-view.js')
  .replace(/^import .*$/gm,'').replace(/^export /gm,'');
const requests=[],responses=[];
let perfTime=100;
const fakeWindow={devicePixelRatio:2,dispatchEvent(){}};
const frames=[];
const frame=callback=>{frames.push(callback);return frames.length;};
const View=new Function('Camera','castDungeonSkill','window','performance',
  'CustomEvent','requestAnimationFrame','cancelAnimationFrame',source+
  '\nreturn DungeonMapView;')(
  {initialCamera:()=>({zoom:1,panX:0,panY:0})},
  (roomId,skillId,target,seq)=>new Promise(resolve=>{
    requests.push({roomId,skillId,target,seq});responses.push(resolve);
  }),
  fakeWindow,{now:()=>perfTime},
  class CustomEvent{constructor(type,init){this.type=type;this.detail=init.detail;}},
  frame,()=>{});
function viewer(){
  const view=new View();
  view.opened=true;view.seq=2;view.roomId='dungroom-12345678';view.uid='a';
  view.room={id:view.roomId,status:'assembled',revision:2,
    members:{a:{uid:'a',skillSeq:0,position:{x:1,y:1},
      battleHealth:100,explorationStamina:10,
      dungeonSkills:[{id:'test-skill',kind:'fist-attack',name:'拳法',cost:2}]}}};
  view.isCurrent=()=>view.opened;
  view.targetFor=()=>({x:2,y:1});
  view.updateSkillHUD=()=>{};
  view.drawSoon=()=>{};
  view.skillAlert=message=>{view.lastMessage=message;};
  view.updateRoom=room=>{view.room=room;};
  return view;
}
test('skill buttons accept a second input while the first request is pending',async()=>{
  requests.length=0;responses.length=0;
  const view=viewer();
  const first=view.cast('test-skill');
  assert.equal(requests.length,1);
  assert.equal(view.skillPending,true);
  await view.cast('test-skill',{x:3,y:1});
  assert.equal(requests.length,1,'client does not send conflicting sequences');
  assert.deepEqual(view.queuedSkill.target,{x:3,y:1});
  assert.match(view.lastMessage,/下一招已預備/);
  const updated=structuredClone(view.room);
  updated.revision=3;updated.members.a.skillSeq=1;
  updated.members.a.lastSkill={seq:1,skillId:'test-skill',
    skillName:'拳法',totalDamage:12,hits:[]};
  responses[0]({room:updated});
  await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);
  assert.equal(requests[0].seq,1);
  assert.equal(requests[1].seq,2);
  assert.deepEqual(requests[1].target,{x:3,y:1},
    'the queued spell keeps the position of its originating tap');
  const completed=structuredClone(updated);
  completed.revision=4;completed.members.a.skillSeq=2;
  completed.members.a.lastSkill.seq=2;
  responses[1]({room:completed});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(view.skillPending,false);
  assert.equal(view.queuedSkill,null);
});
test('failure clears buffered skill rather than triggering unauthorized retries',async()=>{
  requests.length=0;responses.length=0;
  const view=viewer();
  const first=view.cast('test-skill');
  await view.cast('test-skill');
  responses[0](Promise.reject(new Error('Network error')));
  await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);
  assert.equal(view.queuedSkill,null);
  assert.equal(view.skillPending,false);
});
test('resize callbacks defer backing-store writes and identical dimensions do nothing',()=>{
  const view=viewer(),ops=[];
  view.stage={getBoundingClientRect:()=>({width:480,height:300})};
  view.canvas={
    width:0,height:0,
    getBoundingClientRect:()=>({width:480,height:300})
  };
  view.ctx={setTransform:(...x)=>ops.push(x)};
  view.scheduleResize();view.scheduleResize();
  assert.equal(frames.length>0,true);
  const last=frames.at(-1);
  assert.equal(view.resizeFrame,frames.length);
  assert.equal(ops.length,0,'observer callback should not resize synchronously');
  last();
  assert.equal(ops.length,1);
  assert.equal(view.canvas.width,960);
  assert.equal(view.canvas.height,600);
  view.resize();
  assert.equal(ops.length,1,'identical dimensions cannot create a resize loop');
  view.opened=false;
  view.scheduleResize();
  assert.equal(ops.length,1);
});
test('avatars never paint the legacy round player token',()=>{
  const painter=read('public/cultivation/dungeon-map-painter.js');
  assert.match(painter,/if\(!painted\)\{[\s\S]*ctx\.moveTo\(sx,sy-radius\*1\.5\)/);
  assert.doesNotMatch(painter,/marker\(map\.spawn/);
  assert.doesNotMatch(painter,/ctx\.arc\(sx,sy,radius\+3/);
  assert.match(source,/new ResizeObserver\(\(\)=>this\.scheduleResize\(\)\)/);
  assert.match(source,/if\(width===this\.width&&height===this\.height/);
  assert.match(source,/this\.queuedSkill=\{skillId,target/);
});
