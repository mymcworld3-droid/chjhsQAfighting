'use strict';
const Growth = require('./public/cultivation/nascent-growth.js');
const crypto = require('node:crypto');
const { recordEvent } = require('./public/cultivation/quest-rules.js');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { playerRepository, dongtianRepository } = require('./server-repositories.cjs');
const { runRewardReceipt } = require('./reward-receipt.cjs');
const { FieldValue } = require('firebase-admin/firestore');
const INDEX_COLLECTION='dongtianIndex', DATA_COLLECTION='dongtians', PLAY_COLLECTION='dongtianPlays',
  ELIGIBILITY_COLLECTION='dongtianSettlementClaims', REWARD_COLLECTION='dongtianRewardClaims';
const FIRST_COMPLETION_BASE_SPIRIT_STONES=30, FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION=30,
  OWNER_CULTIVATION_REWARD=1, OWNER_GOLD_REWARD=5, NASCENT_SOUL_THRESHOLD=68;
const count = n => Number.isFinite(Number(n)) ? Math.max(0,Math.floor(Number(n))) : 0;
const clean = v => String(v ?? '').trim();
function safeId(v,max=240) { const id=clean(v); return id && id.length<=max && !id.includes('/') ? id : ''; }
function receiptId(uid,cave,run) { return crypto.createHash('sha256').update(uid+'\n'+cave+'\n'+run).digest('hex'); }
function questionKey(q) {
  return crypto.createHash('sha256').update(JSON.stringify([clean(q.q),clean(q.correct),
    (q.wrong || []).map(clean).sort()])).digest('hex');
}
function verifyAnswers(cave,submitted) {
  const qs=Array.isArray(cave?.questions)?cave.questions:[], as=Array.isArray(submitted)?submitted:[];
  if(!qs.length || as.length!==qs.length) throw Object.assign(new Error('洞天答題紀錄不完整'),{status:409});
  const masteredKeys=[];
  for(let i=0;i<qs.length;i++) {
    const q=qs[i] || {}, a=as[i] || {};
    if(String(a.id || '')!==String(q.id || '')) throw Object.assign(new Error('洞天題目版本已改變，請重新進入'),{status:409});
    const selected=clean(a.selected), valid=[q.correct,...(q.wrong || [])].map(clean);
    if(!selected || !valid.includes(selected)) throw Object.assign(new Error('洞天作答內容無法驗證'),{status:409});
    if(selected===clean(q.correct)) masteredKeys.push(questionKey(q));
  }
  const correct=masteredKeys.length,total=qs.length,accuracy=correct/total;
  const tier=accuracy>=.9?'上品洞天機緣':accuracy>=.75?'中品洞天機緣':accuracy>=.6?'下品洞天機緣':'微光洞天機緣';
  const qualityEligible=new Set(qs.map(questionKey)).size===total && qs.every(q =>
    clean(q.q) && clean(q.exp).replace(/\s/g,'').length>=80 &&
    Array.isArray(q.wrong) && q.wrong.length===3 && new Set([q.correct,...q.wrong].map(clean)).size===4);
  return {correct,total,accuracy,tier,masteredKeys,qualityEligible};
}
function firstCompletionGold(correct) { return FIRST_COMPLETION_BASE_SPIRIT_STONES+count(correct)*FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION; }
function caveSoulBonus(player) { return Growth.cultivation(player,'cave'); }
function learningReward(previous,e,player,legacyReceipt) {
  const completed=previous?.completed===true, first=!completed;
  let ledger=previous?.learningRewardV2;
  if(!ledger) {
    // 歷史重遊會覆寫 correct；以原首通 receipt 遷移實際已領值，找不到紀錄時採保守上限。
    const oldCorrect=completed ? count(legacyReceipt?.correct ?? previous.total ?? e.total) : 0;
    ledger={version:2,masteredKeys:[],creditedCorrect:oldCorrect,
      goldPaid:completed ? count(legacyReceipt?.goldAdded ?? 150+30*count(previous.total || e.total)) : 0,
      soulClaimed:completed && oldCorrect>0,ownerRewardClaimed:completed};
  }
  const masteredKeys=[...new Set([...(ledger.masteredKeys || []),...(e.masteredKeys || [])])].slice(-200);
  const masteredCount=Math.min(count(e.total),Math.max(masteredKeys.length,Array.isArray(e.masteredKeys)?0:count(e.correct))); // 相容更新前尚未結算的資格紀錄
  const newCorrect=Math.max(0,masteredCount-count(ledger.creditedCorrect));
  const targetGold=firstCompletionGold(masteredCount);
  const goldAdded=Math.max(0,targetGold-count(ledger.goldPaid));
  const soulCultivationAdded=!ledger.soulClaimed && masteredCount>0 ? caveSoulBonus(player) : 0;
  const ownerRewarded=!ledger.ownerRewardClaimed && e.qualityEligible===true && e.accuracy>=.6;
  return {firstCompletion:first,goldAdded,cultivationAdded:newCorrect+soulCultivationAdded,
    soulCultivationAdded,spiritAdded:0,newCorrect,masteredCount,ownerRewarded,
    ledger:{version:2,masteredKeys,creditedCorrect:Math.max(count(ledger.creditedCorrect),masteredCount),
      goldPaid:Math.max(count(ledger.goldPaid),targetGold),soulClaimed:ledger.soulClaimed || masteredCount>0,
      ownerRewardClaimed:ledger.ownerRewardClaimed || ownerRewarded}};
}
async function verifyRequest(req,resolveA) {
  const b=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if(!b) throw Object.assign(new Error('請先登入後再結算洞天'),{status:401});
  const a=resolveA(); let v;
  try {v=await a.auth.verifyIdToken(b[1],true);} catch(_) {throw Object.assign(new Error('登入狀態已失效，請重新登入'),{status:401});}
  if(!v?.uid || v.aud!==PROJECT_IDS.A || v.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)
    throw Object.assign(new Error('登入身分驗證失敗'),{status:401});
  return {uid:v.uid,a};
}
async function claimEligibility(db,uid,dongtianId,runId,answers) {
  const id=receiptId(uid,dongtianId,runId),claimRef=db.collection(ELIGIBILITY_COLLECTION).doc(id),
    indexRef=db.collection(INDEX_COLLECTION).doc(dongtianId),caveRef=db.collection(DATA_COLLECTION).doc(dongtianId);
  return db.runTransaction(async tx => {
    const prior=await tx.get(claimRef); if(prior.exists) return {id,...prior.data()};
    const [is,cs]=await Promise.all([tx.get(indexRef),tx.get(caveRef)]);
    if(!is.exists || !cs.exists) throw Object.assign(new Error('洞天資料不存在'),{status:404});
    const index=is.data() || {},cave=cs.data() || {};
    if(index.status!=='active' || cave.status!=='active') throw Object.assign(new Error('洞天已封印，本次不進行通關結算'),{status:409});
    if(String(index.ownerUid || cave.ownerUid || '')!==String(cave.ownerUid || '')) throw new Error('洞天索引與內容擁有人不一致');
    const claim={uid,dongtianId,runId,ownerUid:String(cave.ownerUid || ''),...verifyAnswers(cave,answers),
      finalized:false,createdAt:FieldValue.serverTimestamp(),createdAtMs:Date.now()};
    tx.create(claimRef,claim);return {id,...claim};
  });
}
async function awardProgress(db,uid,e) {
  const playRef=db.collection(PLAY_COLLECTION).doc(uid+'__'+e.dongtianId),userRef=db.collection('users').doc(uid),
    ownerUid=String(e.ownerUid || ''),ownerRef=ownerUid && ownerUid!==uid ? db.collection('users').doc(ownerUid) : null;
  const receipt=await runRewardReceipt({db,collection:REWARD_COLLECTION,receiptId:e.id,fieldValue:FieldValue,
    onFirstClaim:async ({tx}) => {
      const [play,userSnap,ownerSnap]=await Promise.all([tx.get(playRef),tx.get(userRef),ownerRef ? tx.get(ownerRef) : null]);
      if(!userSnap.exists) throw new Error('玩家資料不存在');
      if(ownerRef && !ownerSnap?.exists) throw new Error('洞天主人資料不存在');
      const player=userSnap.data() || {},previous=play.exists ? play.data() : {};
      if(player.uid && player.uid!==uid) throw new Error('玩家資料 UID 不符');
      let legacyReceipt;
      if(previous.completed && !previous.learningRewardV2) {
        const history=await tx.get(db.collection(REWARD_COLLECTION).where('uid','==',uid).where('dongtianId','==',e.dongtianId));
        legacyReceipt=history.docs.map(s=>s.data()).find(r=>r.firstCompletion===true);
      }
      const reward=learningReward(previous,e,player,legacyReceipt),{ledger,...paid}=reward;
      if(!ownerRef) paid.ownerRewarded=false;
      tx.set(playRef,{uid,dongtianId:e.dongtianId,ownerUid,encountered:true,completed:true,
        correct:e.correct,total:e.total,accuracy:e.accuracy,rewardTier:e.tier,lastSpiritRunId:e.runId,
        bestCorrect:Math.max(count(previous.bestCorrect),count(previous.correct),e.correct),learningRewardV2:ledger,
        completedAt:FieldValue.serverTimestamp(),completedAtMs:Date.now()},{merge:true});
      const p={questProgress:recordEvent(player.questProgress,'dongtian')};
      if(paid.goldAdded) p['stats.gold']=FieldValue.increment(paid.goldAdded);
      if(paid.cultivationAdded) p['stats.totalScore']=FieldValue.increment(paid.cultivationAdded);
      tx.update(userRef,p);
      if(paid.ownerRewarded) tx.update(ownerRef,{'stats.totalScore':FieldValue.increment(OWNER_CULTIVATION_REWARD),'stats.gold':FieldValue.increment(OWNER_GOLD_REWARD)});
      return {...paid,correct:e.correct,total:e.total,tier:e.tier};
    },createReceipt:r=>({uid,dongtianId:e.dongtianId,runId:e.runId,ownerUid,...r})});
  const d=receipt.duplicate ? receipt.receipt : receipt.result;
  return {applied:!receipt.duplicate,firstCompletion:d?.firstCompletion===true,
    goldAdded:count(d?.goldAdded),cultivationAdded:count(d?.cultivationAdded),soulCultivationAdded:count(d?.soulCultivationAdded),
    spiritAdded:count(d?.spiritAdded),correct:count(d?.correct),total:count(d?.total),tier:String(d?.tier || e.tier || ''),
    newCorrect:count(d?.newCorrect),masteredCount:count(d?.masteredCount),ownerRewarded:d?.ownerRewarded===true};
}
async function finalizeEligibility(db,e,first) {
  const claimRef=db.collection(ELIGIBILITY_COLLECTION).doc(e.id),indexRef=db.collection(INDEX_COLLECTION).doc(e.dongtianId);
  await db.runTransaction(async tx => {
    const cs=await tx.get(claimRef); if(!cs.exists) throw new Error('洞天結算資格不存在');
    if(cs.data()?.finalized===true) return;
    if(first===true) {const is=await tx.get(indexRef);if(!is.exists) throw new Error('洞天索引不存在');tx.update(indexRef,{completionCount:FieldValue.increment(1)});}
    tx.update(claimRef,{finalized:true,firstCompletion:first===true,finalizedAt:FieldValue.serverTimestamp(),finalizedAtMs:Date.now()});
  });
}
function createHandler({resolveA=()=>playerRepository.resolve(),resolveBD=()=>dongtianRepository.resolve(),logger=console}={}) {
  return async function(req,res) {
    res.set?.('Cache-Control','no-store');
    const dongtianId=safeId(req.body?.dongtianId,200),runId=safeId(req.body?.runId,240);
    if(!dongtianId || !runId) return res.status(400).json({ok:false,error:'洞天結算識別碼無效'});
    if(!Array.isArray(req.body?.answers) || req.body.answers.length>60) return res.status(400).json({ok:false,error:'洞天答題紀錄格式無效'});
    let identity,bd;
    try {identity=await verifyRequest(req,resolveA);bd=resolveBD();}
    catch(error) {const status=error?.status || 503;if(status>=500)logger.error('[Dongtian settlement] Firebase unavailable:',error?.message);return res.status(status).json({ok:false,error:error?.message || '洞天結算服務尚未完成設定'});}
    try {
      const e=await claimEligibility(bd.db,identity.uid,dongtianId,runId,req.body.answers),reward=await awardProgress(identity.a.db,identity.uid,e);
      await finalizeEligibility(bd.db,e,reward.firstCompletion);
      return res.json({ok:true,dongtianId,runId,...reward});
    } catch(error) {const status=error?.status || 503;if(status>=500)logger.error('[Dongtian settlement] failed:',error?.message);return res.status(status).json({ok:false,error:error?.message || '洞天結算尚未完成，請稍後重試'});}
  };
}
module.exports=app=>app.post('/api/dongtian/settle',createHandler());
module.exports.__test={INDEX_COLLECTION,DATA_COLLECTION,PLAY_COLLECTION,ELIGIBILITY_COLLECTION,REWARD_COLLECTION,
  FIRST_COMPLETION_BASE_SPIRIT_STONES,FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION,OWNER_CULTIVATION_REWARD,OWNER_GOLD_REWARD,
  NASCENT_SOUL_THRESHOLD,safeId,receiptId,questionKey,verifyAnswers,firstCompletionGold,caveSoulBonus,learningReward,
  claimEligibility,awardProgress,finalizeEligibility,createHandler};
