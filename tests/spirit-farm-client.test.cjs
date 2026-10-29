'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Rules=require('../public/cultivation/spirit-farm-rules.js');
function fixture(storage=new Map()){
  let uid='u1',fetcher=async()=>({ok:true,json:async()=>({ok:true,farm:Rules.view(Rules.initial(1000),1000,'2026-10-29'),materialInventory:{}})}),failStorage=false;
  const nodes={ 'farm-body':{innerHTML:'',querySelectorAll:()=>[],setAttribute(){},classList:{remove(){},add(){}}},'farm-refresh':{disabled:false}},events={},calls=[],player={uid:'u1',stats:{gold:10},materialSystem:{inventory:{}}};
  const window={getCurrentUserData:()=>player,dispatchEvent(){},addEventListener:(name,fn)=>events[name]=fn};
  const document={readyState:'loading',getElementById:id=>nodes[id],querySelector:()=>null,addEventListener(){}};
  const context={window,document,QASpiritFarmRules:Rules,getMainUser:()=>uid?{uid}:null,authenticatedMainFetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init);},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('quota');storage.set(key,value);},removeItem:key=>{if(failStorage)throw Error('blocked');storage.delete(key);}},
    AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),crypto:require('node:crypto').webcrypto,Date,console};
  const source=fs.readFileSync('public/cultivation/spirit-farm.js','utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source+'\nglobalThis.farmTest={send,refresh,act,pending,storePending,align,get state(){return {snapshot,account,busy,notice,failed};}};',context);
  return {api:context.farmTest,nodes,events,calls,storage,player,set uid(v){uid=v;},set fetcher(v){fetcher=v;},set failStorage(v){failStorage=v;}};
}
const body={action:'plant',requestId:'test-farm-request-001',expectedRevision:0,index:0,cropId:'jade'};
const response=(status=200,payload={})=>({ok:status<400,status,json:async()=>payload});
const good=()=>({ok:true,farm:Rules.view(Rules.initial(1000),1000,'2026-10-29'),materialInventory:{'qi-spirit-wood':1},result:{message:'已完成'}});
test('uncertain writes persist the original operation, block replacement and replay it after reload',async()=>{
  const f=fixture();f.fetcher=async()=>{throw Error('offline');};await f.api.send(body);assert.equal(f.api.pending().requestId,body.requestId);assert.match(f.api.state.notice,/offline/);
  const before=f.calls.length;f.api.act('plant');assert.equal(f.calls.length,before);
  const reload=fixture(f.storage);reload.fetcher=async()=>response(200,good());await reload.api.refresh();assert.equal(JSON.parse(reload.calls[0].init.body).requestId,body.requestId);assert.equal(reload.api.pending(),null);assert.equal(reload.player.materialSystem.inventory['qi-spirit-wood'],1);assert.equal(reload.player.stats.gold,10);
});
test('503 retains a pending command, definitive validation errors clear it, and conflict refresh never invents a replacement command',async()=>{
  const f=fixture();f.fetcher=async()=>response(503,{ok:false,error:'暫時無法確認'});await f.api.send(body);assert(f.api.pending());
  f.fetcher=async()=>response(400,{ok:false,error:'種子無效'});await f.api.refresh();assert.equal(f.api.pending(),null);
  f.fetcher=async(_url,init)=>init.method==='POST'?response(409,{ok:false,error:'靈田已更新'}):response(200,good());await f.api.send(body);
  assert.equal(f.calls.at(-1).init.method,'GET');assert.equal(f.calls.filter(x=>x.init.method==='POST').length,3);assert.equal(f.api.pending(),null);assert(f.api.state.snapshot);
});
test('late responses cannot display another account garden or apply its inventory',async()=>{
  const f=fixture();let resolve;f.fetcher=()=>new Promise(r=>resolve=r);const job=f.api.send();f.uid='u2';f.api.align();resolve(response(200,good()));await job;
  assert.equal(f.api.state.account,'u2');assert.equal(f.api.state.snapshot,null);assert.deepEqual(f.player.materialSystem.inventory,{});
});
test('failed initial load has a readable error and usable refresh instead of an endless loading message',async()=>{
  const f=fixture();f.fetcher=async()=>{throw Error('目前離線，請重試');};await f.api.send();assert.match(f.nodes['farm-body'].innerHTML,/目前離線/);assert.equal(f.nodes['farm-refresh'].disabled,false);
});
test('blocked browser storage cannot resurrect a completed command from a stale disk value',async()=>{
  const f=fixture();await f.api.send(body);f.api.storePending('u1',body);f.failStorage=true;f.fetcher=async()=>response(200,good());await f.api.refresh();assert.equal(f.api.pending(),null);
});
test('all farm controls are native buttons, the entrance targets the actual training map, and timers stop off-page',()=>{
  const source=fs.readFileSync('public/cultivation/spirit-farm.js','utf8');assert.match(source,/querySelector\('#page-training \.training-map'\)/);assert.match(source,/clearInterval\(timer\)/);assert.match(source,/if\(!visible\(\)\|\|document\.hidden/);assert.match(source,/aria-live="polite"/);assert.match(source,/getMainUser\(\)\?\.uid!==uid\|\|account!==uid\|\|request!==serial/);
  assert(!source.includes('innerHTML=payload.result.message'));assert.match(fs.readFileSync('public/styles/spirit-farm.css','utf8'),/prefers-reduced-motion/);
});
