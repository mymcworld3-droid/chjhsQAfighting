'use strict';
// Synthetic D1/SQLite tests. No production Auth or player data.
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/d1-db.cjs');
const L=require('../adaptive-learning-engine-beta-lifecycle.cjs');
const S=require('../adaptive-learning-engine-beta-store.cjs');
const absent=()=>Object.assign(Error('fixture absent'),{code:'auth/user-not-found'});
const outage=()=>Object.assign(Error('fixture outage'),{code:'auth/internal-error'});
const fixtures=async db=>{
  for(const col of S.PRIVATE_COLLECTIONS){
    for(const ownerId of ['gone','live','disabled'])await db.doc(col+'/'+ownerId).set({ownerId,fixture:true});
  }
  await db.doc('users/live').set({uid:'live',stats:{gold:7}});
  await db.doc('adaptiveEngineBetaV1_question/shared').set({fixture:true});
};
const auth={getUser:async uid=>{if(uid==='gone')throw absent();return {uid,disabled:uid==='disabled'};}};
test('external Auth deletion is reconciled across all personal kinds without touching live or disabled accounts',async()=>{
  const {db,sql}=setup();
  try{
    await fixtures(db);let done=false;
    for(let i=0;i<30&&!done;i++)done=(await L.reconcileStep({db,auth,pageSize:1})).cycleComplete;
    assert.equal(done,true);
    for(const col of S.PRIVATE_COLLECTIONS){
      assert.equal((await db.collection(col).where('ownerId','==','gone').get()).size,0);
      assert.equal((await db.doc(col+'/live').get()).exists,true);
      assert.equal((await db.doc(col+'/disabled').get()).exists,true);
    }
    assert.equal(await S.ownerDeletionBlocked(db,'gone'),true);
    assert.equal((await db.doc('users/live').get()).data().stats.gold,7);
    assert.equal((await db.doc('adaptiveEngineBetaV1_question/shared').get()).exists,true);
    assert.ok((await db.doc(L.STATE).get()).data().lastCompletedAt>0);
  }finally{sql.close();}
});
test('Auth outage never purges or advances the persisted cursor, restart retries same page',async()=>{
  const {db,sql}=setup();
  try{
    await db.doc(S.PRIVATE_COLLECTIONS[0]+'/a').set({ownerId:'gone'});
    await assert.rejects(L.reconcileStep({db,auth:{getUser:async()=>{throw outage();}}}),/fixture outage/);
    const state=(await db.doc(L.STATE).get()).data();
    assert.equal(state.index,0);assert.equal(state.cursor,'');assert.equal(state.leaseUntil,0);
    assert.equal(await S.ownerDeletionBlocked(db,'gone'),false);
    assert.equal((await db.doc(S.PRIVATE_COLLECTIONS[0]+'/a').get()).exists,true);
    assert.equal((await L.reconcileStep({db,auth})).removed,1);
    assert.equal(await S.ownerDeletionBlocked(db,'gone'),true);
  }finally{sql.close();}
});
test('durable lease prevents competing instance from scanning; expired lease can resume',async()=>{
  const {db,sql}=setup();
  try{
    await db.doc(L.STATE).set({schemaVersion:1,index:0,cursor:'',lease:'old',leaseUntil:100,lastCompletedAt:null});
    assert.deepEqual(await L.reconcileStep({db,auth:{getUser:()=>assert.fail('lease held')},now:()=>99}),{busy:true});
    const result=await L.reconcileStep({db,auth,now:()=>101});
    assert.equal(result.busy,false);assert.equal((await db.doc(L.STATE).get()).data().index,1);
  }finally{sql.close();}
});
test('restore of pre-deletion private records is swept even if Auth account exists, while fence stays intact',async()=>{
  const {db,sql}=setup();
  try{
    await db.doc('users/live').set({uid:'live'});
    await db.doc(S.PRIVATE_COLLECTIONS[0]+'/old').set({ownerId:'live',fixture:true});
    assert.equal((await S.purgeOwnerBatch(db,'live')).complete,true);
    // Simulate restoring only the old private rows, preserving the newer deletion fence.
    await db.doc(S.PRIVATE_COLLECTIONS[0]+'/old').set({ownerId:'live',fixture:true});
    const store=S.createStore({db,verify:async()=> 'live'}),user=await store.forRequest({});
    await assert.rejects(user.read('scope','anything'),e=>e.status===403);
    const result=await L.reconcileStep({db,auth:{getUser:()=>assert.fail('fence is authoritative')}});
    assert.equal(result.removed,1);
    assert.equal((await db.doc(S.PRIVATE_COLLECTIONS[0]+'/old').get()).exists,false);
    assert.equal(await S.ownerDeletionBlocked(db,'live'),true);
  }finally{sql.close();}
});
test('retained repository handles reverify their identity before private read or append',async()=>{
  const {db,sql}=setup();
  try{
    await db.doc('users/live').set({uid:'live'});let current='live';
    const store=S.createStore({db,verify:async()=>current}),user=await store.forRequest({});
    current='other';
    await assert.rejects(user.read('scope','s1'),e=>e.status===403);
    await assert.rejects(user.append('job',{ownerId:'live'}),e=>e.status===403);
  }finally{sql.close();}
});
test('lifecycle is opt-in, remains active during Beta-off rollback, and respects maintenance',()=>{
  const env={ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'1',ADAPTIVE_LEARNING_ENGINE_LIFECYCLE_ENABLED:'1',ADAPTIVE_LEARNING_ENGINE_BETA:'0',GAME_DATA_BACKEND:'firestore'};
  assert.equal(L.active(env),true);
  assert.equal(L.active({...env,GAME_DATA_MAINTENANCE:'1'}),false);
  assert.equal(L.active({...env,ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED:'0'}),false);
  assert.equal(L.active({...env,ADAPTIVE_LEARNING_ENGINE_LIFECYCLE_ENABLED:'0'}),false);
  assert.equal(L.startLifecycle({env:{},schedule:()=>assert.fail('must not schedule')}),null);
});
