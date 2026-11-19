'use strict';
// Atomic, server-trusted per-player stamina credits. A owns grading receipts,
// C owns the shared room. Clients may only name a completed question; they
// cannot supply correctness, stamina amounts or alter other party members.
const {MAX_STAMINA,RIGHT,WRONG,clampStamina}=require('./dungeon-stamina-rules.cjs');
const fail=(msg,status=409)=>Object.assign(new Error(msg),{status});
const validIndex=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000;
function credit(room,uid,source,questionId,roomId){
  if(room?.mode!=='dungeon'||room?.status!=='assembled'||!room.members?.[uid])
    throw fail('副本已結束或你不是有效隊員',403);
  const id=roomId||room.id;
  const sessionKey=id+':'+room.assembledAtMs;
  if(source?.sessionKey!==sessionKey||source?.roomId!==id)
    throw fail('答題紀錄不屬於這一場副本',403);
  if(typeof questionId!=='string'||questionId.length>120)
    throw fail('答題序號無效',400);
  const review=source.reviews?.[questionId];
  if(!review||review.uid!==uid||review.questionId!==questionId||!validIndex(review.index)||
      typeof review.correct!=='boolean'||
      review.amount!==(review.correct?RIGHT:WRONG))
    throw fail('找不到已完成且可信的答題結果',403);
  const member=room.members[uid],previous=Number.isSafeInteger(member.quizCreditSeq)?
    member.quizCreditSeq:0;
  if(review.index<=previous)return {duplicate:true,members:room.members};
  if(review.index!==previous+1)
    throw fail('請先領取較早完成的題目體力',409);
  const stamina=clampStamina(member.explorationStamina);
  const received=Math.min(MAX_STAMINA-stamina,review.amount);
  const updated={...member,explorationStamina:stamina+received,
    quizCreditSeq:review.index,lastQuizCredit:{
      questionId,index:review.index,correct:review.correct,
      granted:received,nominal:review.amount
    }};
  return {duplicate:false,members:{...room.members,[uid]:updated},
    credit:updated.lastQuizCredit};
}
module.exports={MAX_STAMINA,RIGHT,WRONG,credit};
