'use strict';
// Only a server-calculated martial-skill killing blow can earn manuscript XP.
// Firebase C owns the kill ledger; Firebase A credits it with an idempotent
// high-water receipt. A crash between databases is recovered by claiming again.
const crypto=require('node:crypto');
const Manuals=require('./public/cultivation/manual-rules.js');
const STAGE=5,REALM=Manuals.realmForStage(STAGE).name;
const RECEIPTS='dungeonManualExpReceipts',MANUALS='tacticalManuals';
const limit=value=>Number.isSafeInteger(value)&&value>=0?
  Math.min(1000000,value):0;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function recordKills(room,outcome,uid,skillId){
  const skill=Manuals.BY_SKILL[skillId],bookId=skill?.manualId;
  if(!bookId||!outcome||outcome.duplicate||
      !Array.isArray(room?.enemies)||!Array.isArray(outcome.enemies))
    return null;
  const remaining=new Set(outcome.enemies.map(enemy=>enemy.id));
  const hitIds=new Set(outcome.result?.hits?.filter(hit=>hit.defeated)
    .map(hit=>hit.enemyId)||[]);
  const killed=room.enemies.filter(enemy=>!remaining.has(enemy.id)&&
    hitIds.has(enemy.id));
  if(!killed.length)return null;
  const exp=killed.length*Manuals.expForBeast(STAGE);
  const prior=room.manualExp?.[uid]?.[bookId]||0;
  const total=limit(prior+exp);
  const ledger={...(room.manualExp||{}),
    [uid]:{...(room.manualExp?.[uid]||{}),[bookId]:total}};
  return {ledger,award:{bookId,bookName:Manuals.BY_BOOK[bookId]?.name||'功法',
    realm:REALM,kills:killed.length,exp:total-limit(prior),
    enemyIds:killed.map(e=>e.id)}};
}
const receiptId=(roomId,session,uid)=>crypto.createHash('sha256')
  .update(['dungeon-manual-exp-v1',roomId,session,uid].join('\n'))
  .digest('hex');
async function claim(db,roomId,room,uid){
  if(room?.mode!=='dungeon'||room.version!==1||
      !/^[A-Za-z0-9_-]{8,160}$/.test(String(roomId||'')))
    throw fail('副本經驗憑證無效',403);
  const totals=room.manualExp?.[uid];
  if(!totals||typeof totals!=='object'||Array.isArray(totals))
    return {credited:{},pending:false};
  const session=room.manualProgressSession||room.assembledAtMs;
  if(!Number.isSafeInteger(session)||session<=0)
    throw fail('副本擊殺紀錄缺少有效場次識別',409);
  const ref=db.collection(RECEIPTS).doc(receiptId(roomId,session,uid));
  const manualRef=db.collection(MANUALS).doc(uid);
  return db.runTransaction(async tx=>{
    const [receiptSnap,manualSnap]=await Promise.all([tx.get(ref),tx.get(manualRef)]);
    const receipt=receiptSnap.exists?receiptSnap.data():null;
    const applied=receipt?.totals||{},manuals=Manuals.normalize(
      manualSnap.exists?manualSnap.data():null);
    const credited={},nextTotals={...applied};
    for(const [bookId,raw] of Object.entries(totals)){
      if(!Manuals.BY_BOOK[bookId]||!manuals.books[bookId])continue;
      const total=limit(raw),previous=limit(applied[bookId]);
      if(total<=previous)continue;
      const increased=total-previous;
      const before=manuals.books[bookId].exp;
      manuals.books[bookId].exp=Math.min(Manuals.MAX_EXP,before+increased);
      credited[bookId]=manuals.books[bookId].exp-before;
      nextTotals[bookId]=total;
    }
    if(!Object.keys(credited).length)return {credited:{},pending:false};
    tx.set(manualRef,manuals);
    tx.set(ref,{uid,roomId,session,totals:nextTotals});
    return {credited,pending:false};
  });
}
module.exports={STAGE,REALM,RECEIPTS,MANUALS,recordKills,receiptId,claim};
