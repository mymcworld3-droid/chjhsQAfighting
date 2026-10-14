'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Pity=require('../public/cultivation/golden-core-pity.js');
const training=fs.readFileSync(require.resolve('../public/cultivation/cultivation-training-v4.js'),'utf8');
const types=['ocean','taichu','ningxin','pojing','xingchen','wugou','thunder','reverse','sword'];
test('every fifth wash restricts grades to one through three and keeps all nine types available',()=>{
 for(let n=0;n<20;n++) for(let i=0;i<100;i++) {
  const draw=Pity.draw(n,i/100,i/100,types,100);
  assert.equal(draw.count,n+1);assert.equal(draw.guaranteed,(n+1)%5===0);
  if(draw.guaranteed)assert.ok(draw.core.grade<=3);
  assert.ok(types.includes(draw.core.type));
 }
 assert.equal(Pity.draw(0,0,0,types,100).core.grade,9);
 assert.equal(Pity.draw(4,0,0,types,100).core.grade,3);
 assert.equal(Pity.remaining(4),1);assert.equal(Pity.remaining(5),5);
});
let runtimeClock=100;
function runtime({remote,lostResponse=false,fail=false,retry=false}={}) {
 remote ||= {stats:{gold:1000,totalScore:28},cultivationTraining:{core:{type:'taichu',grade:9},equippedCore:{type:'sword',grade:2},equipped:true,coreEnabled:true,counters:{correct:7}}};
 const local=structuredClone(remote),writes=[],storage=new Map(),messages=[];let clock=(runtimeClock+=100),uid='u',lost=lostResponse;
 const context=vm.createContext({Pity,WASH_FIELD:'goldenCoreWashV1',WASH_COST:100,GOLDEN_CORE_SCORE:28,REMOTE_FIELD:'cultivationTraining',
  CORE_TYPES:types.map(id=>({id})),busy:false,state:structuredClone(local.cultivationTraining),Date:{now:()=>++clock},Math:Object.assign(Object.create(Math),{random:()=>0}),
  isUnlocked:()=>true,getAuth:()=>({currentUser:{uid}}),getApp:()=>({}),getFirestore:()=>({}),doc:()=>({}),
  localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  window:{getCurrentUserData:()=>local,dispatchEvent(){}},CustomEvent:class{},migrate:x=>structuredClone(x),
  saveLocal(){},renderTrainingPage(){},restoreRemoteTraining(){},coreType:()=>({}),toast:x=>messages.push(x),console:{error(){}},
  createGoldenCoreWashAnimation:()=>({minimumDuration:Promise.resolve(),reveal:async()=>{},fail:async()=>{},cleanup(){}}),
  runTransaction:async(_,worker)=>{
   let staged;
   const run=async()=>{staged=[];return worker({get:async()=>({exists:()=>true,data:()=>structuredClone(remote)}),update:(_,v)=>staged.push(v)});};
   if(retry)await run();const result=await run();if(fail)throw Error('offline');
   for(const patch of staged){writes.push(patch);for(const [k,v]of Object.entries(patch)){const path=k.split('.');let o=remote;for(const part of path.slice(0,-1))o=o[part]||={};o[path.at(-1)]=structuredClone(v);}}
   if(lost){lost=false;throw Error('response lost');}return result;
  }});
 const start=training.indexOf('  async function washCore()'),end=training.indexOf('  async function equipCore()',start);
 vm.runInContext(training.slice(start,end)+'\nthis.wash=washCore;',context);
 return {context,local,remote,writes,storage,messages};
}
test('successful washes atomically deduct gold, persist pity across reloads, and preserve equipped core',async()=>{
 const h=runtime({retry:true});for(let i=0;i<4;i++)await h.context.wash();
 assert.equal(h.remote.goldenCoreWashV1.count,4);assert.equal(h.remote.stats.gold,600);
 const reloaded=runtime({remote:h.remote});await reloaded.context.wash();
 assert.equal(reloaded.remote.goldenCoreWashV1.count,5);assert.equal(reloaded.remote.cultivationTraining.core.grade,3);
 assert.equal(reloaded.remote.cultivationTraining.equippedCore.type,'sword');assert.equal(reloaded.remote.cultivationTraining.counters.correct,7);
});
test('lost-response retry confirms the same wash without a second deduction or pity increment',async()=>{
 const h=runtime({lostResponse:true});await h.context.wash();assert.equal(h.remote.stats.gold,900);assert.equal(h.local.stats.gold,1000);
 await h.context.wash();assert.equal(h.writes.length,1);assert.equal(h.remote.goldenCoreWashV1.count,1);assert.equal(h.local.stats.gold,900);
});
test('failed commits and stale concurrent tabs do not spend gold or consume pity',async()=>{
 const failed=runtime({fail:true});await failed.context.wash();assert.equal(failed.writes.length,0);assert.equal(failed.remote.stats.gold,1000);
 const first=runtime(),stale=runtime({remote:first.remote});await first.context.wash();await stale.context.wash();
 assert.equal(first.remote.stats.gold,900);assert.equal(stale.writes.length,0);assert.match(stale.messages[0],/其他分頁/);
});
