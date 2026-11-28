'use strict';
// Server-owned reconciliation. No public endpoint or user-supplied owner.
const {randomUUID}=require('node:crypto');
const {PRIVATE_COLLECTIONS,purgeOwnerBatch,requireD1,ownerDeletionBlocked}=require('./adaptive-learning-engine-beta-store.cjs');
const {isUid}=require('./adaptive-learning-engine-beta-contract.cjs');
const {adminProject,PROJECT_IDS}=require('./firebase-admin-projects.cjs');
const {getD1Store}=require('./d1-store.cjs');
const STATE='adaptiveEngineBetaV1_lifecycle/reconcile';
const LEASE_MS=10*60*1000,INTERVAL_MS=60*1000;
const active=env=>env.ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED==='1'&&env.ADAPTIVE_LEARNING_ENGINE_LIFECYCLE_ENABLED==='1'&&env.GAME_DATA_MAINTENANCE!=='1';
async function reconcileStep({db,auth,now=Date.now,uuid=randomUUID,pageSize=10,purge=purgeOwnerBatch}){
  requireD1(db);
  if(typeof auth?.getUser!=='function'||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>20)throw Error('Invalid lifecycle configuration');
  const state=db.doc(STATE),lease=uuid();
  const claim=await db.runTransaction(async tx=>{
    const s=(await tx.get(state)).data()||{};
    if(s.leaseUntil>now())return null;
    const index=s.index??0,cursor=s.cursor??'';
    if(!Number.isSafeInteger(index)||index<0||index>=PRIVATE_COLLECTIONS.length||typeof cursor!=='string')throw Error('Invalid lifecycle checkpoint');
    tx.set(state,{schemaVersion:1,index,cursor,lease,leaseUntil:now()+LEASE_MS,lastCompletedAt:s.lastCompletedAt??null});
    return {index,cursor};
  });
  if(!claim)return {busy:true};
  async function checkpoint(index,cursor,finished=false){
    await db.runTransaction(async tx=>{
      const s=(await tx.get(state)).data();
      if(s?.lease!==lease||s.leaseUntil<=now())throw Error('Lifecycle lease expired');
      tx.set(state,{schemaVersion:1,index,cursor,lease:'',leaseUntil:0,lastCompletedAt:finished?now():s.lastCompletedAt??null});
    });
  }
  try{
    let q=db.collection(PRIVATE_COLLECTIONS[claim.index]).orderBy('__name__').limit(pageSize);
    if(claim.cursor)q=q.startAfter(claim.cursor);
    const page=await q.get(),seen=new Set();
    let removed=0;
    for(const row of page.docs){
      const owner=row.data()?.ownerId;
      if(!isUid(owner))throw Error('Malformed private owner; audit required');
      if(seen.has(owner))continue;seen.add(owner);
      let absent=await ownerDeletionBlocked(db,owner);
      if(!absent){
        try{const user=await auth.getUser(owner);if(user?.uid!==owner)throw Error('Auth identity mismatch');}
        catch(e){if(e?.code!=='auth/user-not-found')throw e;absent=true;}
      }
      // Disabled users, network failures and quota errors are not account deletion.
      if(absent){
        const current=(await state.get()).data();
        if(current?.lease!==lease||current.leaseUntil<=now())throw Error('Lifecycle lease expired');
        const result=await purge(db,owner);removed+=result.removed;
      }
    }
    const end=page.size<pageSize,next=end?(claim.index+1)%PRIVATE_COLLECTIONS.length:claim.index;
    await checkpoint(next,end?'':page.docs.at(-1).id,end&&next===0);
    return {busy:false,scanned:page.size,removed,cycleComplete:end&&next===0};
  }catch(e){
    // Keep the last committed cursor on error. Never log raw UID or source data.
    await db.runTransaction(async tx=>{
      const s=(await tx.get(state)).data();
      if(s?.lease===lease)tx.set(state,{...s,lease:'',leaseUntil:0});
    }).catch(()=>{});
    throw e;
  }
}
function startLifecycle({env=process.env,resolve=()=>adminProject('A',{env:{...env,GAME_DATA_BACKEND:'firestore'}}),store=getD1Store,logger=console,schedule=setInterval}={}){
  if(!active(env))return null;
  let running=false;
  const tick=async()=>{
    if(running||!active(env))return;
    running=true;
    try{
      const project=resolve();
      if(project.app?.options?.projectId!==PROJECT_IDS.A)throw Error('Wrong Auth project');
      await reconcileStep({db:store('A',env),auth:project.auth});
    }catch(_){logger.warn('[Adaptive Beta lifecycle] reconciliation unavailable; checkpoint retained');}
    finally{running=false;}
  };
  const timer=schedule(()=>void tick(),INTERVAL_MS);timer?.unref?.();
  void tick();
  return timer;
}
module.exports={reconcileStep,startLifecycle,active,STATE,LEASE_MS,INTERVAL_MS};
