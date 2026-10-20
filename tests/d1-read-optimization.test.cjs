'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {D1Store,Transaction}=require('../d1-store.cjs');
const {ReadBatcher}=require('../d1-read-batcher.cjs');
const {setup}=require('./helpers/d1-db.cjs');
function fixture(){
  const {gateway,sql}=setup(),calls=[];
  const db=new D1Store('A',{gateway:async statements=>{calls.push(statements);return gateway(statements);},pollMs:60000});
  return {db,calls,sql,gateway};
}
async function settled(db){
  for(let i=0;i<1000;i++){
    if(![...db.watchers.values()].some(w=>w.running))return;
    await new Promise(resolve=>setTimeout(resolve,1));
  }
  throw Error('watchers did not settle');
}
test('20 concurrent document reads use one Worker request; duplicate reads share SQL and snapshots stay isolated',async()=>{
  const {db,calls}=fixture();
  const refs=Array.from({length:20},(_,i)=>db.doc('users/'+i));
  const rows=await db.getAll(...refs,refs[0]);
  assert.equal(calls.length,1);assert.equal(calls[0].length,20);assert.equal(rows.length,21);
  assert.notEqual(rows[0],rows[20]);assert.ok(rows.every(row=>!row.exists));
});
test('reads split below the Free plan SQL limit; a 400-document write needs 11 requests',async()=>{
  const {db,calls}=fixture();
  const batch=db.batch();for(let i=0;i<400;i++)batch.set(db.doc('bulk/'+i),{n:i});
  await batch.commit();assert.equal(calls.length,11);assert.ok(calls.every(batch=>batch.length<=40));
  assert.equal((await db.doc('bulk/399').get()).data().n,399);
});
test('writes refresh only the exact document and its parent collection; idle queries only check revision',async()=>{
  const {db,calls}=fixture();const values=[];
  const stops=[db.doc('users/u').onSnapshot(s=>values.push(s.data()?.n)),db.doc('rooms/r').onSnapshot(()=>{}),db.collection('users').onSnapshot(()=>{})];
  await settled(db);calls.length=0;
  const queryWatcher=[...db.watchers.values()].find(w=>w.ref.path==='users');
  await queryWatcher.tick();assert.equal(calls.length,1);assert.match(calls[0][0].sql,/collection_versions/);
  calls.length=0;await db.doc('users/u').set({n:1});await settled(db);
  assert.deepEqual(values,[undefined,1]);
  assert.ok(!calls.flat().some(s=>s.params?.includes('rooms/r')));
  calls.length=0;await Promise.all([...db.watchers.values()].map(w=>w.tick()));
  assert.equal(calls.length,1); // two document polls plus one revision poll, one HTTP request
  stops.forEach(stop=>stop());
});
test('external writes are still discovered on the normal poll, including deletion',async()=>{
  const {db,gateway}=fixture();const peer=new D1Store('A',{gateway});const sizes=[];
  const stop=db.collection('rooms').onSnapshot(s=>sizes.push(s.size));await settled(db);
  await peer.doc('rooms/r').set({status:'waiting'});
  await [...db.watchers.values()][0].tick();
  await peer.doc('rooms/r').delete();await [...db.watchers.values()][0].tick();
  assert.deepEqual(sizes,[0,1,0]);stop();
});
test('a write arriving during an in-flight listener read triggers a follow-up read',async()=>{
  const {db,gateway}=fixture();const values=[];
  const stop=db.doc('rooms/r').onSnapshot(s=>values.push(s.data()?.n));await settled(db);
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});let hold=true;
  db.gateway=async statements=>{
    const results=await gateway(statements);
    if(hold&&statements[0].sql.startsWith('SELECT d.data')){hold=false;entered();await new Promise(resolve=>{release=resolve;});}
    return results;
  };
  const watcher=[...db.watchers.values()][0],pending=watcher.tick();await started;
  await db.doc('rooms/r').set({n:2});release();await pending;
  // Let the dirty follow-up timer run, rather than waiting for the 60-second poll.
  for(let i=0;i<100&&values.at(-1)!==2;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(values.at(-1),2);stop();
});
test('unsubscribe before a queued read cancels the Worker request',async()=>{
  const {db,calls}=fixture();let notified=false;
  const stop=db.doc('rooms/r').onSnapshot(()=>{notified=true;});stop();
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls.length,0);assert.equal(notified,false);
});
test('read sharing ends at dispatch and never supplies stale data after a write',async()=>{
  const {db}=fixture(),ref=db.doc('users/u');
  assert.equal((await ref.get()).exists,false);await ref.set({n:1});
  assert.equal((await ref.get()).data().n,1);await ref.update({n:2});assert.equal((await ref.get()).data().n,2);
  const stale=new Transaction(db);await stale.get(ref);stale.update(ref,{n:3});await ref.update({n:4});
  await assert.rejects(stale.commit(),e=>e.code==='aborted');
});
test('a failed read batch rejects every caller and a later batch can recover',async()=>{
  let fail=true,calls=0;
  const batcher=new ReadBatcher(async statements=>{calls++;if(fail)throw Error('offline');return statements.map(()=>({results:[]}));});
  const reads=[batcher.read({sql:'SELECT 1'}),batcher.read({sql:'SELECT 2'})];
  const results=await Promise.allSettled(reads);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
  fail=false;await batcher.read({sql:'SELECT 1'});assert.equal(calls,2);
  await assert.rejects(batcher.read({sql:'DELETE FROM documents'}),/SELECT only/);
});
test('transaction query revision and rows are read atomically in one Worker request',async()=>{
  const {db,calls}=fixture();const tx=new Transaction(db);
  await tx.get(db.collection('rooms'));assert.equal(calls.length,1);assert.equal(calls[0].length,2);
});

test('browser multi-document commits coalesce prereads and retain authorization',async()=>{
  const {executeCommit}=require('../d1-browser-api.cjs');
  const {db,calls}=fixture();
  await db.doc('users/u').set({isAdmin:true});calls.length=0;
  const writes=Array.from({length:20},(_,i)=>({type:'set',target:{kind:'doc',role:'A',path:'gameConfig/'+i},data:{n:i}}));
  await executeCommit(db,{writes},{uid:'u',admin:true,decoded:{}});
  assert.equal(calls.length,2);assert.equal(calls[0].length,21);
  assert.equal((await db.doc('gameConfig/19').get()).data().n,19);
});

test('production namespaces share a read batch while keeping credentials and data separate',async()=>{
  const {getD1Store}=require('../d1-store.cjs');
  const originalFetch=global.fetch,calls=[];
  global.fetch=async (url,options)=>{
    const batch=JSON.parse(options.body).statements;
    calls.push({url,token:options.headers.Authorization,batch});
    return {ok:true,status:200,json:async()=>({success:true,result:batch.map(s=>({results:[{data:JSON.stringify({namespace:s.params[0]}),version:1}]}))})};
  };
  try{
    const env={D1_WORKER_URL:'https://quota-test.example',D1_SERVICE_TOKEN:'a'.repeat(32)};
    const other={...env,D1_SERVICE_TOKEN:'b'.repeat(32)};
    const results=await Promise.all([
      ...['A','BD','C'].map(role=>getD1Store(role,env).doc('users/shared').get()),
      getD1Store('A',other).doc('users/shared').get()
    ]);
    assert.equal(calls.length,2);assert.deepEqual(calls[0].batch.map(s=>s.params[0]),['A','BD','C']);
    assert.deepEqual(results.map(s=>s.data().namespace),['A','BD','C','A']);
    assert.notEqual(calls[0].token,calls[1].token);
  }finally{global.fetch=originalFetch;}
});
test('staggered healthy listeners converge on a shared deadline without adding delay; failures keep full backoff',()=>{
  const {pollDelay}=require('../d1-store.cjs');
  const starts=[10001,10100,12345,14999];
  const deadlines=starts.map(at=>at+pollDelay(5000,0,false,at));
  assert.deepEqual(deadlines,[15000,15000,15000,15000]);
  starts.forEach(at=>{
    assert.ok(pollDelay(5000,0,false,at)>0&&pollDelay(5000,0,false,at)<=5000);
    assert.equal(pollDelay(5000,1,false,at),10000);
    assert.equal(pollDelay(5000,0,true,at),0);
  });
});
test('browser own-profile reads use one fresh snapshot and foreign reads stay projected',async()=>{
  const {registerD1BrowserApi}=require('../d1-browser-api.cjs');
  const {db,calls}=fixture();
  await db.doc('users/u').set({uid:'u',isAdmin:false,email:'mine'});
  await db.doc('users/peer').set({uid:'peer',displayName:'道友',email:'private'});
  const routes={};registerD1BrowserApi({get(){},post:(path,handler)=>{routes[path]=handler;}},{env:{GAME_DATA_BACKEND:'d1'},store:()=>db,resolve:()=>({auth:{verifyIdToken:async()=>({uid:'u',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}})});
  async function invoke(body){
    const response={statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;}};
    await routes['/api/data']({get:()=>'Bearer token',body},response);return response;
  }
  calls.length=0;
  const own=await invoke({action:'read',target:{role:'A',kind:'doc',path:'users/u'}});
  assert.equal(own.payload.data.email,'mine');assert.equal(calls.length,1);assert.equal(calls[0].length,1);
  calls.length=0;
  const peer=await invoke({action:'read',target:{role:'A',kind:'doc',path:'users/peer'}});
  assert.equal(peer.payload.data.email,undefined);assert.equal(calls.length,1);assert.equal(calls[0].length,2);
  calls.length=0;
  const bad=await invoke({action:'unknown',role:'A'});assert.equal(bad.statusCode,400);assert.equal(calls.length,0);
  const escalation=await invoke({action:'commit',role:'A',writes:[{target:{role:'A',kind:'doc',path:'users/u'},type:'update',data:{isAdmin:true}}]});
  assert.equal(escalation.statusCode,403);assert.equal((await db.doc('users/u').get()).data().isAdmin,false);
});
