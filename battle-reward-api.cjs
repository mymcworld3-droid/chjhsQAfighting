'use strict';
const crypto=require('node:crypto');
const {PROJECT_IDS}=require('./firebase-admin-projects.cjs');
const {playerRepository,battleRepository}=require('./server-repositories.cjs');
const {runRewardReceipt}=require('./reward-receipt.cjs');
const {FieldValue}=require('firebase-admin/firestore');
const ROOM_COLLECTION='rooms',CLAIM_COLLECTION='battleRewardClaims',MODE_VERSION=2,WIN_GOLD=500,WIN_CULTIVATION=5,LOSS_GOLD=200;
function safeRoomId(v){const id=String(v||'').trim();return /^[A-Za-z0-9_-]{8,160}$/.test(id)?id:'';}
function claimId(roomId,uid){return crypto.createHash('sha256').update(String(roomId)+'\n'+String(uid)).digest('hex');}
function battleReward(room,uid){
  if(!room||Number(room.modeVersion)!==MODE_VERSION||room.status!=='finished')return null;
  const h=String(room.host?.uid||''),g=String(room.guest?.uid||''),role=uid===h?'host':uid===g?'guest':'';
  if(!role||!h||!g)return null;
  if(room.winner===uid)return {role,outcome:'win',gold:WIN_GOLD,cultivation:WIN_CULTIVATION};
  if(room.winner===h||room.winner===g)return {role,outcome:'loss',gold:LOSS_GOLD,cultivation:0};
  if(room.winner==='draw'||!room.winner)return {role,outcome:'draw',gold:0,cultivation:0};
  return null;
}
async function verifyRequest(req,resolveA){
  const bearer=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
  if(!bearer)throw Object.assign(new Error('請先登入後再領取鬥法獎勵'),{status:401});
  const a=resolveA();let verified;
  try{verified=await a.auth.verifyIdToken(bearer[1],true);}catch(_){throw Object.assign(new Error('登入狀態已失效，請重新登入'),{status:401});}
  if(!verified?.uid||verified.aud!==PROJECT_IDS.A||verified.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw Object.assign(new Error('登入身分驗證失敗'),{status:401});
  return {uid:verified.uid,a};
}
async function awardBattle(db,uid,roomId,reward){
  const userRef=db.collection('users').doc(uid);
  const receipt=await runRewardReceipt({db,collection:CLAIM_COLLECTION,receiptId:claimId(roomId,uid),fieldValue:FieldValue,
    onFirstClaim:async({tx})=>{
      const snap=await tx.get(userRef);if(!snap.exists)throw new Error('玩家資料不存在');
      const user=snap.data()||{};if(user.uid&&user.uid!==uid)throw new Error('玩家資料 UID 不符');
      const st=user.stats||{},patch={'stats.battleMatches':Math.max(0,Number(st.battleMatches)||0)+1};
      if(reward.outcome==='win')patch['stats.battleWins']=Math.max(0,Number(st.battleWins)||0)+1;
      else if(reward.outcome==='loss')patch['stats.battleLosses']=Math.max(0,Number(st.battleLosses)||0)+1;
      else patch['stats.battleDraws']=Math.max(0,Number(st.battleDraws)||0)+1;
      if(reward.gold)patch['stats.gold']=Math.max(0,Number(st.gold)||0)+reward.gold;
      if(reward.cultivation)patch['stats.totalScore']=Math.max(0,Number(st.totalScore)||0)+reward.cultivation;
      tx.update(userRef,patch);
      return {outcome:reward.outcome,goldAdded:reward.gold,cultivationAdded:reward.cultivation,role:reward.role};
    },createReceipt:r=>({uid,roomId,...r})});
  const data=receipt.duplicate?receipt.receipt:receipt.result;
  return {awarded:!receipt.duplicate,outcome:data?.outcome||reward.outcome,goldAdded:Math.max(0,Number(data?.goldAdded)||0),cultivationAdded:Math.max(0,Number(data?.cultivationAdded)||0),role:data?.role||reward.role};
}
function createHandler({resolveA=()=>playerRepository.resolve(),resolveC=()=>battleRepository.resolve(),award=awardBattle,logger=console}={}){
 return async function(req,res){
  res.set?.('Cache-Control','no-store');const roomId=safeRoomId(req.body?.roomId);
  if(!roomId)return res.status(400).json({ok:false,error:'鬥法房間代碼無效'});
  let identity,c;try{identity=await verifyRequest(req,resolveA);c=resolveC();}catch(error){const status=error?.status||503;if(status>=500)logger.error('[Battle reward] Firebase unavailable:',error?.message||error);return res.status(status).json({ok:false,error:error?.message||'鬥法獎勵服務尚未完成設定'});}
  try{
    const ref=c.db.collection(ROOM_COLLECTION).doc(roomId),snap=await ref.get();
    if(!snap.exists)return res.status(404).json({ok:false,error:'找不到鬥法結算紀錄'});
    const reward=battleReward(snap.data()||{},identity.uid);
    if(!reward)return res.status(409).json({ok:false,error:'鬥法尚未完成，或你不是此場參戰玩家'});
    const result=await award(identity.a.db,identity.uid,roomId,reward),marker=result.role==='host'?'hostResultRecorded':'guestResultRecorded';
    try{await ref.update({[marker]:true,updatedAt:FieldValue.serverTimestamp()});}catch(error){logger.warn('[Battle reward] C marker deferred:',error?.message||error);}
    return res.json({ok:true,roomId,...result});
  }catch(error){logger.error('[Battle reward] settlement failed:',error?.code||error?.message||error);return res.status(503).json({ok:false,error:'鬥法獎勵尚未完成入帳，請稍後重試'});}
 };
}
module.exports=app=>app.post('/api/battle/reward',createHandler());
module.exports.__test={ROOM_COLLECTION,CLAIM_COLLECTION,MODE_VERSION,WIN_GOLD,WIN_CULTIVATION,LOSS_GOLD,safeRoomId,claimId,battleReward,awardBattle,createHandler};
