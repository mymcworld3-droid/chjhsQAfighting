'use strict';
// Internal repository only. No HTTP read/write endpoints are registered in stage 2.
// All private access is bound to a freshly verified identity, not request body UID.
const crypto=require('node:crypto');
const C=require('./adaptive-learning-engine-beta-contract.cjs');
const {D1Store}=require('./d1-store.cjs');
const PREFIX='adaptiveEngineBeta';
const privateKinds=new Set(['scope','job','queue','attempt','mastery','report']);
const sharedKinds=new Set(['edition','section','concept','source','reference','question','review']);
const fail=(status,msg)=>{throw Object.assign(Error(msg),{status,code:status===403?'permission-denied':status===409?'conflict':'invalid-argument'});};
const digest=(...values)=>crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
const collection=kind=>PREFIX+'V1_'+kind;
const key=(kind,v)=>kind==='scope'?v.scopeId:kind==='question'?v.questionId:kind==='source'?v.sourceId:v.id;
const isBetaPath=path=>typeof path==='string'&&path.split('/')[0].startsWith(PREFIX);
const PRIVATE_COLLECTIONS=Object.freeze([...privateKinds,'scopeHead'].map(collection));
function requireD1(db){if(!(db instanceof D1Store)||db.role!=='A')fail(403,'Beta persistence requires server-only D1 A');}
const fenceRef=(db,owner)=>db.collection(collection('deletionFence')).doc(digest('delete',owner));
function createStore({db,verify,testFixture=false}){
  if(!db||typeof verify!=='function')throw Error('Beta store requires server database and verifier');
  if(testFixture!==true)requireD1(db);
  // Only the isolated in-memory transaction fixture opts in; never pass this from an API.
  const doc=(kind,owner,id)=>db.collection(collection(kind)).doc(digest(owner,id));
  const scopeHead=(owner,id)=>doc('scopeHead',owner,id);
  const read=(snap)=>snap.exists?snap.data():null;
  function requireKind(set,kind,id){if(!set.has(kind)||!C.isId(id))fail(400,'Invalid Beta record key');}
  async function requirePlayer(tx,owner){
    const player=await tx.get(db.collection('users').doc(owner));
    if(!player.exists)fail(403,'Player unavailable');
    if((await tx.get(fenceRef(db,owner))).exists)fail(403,'Beta data deletion in progress');
  }
  function checked(kind,snapshot,owner,id){
    const data=read(snapshot);if(!data)return null;
    const value=C.validate(kind,data);
    if((owner!==null&&value.ownerId!==owner)||key(kind,value)!==id)fail(403,'Beta record identity mismatch');
    return value;
  }
  async function forRequest(req){
    const owner=await verify(req);
    if(!C.isUid(owner))fail(403,'Invalid identity');
    async function reverify(){if(await verify(req)!==owner)fail(403,'Beta identity changed');}
    // These methods are for trusted server code only, not raw client payloads.
    return Object.freeze({
      async read(kind,id){
        await reverify();
        requireKind(privateKinds,kind,id);
        return db.runTransaction(async tx=>{
          await requirePlayer(tx,owner);
          if(kind==='scope'){
            const head=read(await tx.get(scopeHead(owner,id)));if(!head)return null;
            if(head.ownerId!==owner||head.scopeId!==id||head.schemaVersion!==C.VERSION||!Number.isSafeInteger(head.revision)||head.revision<1)fail(403,'Invalid scope head');
            const value=checked(kind,await tx.get(doc(kind,owner,id+':'+head.revision)),owner,id);
            if(!value||value.revision!==head.revision)fail(409,'Invalid scope revision');
            return value;
          }
          return checked(kind,await tx.get(doc(kind,owner,id)),owner,id);
        });
      },
      async append(kind,input){
        await reverify();
        if(!privateKinds.has(kind))fail(403,'Not a private record');
        if(input?.ownerId!==owner)fail(403,'Owner mismatch');
        const value=C.validate(kind,input),id=key(kind,value);
        return db.runTransaction(async tx=>{
          await requirePlayer(tx,owner);
          if(kind==='scope'){
            const headRef=scopeHead(owner,id),head=read(await tx.get(headRef));
            if(head&&(head.ownerId!==owner||head.scopeId!==id||head.schemaVersion!==C.VERSION||!Number.isSafeInteger(head.revision)||head.revision<1))fail(403,'Invalid scope head');
            if(value.revision!==(head?.revision??0)+1)fail(409,'Stale scope revision');
            const ref=doc(kind,owner,id+':'+value.revision);
            if((await tx.get(ref)).exists)fail(409,'Immutable scope revision');
            tx.set(ref,value);tx.set(headRef,{schemaVersion:C.VERSION,ownerId:owner,scopeId:id,revision:value.revision});return value;
          }
          // Operational queue/attempt writes will require the real quality gate
          // and atomic delivery protocol in later stages. Never expose them now.
          if(kind!=='job'||value.state!=='queued')fail(409,'Beta operation not implemented');
          const head=read(await tx.get(scopeHead(owner,value.scopeId)));
          if(!head||head.ownerId!==owner||head.scopeId!==value.scopeId||head.revision!==value.scopeRevision||head.schemaVersion!==C.VERSION)fail(409,'Stale scope revision');
          const scope=checked('scope',await tx.get(doc('scope',owner,value.scopeId+':'+value.scopeRevision)),owner,value.scopeId);
          if(!scope||scope.resolutionStatus==='draft'||!value.conceptIds.every(x=>scope.confirmedConceptIds.includes(x))||!scope.assessmentModes.includes(value.assessmentMode))fail(409,'Job outside confirmed scope');
          const ref=doc(kind,owner,id);
          if((await tx.get(ref)).exists)fail(409,'Immutable record');
          tx.set(ref,value);return value;
        });
      }
    });
  }
  // Shared data are server-only, separate from personal data and the legacy bank.
  // No approval/promotion API exists yet. A shape-valid source is not evidence.
  async function appendCandidate(kind,input){
    if(!sharedKinds.has(kind))fail(403,'Not a shared record');
    const value=C.validate(kind,input),id=key(kind,value);
    if((kind==='question'&&value.validationStatus!=='pending')||(kind==='review'&&value.decision==='passed')||
       (kind==='source'&&value.humanProvenanceStatus==='verified')||(kind==='reference'&&value.qualityStatus==='verified')||
       (['edition','section','concept'].includes(kind)&&value.status==='verified'))fail(409,'Approval requires later verification service');
    return db.runTransaction(async tx=>{
      const ref=doc(kind,null,id+':'+(value.revision??1));
      if((await tx.get(ref)).exists)fail(409,'Immutable shared record');
      tx.set(ref,value);return value;
    });
  }
  return Object.freeze({forRequest,appendCandidate});
}
// Bounded and resumable. The fence is committed before any scan, so a stale
// writer must either precede the fence (and be swept) or fail its transaction.
async function purgeOwnerBatch(db,owner,{pageSize=50}={}){
  requireD1(db);
  if(!C.isUid(owner)||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail(400,'Invalid cleanup request');
  const fence=fenceRef(db,owner);
  await db.runTransaction(async tx=>{
    const prior=await tx.get(fence);
    if(!prior.exists||prior.data()?.complete===true)tx.set(fence,{schemaVersion:C.VERSION,blocked:true,complete:false});
  });
  let removed=0,complete=true;
  for(const name of PRIVATE_COLLECTIONS){
    const count=await db.runTransaction(async tx=>{
      const snap=await tx.get(db.collection(name).where('ownerId','==',owner).limit(pageSize));
      for(const row of snap.docs){
        if(row.data()?.ownerId!==owner)fail(403,'Cleanup owner mismatch');
        tx.delete(row.ref);
      }
      return snap.docs.length;
    });
    removed+=count;
    if(count===pageSize)complete=false;
  }
  if(complete)await db.runTransaction(async tx=>{
    const mark=await tx.get(fence);
    if(!mark.exists||mark.data()?.blocked!==true)fail(409,'Missing deletion fence');
    if(mark.data()?.complete!==true)tx.set(fence,{schemaVersion:C.VERSION,blocked:true,complete:true});
  });
  return {complete,removed};
}
// An existing fence is authoritative even after an interrupted deletion or
// restoration of old private documents. Never allow a backup to resurrect them.
async function ownerDeletionBlocked(db,owner){
  requireD1(db);
  if(!C.isUid(owner))fail(400,'Invalid cleanup identity');
  const snap=await fenceRef(db,owner).get();
  return snap.exists;
}
async function requireCleanupComplete(tx,db,owner){
  requireD1(db);
  if(!C.isUid(owner))fail(400,'Invalid cleanup identity');
  const mark=(await tx.get(fenceRef(db,owner))).data();
  if(mark?.schemaVersion!==C.VERSION||mark.blocked!==true||mark.complete!==true)fail(409,'Complete Beta cleanup before deleting the player');
}
module.exports={createStore,isBetaPath,PREFIX,PRIVATE_COLLECTIONS,purgeOwnerBatch,requireD1,requireCleanupComplete,ownerDeletionBlocked};
