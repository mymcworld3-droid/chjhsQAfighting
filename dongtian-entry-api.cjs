'use strict';
const {playerRepository,dongtianRepository}=require('./server-repositories.cjs');
const {FieldValue}=require('firebase-admin/firestore');

function createEntryHandler({verifyPlayer,content=()=>dongtianRepository.resolve().db,
  progress=()=>playerRepository.resolve().db,fields=FieldValue,logger=console}={}) {
  return async (req,res)=>{
    res.set?.('Cache-Control','no-store');
    let phase='authentication';
    try {
      const uid=await verifyPlayer(req);
      const id=String(req.body?.dongtianId||'').trim();
      const action=String(req.body?.action||'read');
      if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!['read','encounter','visit'].includes(action))
        return res.status(400).json({ok:false,error:'洞天讀取資料無效',code:'invalid-argument',phase:'validation'});
      phase='content-read';
      const db=content();
      const snap=await db.collection('dongtians').doc(id).get();
      if(!snap.exists)return res.status(404).json({ok:false,error:'此洞天已刪除或不存在',code:'not-found',phase});
      const cave={...snap.data(),id:snap.id};
      if(req.body?.owned===true&&cave.ownerUid!==uid)
        return res.status(403).json({ok:false,error:'只有洞天主人可以開啟此洞天',code:'permission-denied',phase:'ownership'});
      if(cave.tutorialOnly||cave.status!=='active')
        return res.status(409).json({ok:false,error:'此洞天尚未開放或已封印',code:'failed-precondition',phase:'status'});
      if(!Array.isArray(cave.questions)||!cave.questions.length)
        return res.status(409).json({ok:false,error:'洞天題目尚未準備完成',code:'failed-precondition',phase:'questions'});
      if(action==='encounter') {
        phase='encounter-record';
        const main=progress(),ref=main.collection('dongtianPlays').doc(uid+'__'+id);
        await main.runTransaction(async tx=>{
          const previous=await tx.get(ref);
          // Replays must never overwrite completion, mastery or existing rewards.
          tx.set(ref,previous.exists?{encountered:true}:{uid,dongtianId:id,ownerUid:cave.ownerUid||'',
            encountered:true,encounteredAt:fields.serverTimestamp(),encounteredAtMs:Date.now(),completed:false},{merge:true});
        });
      }
      if(action!=='read') {
        // Analytics is optional: a denied/capped counter must not block playable content.
        try { void db.collection('dongtianIndex').doc(id).update({playCount:fields.increment(1)})
          .catch(error=>logger.warn('[Dongtian visit counter]',{code:error?.code,message:error?.message})); }
        catch(error) {logger.warn('[Dongtian visit counter]',{code:error?.code,message:error?.message});}
      }
      return res.json(action==='read'?{ok:true,cave}:{ok:true,dongtianId:id});
    } catch(error) {
      logger.warn('[Dongtian entry API]',{phase,code:error?.code,message:error?.message});
      const status=Number(error?.status)||503;
      return res.status(status).json({ok:false,code:String(error?.code||'unavailable'),phase,
        error:status===401?'登入狀態已失效，請重新登入':'洞天讀取服務暫時無法連線，請稍後再試。'});
    }
  };
}
module.exports={createEntryHandler};
