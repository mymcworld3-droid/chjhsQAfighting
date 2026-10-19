'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/d1-db.cjs');
const {D1Store}=require('../d1-store.cjs');
const register=require('../d1-admin-migration-api.cjs');
const {createController,ID,LEASE_MS}=register.__test;
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
function environment(){return {GAME_DATA_BACKEND:'firestore',D1_WORKER_URL:'https://worker.example',D1_SERVICE_TOKEN:'x'.repeat(48)};}
function fixture(seed={}){
  const db=setup(),env=environment(),docs=Object.fromEntries(['A','BD','C'].map(role=>[role,new Map(Object.entries(seed[role]||{}))]));
  const reads=[],lists=[],scheduled=[],stores=Object.fromEntries(['A','BD','C'].map(role=>[role,new D1Store(role,{gateway:db.gateway})]));
  let clock=1800000000000,hook=null;
  const source=role=>{
    const values=docs[role];
    const directChildren=(p,collection)=>{
      const prefix=p?p+'/':'',length=p?p.split('/').length:0,set=new Set();
      for(const key of values.keys())if(key.startsWith(prefix)){
        const parts=key.split('/');
        if(parts.length>length)set.add(parts.slice(0,length+1).join('/'));
      }
      return [...set].sort();
    };
    function ref(p){return {path:p,listCollections:async()=>directChildren(p,false).map(collection),get:async()=>{
      reads.push(role+':'+p);const data=values.has(p)?structuredClone(values.get(p)):null;
      if(hook)await hook(role,p);
      return {ref:ref(p),exists:data!==null,data:()=>data,updateTime:{seconds:10,nanoseconds:123}};
    }};}
    function collection(p){return {path:p,listDocuments:async()=>{lists.push(role+':'+p);return directChildren(p,true).map(ref);},doc:id=>ref(p+'/'+id)};}
    return {app:{options:{projectId:PROJECT_IDS[role]}},auth:{verifyIdToken:async token=>({uid:token,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A})},db:{doc:ref,collection,listCollections:async()=>directChildren('',false).map(collection)}};
  };
  const opts={env,source,target:role=>stores[role],now:()=>clock,logger:{warn(){}},schedule:(fn,ms)=>{scheduled.push({fn,ms});return null;}};
  return {...db,env,docs,reads,lists,scheduled,stores,source,opts,controller:()=>createController(opts),setHook:f=>{hook=f;},advance:ms=>{clock+=ms;},setClock:v=>{clock=v;}};
}
test('admin login migration copies all namespaces, nested and orphan data, then stops re-reading completed jobs',async()=>{
  const f=fixture({A:{'users/alice':{uid:'alice',stats:{gold:8}},'users/alice/answers/a':{q:'private'},'exam_logs/log':{uid:'alice'}},BD:{'friendChats/orphan/messages/m':{text:'secret'}},C:{'rooms/r':{status:'waiting'}}});
  const c=f.controller();await c.start('admin');await c.drain();
  const state=await c.status();assert.equal(state.status,'copied');assert.equal(state.verified,false);assert.equal(state.copied,5);assert.equal(state.missing,1);
  assert.equal((await f.stores.BD.doc('friendChats/orphan/messages/m').get()).data().text,'secret');
  assert.equal((await f.stores.A.doc('users/alice').get()).data().stats.gold,8);
  const count=f.reads.length;await c.start('admin');await c.drain();assert.equal(f.reads.length,count);c.stop();
});
test('two simultaneous administrators share one durable lease and do not duplicate document reads',async()=>{
  const f=fixture({A:{'users/a':{uid:'a'},'users/b':{uid:'b'}}}),a=f.controller(),b=f.controller();
  await Promise.all([a.start('one'),b.start('two')]);await Promise.all([a.drain(),b.drain()]);
  assert.equal(f.reads.length,2);assert.equal((await a.status()).processed,2);assert.equal((await b.status()).status,'copied');a.stop();b.stop();
});
test('quota failure saves checkpoints; restart resumes without re-reading previously copied players',async()=>{
  const f=fixture({A:{'users/a':{uid:'a'},'users/b':{uid:'b'}}});let failed=false;
  f.setHook((_r,p)=>{if(p==='users/b'&&!failed){failed=true;throw Object.assign(Error('quota'),{code:'resource-exhausted'});}});
  let c=f.controller();await c.start('admin');await c.drain();
  const state=await c.status();assert.equal(state.status,'paused');assert.equal(state.processed,1);assert.equal(state.errorCode,'resource-exhausted');
  assert.ok(state.retryAfterMs>1800000000000);c.stop();f.setClock(state.retryAfterMs+1);
  c=f.controller();await c.resume();await c.drain();assert.equal((await c.status()).status,'copied');
  assert.equal(f.reads.filter(p=>p==='A:users/a').length,1);assert.equal(f.reads.filter(p=>p==='A:users/b').length,2);c.stop();
});
test('existing different D1 player data blocks migration instead of overwriting it',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}});await f.stores.A.doc('users/a').set({gold:999});
  const c=f.controller();await c.start('admin');await c.drain();assert.equal((await c.status()).status,'blocked');
  assert.equal((await f.stores.A.doc('users/a').get()).data().gold,999);assert.equal(f.docs.A.get('users/a').gold,1);c.stop();
});
test('final frozen pass reconciles online changes and source deletions, verifies exact target set, never changes provider',async()=>{
  const f=fixture({A:{'users/a':{gold:1},'users/b':{gold:2}}});const c=f.controller();await c.start('admin');await c.drain();
  f.docs.A.set('users/a',{gold:50});f.docs.A.delete('users/b');f.docs.A.set('users/new',{gold:3});
  f.env.GAME_DATA_MAINTENANCE='1';f.env.D1_SOURCE_WRITES_FROZEN='1';await c.resume();await c.drain();
  const state=await c.status();assert.equal(state.status,'ready');assert.equal(state.verified,true);assert.equal(state.pass,2);
  assert.equal((await f.stores.A.doc('users/a').get()).data().gold,50);assert.equal((await f.stores.A.doc('users/b').get()).exists,false);
  assert.equal((await f.stores.A.doc('users/new').get()).data().gold,3);assert.equal(f.env.GAME_DATA_BACKEND,'firestore');c.stop();
});
test('final pass refuses to overwrite D1 data modified after the background copy',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}}),c=f.controller();await c.start('admin');await c.drain();
  await f.stores.A.doc('users/a').set({gold:100});f.docs.A.set('users/a',{gold:2});
  f.env.GAME_DATA_MAINTENANCE='1';f.env.D1_SOURCE_WRITES_FROZEN='1';await c.resume();await c.drain();
  assert.equal((await c.status()).status,'blocked');assert.equal((await f.stores.A.doc('users/a').get()).data().gold,100);c.stop();
});
test('a fresh job can perform final verification directly when all source writes were already frozen',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}});f.env.GAME_DATA_MAINTENANCE='1';f.env.D1_SOURCE_WRITES_FROZEN='1';
  const c=f.controller();await c.start('admin');await c.drain();assert.equal((await c.status()).status,'ready');assert.equal((await c.status()).pass,1);c.stop();
});
test('unknown extra D1 documents prevent a false final verification success',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}});await f.stores.A.doc('users/extra').set({gold:7});
  f.env.GAME_DATA_MAINTENANCE='1';f.env.D1_SOURCE_WRITES_FROZEN='1';const c=f.controller();await c.start('admin');await c.drain();
  assert.equal((await c.status()).status,'blocked');assert.equal((await c.status()).verified,false);c.stop();
});
test('switching to D1 disables imports and startup never creates a job without an administrator login',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}}),c=f.controller();await c.resume();assert.equal(f.sql.prepare('SELECT count(*) AS n FROM d1_admin_migration_jobs').get().n,0);
  f.env.GAME_DATA_BACKEND='d1';assert.equal((await c.start('admin')).status,'active');assert.equal(f.reads.length,0);c.stop();
});
test('an expired old worker cannot commit data or overwrite the successor job state',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}});let release,entered;
  const enteredPromise=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;});let once=false;
  f.setHook(async()=>{if(!once){once=true;entered();await wait;}});
  const old=f.controller();await old.start('admin');await enteredPromise;f.advance(LEASE_MS+1);f.docs.A.set('users/a',{gold:2});
  const next=f.controller();await next.resume();await next.drain();release();await old.drain();
  assert.equal((await f.stores.A.doc('users/a').get()).data().gold,2);assert.equal((await next.status()).status,'copied');assert.equal((await next.status()).processed,1);old.stop();next.stop();
});
test('endpoint verifies revoked tokens, main-project audience and authoritative administrator role before starting',async()=>{
  const f=fixture({A:{'users/admin':{isAdmin:true},'users/player':{isAdmin:false}}});let handler;
  const c=register({post:(_p,fn)=>{handler=fn;}},f.opts);
  function res(){return {code:200,set(){return this;},status(v){this.code=v;return this;},json(v){this.value=v;return this;}};}
  let r=res();await handler({get:()=>'',body:{isAdmin:true}},r);assert.equal(r.code,401);
  r=res();await handler({get:()=>'Bearer player',body:{isAdmin:true,uid:'admin',action:'start'}},r);assert.equal(r.code,403);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM d1_admin_migration_jobs').get().n,0);
  r=res();await handler({get:()=>'Bearer admin',body:{action:'start',namespace:'bad',destination:'attacker'}},r);assert.equal(r.code,200);
  await c.drain();assert.equal((await c.status()).status,'copied');assert.equal(r.value.ok,true);c.stop();
});
test('administrator identity rejects revoked tokens and wrong audience before accessing any profile',async()=>{
  const {verifiedAdmin}=register.__test;
  const req={get:()=>'Bearer admin'};
  for(const verify of [async()=>{throw Error('revoked');},async()=>({uid:'admin',aud:'another-project',iss:'wrong'})]){
    await assert.rejects(verifiedAdmin(req,()=>({auth:{verifyIdToken:verify},db:{collection(){throw Error('profile must not be read');}}})),e=>e.status===401);
  }
});
test('final reconciliation preserves a newer D1 deletion instead of recreating that player',async()=>{
  const f=fixture({A:{'users/a':{gold:1}}}),c=f.controller();await c.start('admin');await c.drain();
  await f.stores.A.doc('users/a').delete();f.env.GAME_DATA_MAINTENANCE='1';f.env.D1_SOURCE_WRITES_FROZEN='1';
  await c.resume();await c.drain();assert.equal((await c.status()).status,'blocked');assert.equal((await f.stores.A.doc('users/a').get()).exists,false);c.stop();
});
test('an ambiguous response after a committed copy resumes from its atomic checkpoint',async()=>{
  const f=fixture({A:{'users/a':{gold:1},'users/b':{gold:2}}});let failed=false;
  const original=f.stores.A.gateway;f.stores.A.gateway=async statements=>{
    const result=await original(statements);
    if(!failed&&statements.some(s=>s.sql.includes('INSERT INTO d1_admin_migration_documents'))){failed=true;throw Object.assign(Error('connection lost after commit'),{code:'unavailable'});}
    return result;
  };
  let c=f.controller();await c.start('admin');await c.drain();const paused=await c.status();assert.equal(paused.status,'paused');assert.equal(paused.processed,1);c.stop();
  f.setClock(paused.retryAfterMs+1);c=f.controller();await c.resume();await c.drain();assert.equal((await c.status()).processed,2);assert.equal(f.reads.filter(p=>p==='A:users/a').length,1);c.stop();
});
