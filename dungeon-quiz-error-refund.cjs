'use strict';
// Cross-project recovery. The A review/report ledger is authoritative;
// the C transaction atomically guards one shortfall refund per question.
const {MAX_STAMINA,RIGHT,WRONG,staminaFor}=require('./dungeon-stamina-rules.cjs');
const crypto=require('node:crypto');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const RECEIPTS='dungeonQuizErrorRefunds';
const safeIndex=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000;
const receiptId=(roomId,session,uid,questionId)=>crypto.createHash('sha256')
  .update(['dungeon-quiz-error-v1',roomId,session,uid,questionId].join('\n'))
  .digest('hex');
function calculate(room,uid,source,questionId,roomId){
  const id=roomId||room?.id,member=room?.members?.[uid];
  if(room?.mode!=='dungeon'||room.status!=='assembled'||!member)
    throw fail('副本已結束或你不是有效隊員',403);
  const sessionKey=id+':'+room.assembledAtMs;
  if(source?.roomId!==id||source?.sessionKey!==sessionKey)
    throw fail('錯題補償紀錄不屬於本場副本',403);
  if(typeof questionId!=='string'||questionId.length<6||questionId.length>120)
    throw fail('題目識別碼無效',400);
  const proof=source?.errorReports?.[questionId],review=source?.reviews?.[questionId];
  if(proof?.approved!==true||proof.skipped===true||
      !safeIndex(proof.index)||!review||review.uid!==uid||
      review.questionId!==questionId||review.index!==proof.index||
      typeof review.correct!=='boolean'||review.skipped===true)
    throw fail('找不到已確認且尚可補正的錯題紀錄',403);
  if((member.quizCreditSeq||0)<proof.index)
    throw fail('請先補領本題原本的答題體力，再返還錯題差額',409);
  const original=review.correct?RIGHT:WRONG;
  if(review.amount!==original)throw fail('答題體力紀錄無法驗證',403);
  const nominal=room.mapVersion===2?0:RIGHT-original;
  const stamina=staminaFor(member);
  const granted=Math.min(MAX_STAMINA-stamina,nominal);
  return {member,nominal,granted,session:room.assembledAtMs,
    receiptId:receiptId(id,room.assembledAtMs,uid,questionId)};
}
module.exports={RECEIPTS,receiptId,calculate};
