'use strict';
// Internal repository only. No HTTP read/write endpoints are registered in stage 2.
// All private access is bound to a freshly verified identity, not request body UID.
const crypto=require('node:crypto');
const C=require('./adaptive-learning-engine-beta-contract.cjs');
const PREFIX='adaptiveEngineBeta';
const privateKinds=new Set(['scope','job','queue','attempt','mastery','report']);
const sharedKinds=new Set(['edition','section','concept','source','reference','question','review']);
const fail=(status,msg)=>{throw Object.assign(Error(msg),{status,code:status===403?'permission-denied':status===409?'conflict':'invalid-argument'});};
const digest=(...values)=>crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
const collection=kind=>PREFIX+'V1_'+kind;
const key=(kind,v)=>kind==='scope'?v.scopeId:kind==='question'?v.questionId:kind==='source'?v.sourceId:v.id;
const isBetaPath=path=>typeof path==='string'&&path.split('/')[0].startsWith(PREFIX);
function createStore({db,verify}){
  if(!db||typeof verify!=='function')throw Error('Beta store requires server database and verifier');
  const doc=(kind,owner,id)=>db.collection(collection(kind)).doc(digest(owner,id));
  const scopeHead=(owner,id)=>doc('scopeHead',owner,id);
  const read=(snap)=>snap.exists?snap.data():null;
  function requireKind(set,kind,id){if(!set.has(kind)||!C.isId(id))fail(400,'Invalid Beta record key');}
  async function requirePlayer(tx,owner){
    const player=await tx.get(db.collection('users').doc(owner));
    if(!player.exists)fail(403,'Player unavailable');
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
    // These methods are for trusted server code only, not raw client payloads.
    return Object.freeze({
      async read(kind,id){
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
module.exports={createStore,isBetaPath,PREFIX};
