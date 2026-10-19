'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {createEntryHandler}=require('../dongtian-entry-api.cjs');
const base={ownerUid:'owner',status:'active',questions:[{id:'q1',q:'題目',correct:'答案',wrong:['甲','乙','丙']}]};
function fixture({cave=base,uid='visitor',previous,readError,counterError}={}) {
  let play=previous&&structuredClone(previous),reads=0,counters=0,writes=0;
  const content={collection:name=>({doc:id=>({id,
    async get(){reads++;if(readError)throw readError;return{exists:!!cave,id,data:()=>structuredClone(cave)};},
    async update(){assert.equal(name,'dongtianIndex');counters++;if(counterError)throw counterError;}
  })})};
  const progress={collection:name=>({doc:id=>({name,id})}),async runTransaction(worker){await worker({
    get:async()=>({exists:!!play}),set(ref,value,options){assert.equal(ref.id,uid+'__cave123');assert.equal(options.merge,true);writes++;play={...play,...value};}
  });}};
  const handler=createEntryHandler({verifyPlayer:async()=>{if(!uid)throw Object.assign(Error('unauthorized'),{status:401});return uid;},
    content:()=>content,progress:()=>progress,fields:{serverTimestamp:()=>123,increment:n=>n},logger:{warn(){}}});
  return{read:()=>reads,counters:()=>counters,writes:()=>writes,play:()=>play,async request(body={}){
    const result={status:200};await handler({body:{dongtianId:'cave123',...body}},
      {set(){},status(code){result.status=code;return this;},json(payload){result.body=payload;return this;}});return result;
  }};
}
test('owner and shared entries read the authoritative cave through the server without visit writes',async()=>{
  for(const uid of ['owner','visitor']){
    const f=fixture({uid}),r=await f.request({owned:uid==='owner'});
    assert.equal(r.status,200);assert.equal(r.body.cave.ownerUid,'owner');assert.equal(r.body.cave.id,'cave123');
    assert.equal(f.read(),1);assert.equal(f.writes(),0);assert.equal(f.counters(),0);
  }
});
test('entry rejects unauthenticated, invalid, nonowned, deleted, sealed, tutorial and empty caves',async()=>{
  for(const [opts,body,status]of [
    [{uid:''},{},401],[{},{dongtianId:'../bad'},400],[{},{action:'delete'},400],[{},{owned:true},403],
    [{cave:null},{},404],[{cave:{...base,status:'suspended'}},{},409],
    [{cave:{...base,tutorialOnly:true}},{},409],[{cave:{...base,questions:[]}},{},409]
  ]){const f=fixture(opts),r=await f.request(body);assert.equal(r.status,status);assert.equal(f.writes(),0);assert.equal(f.counters(),0);}
});
test('server encounters preserve completed learning and reward records across replays',async()=>{
  for(const previous of [undefined,{completed:true,correct:8,learningRewardV2:{goldPaid:270},completedAtMs:12}]){
    const f=fixture({previous});assert.equal((await f.request({action:'encounter'})).status,200);
    assert.equal(f.play().encountered,true);assert.equal(f.play().completed,previous?.completed??false);
    if(previous)for(const key of Object.keys(previous))assert.deepEqual(f.play()[key],previous[key]);
  }
});
test('optional visit counters cannot prevent entry and storage errors retain useful diagnostics',async()=>{
  const f=fixture({counterError:Error('counter denied')});
  assert.equal((await f.request({action:'visit'})).status,200);assert.equal(f.writes(),0);
  const failure=fixture({readError:Object.assign(Error('quota exceeded'),{code:8})});
  const result=await failure.request();assert.equal(result.status,503);assert.equal(result.body.code,'8');
  assert.equal(result.body.phase,'content-read');assert.doesNotMatch(result.body.error,/quota|stack|PRIVATE/);
});

const repoSource=fs.readFileSync(require.resolve('../public/cultivation/data/dongtian-repository.js'),'utf8');
function client(reply) {
  const calls=[],timers=[];let uid='owner';
  const ctx={getMainUser:()=>uid?{uid}:null,AbortController,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    authenticatedMainFetch:async(path,init)=>{calls.push({path,body:JSON.parse(init.body)});return reply(init);}};
  vm.createContext(ctx);vm.runInContext(repoSource.replace(/^import [\s\S]*?;\n/gm,'').replace(/export const /g,'const ')
    +'\nthis.repo=dongtianRepository;',ctx);
  return{repo:ctx.repo,calls,timers,setUid:value=>{uid=value;}};
}
test('browser owner read uses authenticated HTTP and a changed account cannot receive an old response',async()=>{
  const f=client(async()=>({ok:true,json:async()=>({ok:true,cave:{...base,id:'cave123'}})}));
  await f.repo.getData('cave123',{owned:true});
  assert.deepEqual(f.calls,[{path:'/api/dongtian/entry',body:{dongtianId:'cave123',action:'read',owned:true}}]);
  let release;const changed=client(()=>new Promise(resolve=>{release=resolve;}));
  const pending=changed.repo.getData('cave123');changed.setUid('other');
  release({ok:true,json:async()=>({ok:true,cave:base})});await assert.rejects(pending,/登入狀態已改變/);
});
test('browser entry bounds network waits and preserves server error code and phase',async()=>{
  const slow=client(init=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))));
  const pending=slow.repo.getData('cave123');slow.timers[0]();
  await assert.rejects(pending,error=>error.code==='deadline-exceeded');
  const failed=client(async()=>({ok:false,status:503,json:async()=>({ok:false,error:'暫時不可用',code:'resource-exhausted',phase:'content-read'})}));
  await assert.rejects(failed.repo.getData('cave123'),error=>error.code==='resource-exhausted'&&error.phase==='content-read');
});

test('owner cave entry succeeds with browser Firestore unavailable and never caches data after an account switch',async()=>{
  const source=fs.readFileSync(require.resolve('../public/cultivation/dongtian.js'),'utf8');
  const worker=source.slice(source.indexOf('  async function loadOwnedCave('),source.indexOf('  function renderCachedOwnList('));
  let uid='owner',saves=0,reads=0;
  const ctx={uid:()=>uid,dongtianCache:{getFull:()=>null,setFull(){saves++;}},
    getDoc(){throw Error('permission-denied: browser Firestore must not be used');},
    dongtianRepository:{getData:async(id,options)=>{reads++;assert.equal(options.owned,true);return{...base,id};}}};
  vm.createContext(ctx);vm.runInContext(worker+'\nthis.load=loadOwnedCave;',ctx);
  assert.equal((await ctx.load('cave123')).id,'cave123');assert.equal(reads,1);assert.equal(saves,1);
  ctx.dongtianRepository.getData=async()=>{uid='other';return{...base,id:'cave123'};};
  await assert.rejects(ctx.load('cave123'),/登入狀態已改變/);assert.equal(saves,1);
});
