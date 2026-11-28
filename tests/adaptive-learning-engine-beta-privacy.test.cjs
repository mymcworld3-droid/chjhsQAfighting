'use strict';
// All identity, question and database rows are synthetic; never production data.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setup}=require('./helpers/d1-db.cjs');
const {createStore,purgeOwnerBatch,PRIVATE_COLLECTIONS,requireD1}=require('../adaptive-learning-engine-beta-store.cjs');
const P=require('../adaptive-learning-engine-beta-privacy.cjs');
const {rows,hash}=require('../scripts/migrate-firestore-to-d1.cjs');
const env={GAME_DATA_BACKEND:'d1',ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'1',ADAPTIVE_LEARNING_ENGINE_BETA:'1',NODE_ENV:'test',D1_WORKER_URL:'https://example.invalid',D1_SERVICE_TOKEN:'x'.repeat(32)};
const scope=(ownerId,revision=1)=>({schemaVersion:1,createdAt:1,ownerId,scopeId:'scope1',revision,confirmedConceptIds:['c1'],conceptVersions:[{conceptId:'c1',revision:1}],assessmentModes:['application'],personalExclusions:[],editionIds:['ed1'],resolutionStatus:'confirmed',rawInput:'fixture',locale:'zh-TW'});
const verify=async req=>req.uid;
const makeReq=(uid,body={})=>({uid,body});
function response(){return {code:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
async function call(options,request){const res=response();await P.createCleanupHandler(options)(request,res);assert.equal(res.headers['Cache-Control'],'private, no-store');return res;}
test('Beta persistence rejects Firestore-shaped stores and other D1 namespaces; disabled and legacy rollback cannot write',()=>{
  const {db,secondary,sql}=setup();
  try{
    assert.throws(()=>requireD1({collection(){}}),e=>e.status===403);
    assert.throws(()=>createStore({db:secondary,verify}),e=>e.status===403);
    assert.throws(()=>P.createProductionStore({env:{...env,GAME_DATA_BACKEND:'firestore'},verify,store:()=>db}),e=>e.status===503);
    assert.throws(()=>P.createProductionStore({env:{...env,ADAPTIVE_LEARNING_ENGINE_BETA:'0'},verify,store:()=>db}),e=>e.status===503);
    assert.throws(()=>P.createProductionStore({env:{...env,NODE_ENV:'production'},verify,store:()=>db}),e=>e.status===503);
    assert.throws(()=>P.createProductionStore({env:{...env,ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'0'},verify,store:()=>db}),e=>e.status===503);
    assert.ok(P.createProductionStore({env,verify,store:()=>db}));
    assert.equal(P.resolveCleanupStore({...env,GAME_DATA_BACKEND:'firestore'},()=>db),db);
    assert.equal(P.resolveCleanupStore({GAME_DATA_BACKEND:'firestore'},()=>assert.fail('never activated')),null);
    assert.equal(P.resolveCleanupStore({...env,GAME_DATA_BACKEND:'firestore',ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'0'},()=>assert.fail('staging credentials are not active')),null);
    assert.throws(()=>P.resolveCleanupStore({GAME_DATA_BACKEND:'firestore',ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'1'},()=>db),e=>e.status===503);
  }finally{sql.close();}
});
test('D1 owner cleanup removes all private kinds and historical revisions, keeps other owners and shared/legacy records, retries safely',async()=>{
  const {db,sql}=setup();
  try{
    const legacy={uid:'u1',gameSettings:{sourceMode:'focused',focusedUnits:[{path:'fixture'}]},stats:{adaptiveLearningV1:{fixture:true},gold:3}};
    await db.doc('users/u1').set(legacy);await db.doc('users/u2').set({uid:'u2'});
    const store=P.createProductionStore({env,verify,store:()=>db});
    const a=await store.forRequest(makeReq('u1')),b=await store.forRequest(makeReq('u2'));
    await a.append('scope',scope('u1'));await a.append('scope',scope('u1',2));await b.append('scope',scope('u2'));
    for(const col of PRIVATE_COLLECTIONS){
      for(let i=0;i<3;i++)await db.doc(col+'/fixture-u1-'+i).set({ownerId:'u1',schemaVersion:1,fixture:true});
      await db.doc(col+'/fixture-u2').set({ownerId:'u2',fixture:true});
    }
    const shared=db.doc('adaptiveEngineBetaV1_question/shared-fixture');await shared.set({fixture:true});
    const first=await purgeOwnerBatch(db,'u1',{pageSize:2});assert.equal(first.complete,false);
    await assert.rejects(a.append('scope',scope('u1',3)),e=>e.status===403);
    await assert.rejects(a.read('scope','scope1'),e=>e.status===403);
    assert.equal((await b.read('scope','scope1')).ownerId,'u2');
    let complete=false;for(let i=0;i<10&&!complete;i++)complete=(await purgeOwnerBatch(db,'u1',{pageSize:2})).complete;
    assert.equal(complete,true);
    for(const col of PRIVATE_COLLECTIONS){
      assert.equal((await db.collection(col).where('ownerId','==','u1').get()).size,0);
      assert.ok((await db.doc(col+'/fixture-u2').get()).exists);
    }
    assert.deepEqual(await purgeOwnerBatch(db,'u1',{pageSize:2}),{complete:true,removed:0});
    assert.equal((await shared.get()).data().fixture,true);
    assert.deepEqual((await db.doc('users/u1').get()).data(),legacy);
    await db.doc('users/u1').update({'stats.gold':4});
    assert.equal((await db.doc('users/u1').get()).data().stats.gold,4);
    // Recreating a canonical player document cannot clear the separate fence.
    await db.doc('users/u1').delete();await db.doc('users/u1').set({uid:'u1'});
    await assert.rejects(a.append('scope',scope('u1')),e=>e.status===403);
    const fences=await db.collection('adaptiveEngineBetaV1_deletionFence').get();
    assert.equal(fences.size,1);assert.deepEqual(fences.docs[0].data(),{schemaVersion:1,blocked:true,complete:true});
    assert.match(fences.docs[0].id,/^[a-f0-9]{64}$/);
  }finally{sql.close();}
});
test('cleanup API ignores Beta flag during rollback, rejects supplied owner and fails closed on unavailable storage',async()=>{
  const {db,sql}=setup();
  try{
    const calls=[];const options={env:{...env,GAME_DATA_BACKEND:'firestore',ADAPTIVE_LEARNING_ENGINE_BETA:'0'},verify,store:()=>db,purge:async(d,owner)=>{assert.equal(d,db);calls.push(owner);return {complete:true,removed:1};}};
    const denied=await call(options,makeReq('u1',{ownerId:'u2'}));assert.equal(denied.code,400);assert.deepEqual(calls,[]);
    const anon=await call(options,makeReq(null));assert.equal(anon.code,401);
    const allowed=await call(options,makeReq('u1'));assert.deepEqual(allowed.body,{ok:true,complete:true,storage:'d1'});assert.deepEqual(calls,['u1']);
    const broken=await call({...options,env:{GAME_DATA_BACKEND:'firestore',ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'1'}},makeReq('u1'));assert.equal(broken.code,503);assert.equal(broken.body.complete,false);
    const failure=await call({...options,purge:async()=>{throw Error('private secret');}},makeReq('u1'));assert.equal(failure.code,503);assert.equal(failure.body.complete,false);assert.ok(!JSON.stringify(failure.body).includes('private secret'));
    const inactive=await call({...options,env:{GAME_DATA_BACKEND:'firestore'}},makeReq('u1'));assert.deepEqual(inactive.body,{ok:true,complete:true,storage:'not-configured'});
  }finally{sql.close();}
});
test('cleanup identity rejects invalid project, revoked token, stale linked auth and disabled identity; anonymous guest remains supported',async()=>{
  const now=()=>1_000_000,req={get:()=> 'Bearer fixture-token'};
  const token={uid:'u1',aud:'question-learning',iss:'https://securetoken.google.com/question-learning',auth_time:999,firebase:{sign_in_provider:'google.com'}};
  const user={uid:'u1',providerData:[{providerId:'google.com'}]};
  const resolve=(t=token,u=user)=>()=>({auth:{verifyIdToken:async(_token,revoked)=>{assert.equal(revoked,true);return t;},getUser:async uid=>{assert.equal(uid,'u1');return u;}}});
  assert.equal(await P.verifyDeletionIdentity(req,{now,resolve:resolve()}),'u1');
  await assert.rejects(P.verifyDeletionIdentity(req,{now,resolve:resolve({...token,aud:'other'})}),e=>e.status===401);
  await assert.rejects(P.verifyDeletionIdentity(req,{now,resolve:resolve({...token,auth_time:1})}),e=>e.status===403);
  await assert.rejects(P.verifyDeletionIdentity(req,{now,resolve:resolve(token,{...user,disabled:true})}),e=>e.status===401);
  await assert.rejects(P.verifyDeletionIdentity(req,{now,resolve:()=>({auth:{verifyIdToken:async()=>{throw Error('revoked');}}})}),e=>e.status===401);
  assert.equal(await P.verifyDeletionIdentity(req,{now,resolve:resolve({...token,auth_time:1,firebase:{sign_in_provider:'anonymous'}},{uid:'u1',providerData:[]})}),'u1');
  await assert.rejects(P.verifyDeletionIdentity(req,{now,resolve:resolve({...token,auth_time:1,firebase:{sign_in_provider:'anonymous'}})}),e=>e.status===403);
});
test('legacy snapshot reader refuses reserved Beta data rather than importing untrusted Firestore records',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'beta-legacy-fixture-'));
  try{
    const data={fixture:true};fs.writeFileSync(path.join(directory,'snapshot.ndjson'),JSON.stringify({namespace:'A',path:'adaptiveEngineBetaV1_question/forged',data,sha256:hash(data)})+'\n');
    await assert.rejects(async()=>{for await(const row of rows(directory))assert.fail('reserved row must never be returned');},/Reserved Beta collection/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('D1 canonical account deletion cannot bypass cleanup once Beta persistence is required',async()=>{
  const {db,sql}=setup();const {executeCommit}=require('../d1-browser-api.cjs');
  try{
    await db.doc('users/u1').set({uid:'u1'});await db.doc('users/u2').set({uid:'u2'});
    const target={role:'A',kind:'doc',path:'users/u1'};
    const input={writes:[{type:'delete',target}]};
    const ctx={uid:'u1',decoded:{},admin:false,betaStorageRequired:true};
    await assert.rejects(executeCommit(db,input,ctx),e=>e.status===409);
    assert.ok((await db.doc('users/u1').get()).exists);
    await db.doc('adaptiveEngineBetaV1_job/fixture').set({ownerId:'u1'});
    assert.equal((await purgeOwnerBatch(db,'u1',{pageSize:1})).complete,false);
    await assert.rejects(executeCommit(db,input,ctx),e=>e.status===409);
    assert.equal((await purgeOwnerBatch(db,'u1',{pageSize:1})).complete,true);
    await executeCommit(db,input,ctx);
    assert.equal((await db.doc('users/u1').get()).exists,false);
    assert.ok((await db.doc('users/u2').get()).exists);
  }finally{sql.close();}
});

test('rollback keeps D1 privacy cleanup functional and a racing stale write cannot resurrect personal data',async()=>{
  const {db,sql}=setup();
  try{
    await db.doc('users/u1').set({uid:'u1',stats:{gold:2}});
    await db.doc('users/u2').set({uid:'u2'});
    const store=P.createProductionStore({env,verify,store:()=>db});
    const a=await store.forRequest(makeReq('u1')),b=await store.forRequest(makeReq('u2'));
    await a.append('scope',scope('u1'));await b.append('scope',scope('u2'));
    const rolled={...env,GAME_DATA_BACKEND:'firestore',ADAPTIVE_LEARNING_ENGINE_BETA:'0'};
    assert.throws(()=>P.createProductionStore({env:rolled,verify,store:()=>db}),e=>e.status===503);
    const results=await Promise.allSettled([a.append('scope',scope('u1',2)),call({env:rolled,verify,store:()=>db},makeReq('u1'))]);
    assert.equal(results[1].status,'fulfilled');assert.equal(results[1].value.body.complete,true);
    const second=await call({env:rolled,verify,store:()=>db},makeReq('u1'));assert.equal(second.body.complete,true);
    for(const col of PRIVATE_COLLECTIONS)assert.equal((await db.collection(col).where('ownerId','==','u1').get()).size,0);
    await assert.rejects(a.append('scope',scope('u1',3)),e=>e.status===403);
    assert.equal((await b.read('scope','scope1')).ownerId,'u2');
    assert.equal((await db.doc('users/u1').get()).data().stats.gold,2);
  }finally{sql.close();}
});
