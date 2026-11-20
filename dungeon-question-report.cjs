'use strict';
// Independent, two-pass question review shared with 問道試煉.
// A alone owns questions, learning stats and cultivation compensation;
// the player's authenticated C room owns combat stamina and its receipts.
const Quiz=require('./dungeon-quiz-api.cjs').__test;
const Reports=require('./question-report-api.cjs').__test;
const COLLECTION=Quiz.COLLECTION;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const exists=snap=>snap?.exists?snap.data():null;
const safeQuestionId=value=>typeof value==='string'&&
  /^[A-Za-z0-9_-]{6,120}$/.test(value)?value:'';
const shortReason=value=>String(value||'').normalize('NFC')
  .replace(/\s+/g,' ').trim().slice(0,1200);
function source(state,questionId){
  const q=state?.questions?.[Math.max(0,Number(state.answered)||0)];
  if(q?.id===questionId)return {question:q,pending:true};
  const reviewed=state?.reviews?.[questionId];
  if(reviewed?.questionId===questionId)
    return {question:reviewed,pending:false};
  return null;
}
function validateSource(row,reason){
  return Reports.validateReport({question:row.q,options:row.opts,
    correctIndex:row.answerIndex,explanation:row.explanation,
    userReason:reason});
}
async function report(dbA,dbC,uid,input,now=Date.now(),{
  review=Reports.reviewQuestion,award=Reports.awardOnce
}={}){
  const roomId=String(input?.roomId||'');
  const questionId=safeQuestionId(input?.questionId);
  if(!questionId)throw fail('題目識別碼無效',400);
  const reason=shortReason(input?.reason);
  if(reason.length<6)throw fail('請具體描述錯誤，至少輸入 6 個字元',400);
  const {sessionKey}=await Quiz.session(dbC,uid,roomId,now);
  const ref=dbA.collection(COLLECTION).doc(uid);
  const snap=await ref.get(),record=exists(snap);
  if(!record||record.roomId!==roomId||record.sessionKey!==sessionKey)
    throw fail('目前沒有可信的副本題目',409);
  const known=record.errorReports?.[questionId];
  if(known?.approved===true){
    return {status:'duplicate',valid:true,compensated:false,
      reason:'本題已經獨立審核確認，補償不會重複領取。',
      skipped:known.skipped===true,
      state:Quiz.view(record)};
  }
  const found=source(record,questionId);
  if(!found)throw fail('這道題目已失效，請回到目前題目重新回報',409);
  const trusted=validateSource(found.question,reason);
  if(trusted.error)throw fail(trusted.error,400);
  // Reuse a previous trusted server-side compensation proof only for the
  // identical question/options/answer, never for unrelated client text.
  const claimRef=dbA.collection('questionErrorCompensations')
    .doc(Reports.reportKey(uid,trusted.question));
  const claimed=exists(await claimRef.get());
  const accepted=claimed?.uid===uid&&claimed.question===trusted.question&&
    claimed.correctIndex===trusted.correctIndex&&
    claimed.explanation===trusted.explanation&&
    JSON.stringify(claimed.options)===JSON.stringify(trusted.options);
  let decision;
  try{
    decision=accepted?{status:'confirmed',reason:claimed.reviewReason,
      issueType:claimed.issueType}:
      await review(trusted,{trusted:true});
  }catch(error){
    throw fail('獨立審核暫時無法完成，請稍後重新送審',503);
  }
  if(decision?.status==='unavailable')
    throw fail(decision.reason||'獨立審核暫時無法完成',503);
  if(decision?.status!=='confirmed'){
    // A pending question's answer/explanation must not be leaked by the
    // model review. The grading server remains the only answer authority.
    return {status:'rejected',valid:false,compensated:false,
      reason:found.pending?'獨立審核未確認本題有實質錯誤。':
        String(decision.reason||'獨立審核未確認題目錯誤。').slice(0,300)};
  }
  const awardResult=await award(dbA,uid,trusted,decision,{goldReward:0});
  // Currency is issued only by the shared A receipt, and never per report
  // retry. The next transaction is deliberately repeatable after an outage.
  const updated=await dbA.runTransaction(async tx=>{
    const snapshot=await tx.get(ref),current=exists(snapshot);
    if(!current||current.roomId!==roomId||current.sessionKey!==sessionKey)
      throw fail('題目狀態已變更，請重新同步後再補領',409);
    if(current.errorReports?.[questionId]?.approved)
      return {state:current,entry:current.errorReports[questionId]};
    const match=source(current,questionId);
    if(!match)throw fail('題目已失效，請重新取得最新紀錄',409);
    const evidence=validateSource(match.question,reason);
    if(evidence.error||evidence.question!==trusted.question||
        JSON.stringify(evidence.options)!==JSON.stringify(trusted.options)||
        evidence.correctIndex!==trusted.correctIndex)
      throw fail('題目資料已變更，拒絕使用舊審核結果',409);
    const skipped=match.pending;
    const question=match.question;
    const index=skipped?Math.max(0,Number(current.answered)||0)+1:
      question.index;
    if(!Number.isSafeInteger(index)||index<1)throw fail('答題序號無效',409);
    if(skipped){
      // An invalid unanswered question is removed, not counted as a
      // correct answer or learning success. A synthetic +4 C receipt
      // advances the ordinary strictly ordered quiz-credit sequence.
      const reviewReceipt={uid,questionId,index,
        skipped:true,errorConfirmed:true,correct:true,amount:4,
        choice:-1,answerIndex:null,
        q:question.q,opts:question.opts,subject:question.subject,
        topic:question.topic,learningTopic:question.learningTopic,
        difficulty:question.difficulty,adaptive:question.adaptive||null,
        explanation:'獨立審核確認本題有誤，已跳過此題，不計入作答成績。',
        reward:{cultivation:0,gold:0,learning:''}};
      const qs={...(current.questions||{})};
      delete qs[index-1];current.questions=qs;
      current.answered=index;current.lastReview=reviewReceipt;
      current.reviews={...(current.reviews||{}),[questionId]:reviewReceipt};
      current.history=[...(current.history||[]),question.q].slice(-40);
      current.historyMeta=[...(current.historyMeta||[]),
        {...question.meta,q:question.q}].slice(-40);
    }else{
      const saved={...question,errorConfirmed:true};
      current.reviews={...(current.reviews||{}),[questionId]:saved};
      if(current.lastReview?.questionId===questionId)
        current.lastReview=saved;
    }
    const entry={approved:true,skipped,index,
      reviewedAtMs:now,reason:String(decision.reason||'').slice(0,300)};
    current.errorReports={...(current.errorReports||{}),
      [questionId]:entry};
    tx.set(ref,current);
    return {state:current,entry};
  });
  return {...awardResult,valid:true,
    status:awardResult.status,skipped:updated.entry.skipped,
    reason:'獨立審核已確認本題有誤。'+
      (awardResult.status==='limit'?' '+awardResult.reason:''),
    state:Quiz.view(updated.state)};
}
// Formula errors are accepted as an integrity report, not an answer hint.
// It cannot automatically pay compensation or skip the question.
async function reviewMath(dbA,dbC,uid,input,now=Date.now(),{
  review=Reports.reviewQuestion
}={}){
  const roomId=String(input?.roomId||'');
  const questionId=safeQuestionId(input?.questionId);
  if(!questionId)throw fail('題目識別碼無效',400);
  const {sessionKey}=await Quiz.session(dbC,uid,roomId,now);
  const snap=await dbA.collection(COLLECTION).doc(uid).get();
  const record=exists(snap);
  if(!record||record.roomId!==roomId||record.sessionKey!==sessionKey)
    throw fail('找不到有效的副本題目',409);
  const match=source(record,questionId);
  if(!match)throw fail('找不到可送審的題目',409);
  const trusted=validateSource(match.question,
    '玩家作答時 MathJax 無法解析公式，TeX 顯示成原始文字。請檢查題幹、選項與單位排版。');
  if(trusted.error)throw fail(trusted.error,400);
  let outcome;
  try{outcome=await review(trusted,{trusted:true});}
  catch(_){throw fail('公式審核暫時無法完成',503);}
  return {status:outcome?.status||'unavailable',submitted:true};
}
module.exports={report,reviewMath,source,validateSource};
