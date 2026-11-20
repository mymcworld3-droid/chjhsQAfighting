'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Quiz=require('../dungeon-quiz-api.cjs').__test;
const Reports=require('../dungeon-question-report.cjs');
const Credits=require('../dungeon-quiz-credit.cjs');
const ErrorRefund=require('../dungeon-quiz-error-refund.cjs');
const AT=1800000001000,ID='dungeon123456789';
function store(initial={}){
  const records=new Map(Object.entries(initial));let chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({exists:records.has(ref.key),data:()=>clone(records.get(ref.key))});
  const doc=(name,id)=>({id,key:name+'/'+id,get:async()=>snap({key:name+'/'+id})});
  return {records,collection:name=>({doc:id=>doc(name,id)}),
    runTransaction(fn){
      const job=chain.then(async()=>{
        let writing=false;const writes=new Map();
        const tx={
          get:async ref=>{assert.equal(writing,false);return snap(ref);},
          set:(ref,value)=>{writing=true;writes.set(ref.key,clone(value));},
          update:(ref,patch)=>{
            writing=true;
            const current=clone(writes.get(ref.key)||records.get(ref.key)||{});
            for(const [key,value] of Object.entries(clone(patch))){
              const parts=key.split('.');let node=current;
              for(const part of parts.slice(0,-1))node=node[part]||={};
              node[parts.at(-1)]=value;
            }
            writes.set(ref.key,current);
          }
        };
        const result=await fn(tx);
        for(const [key,value] of writes)records.set(key,value);
        return result;
      });
      chain=job.catch(()=>{});return job;
    }
  };
}
function setup(){
  const a=store({'users/a':{uid:'a',profile:{educationLevel:'國中二年級'},
    stats:{totalScore:20,totalAnswered:0,totalCorrect:0},
    gameSettings:{sourceMode:'random'}}});
  const room={id:ID,mode:'dungeon',status:'assembled',version:1,
    assembledAtMs:AT-5000,expiresAtMs:AT+600000,
    members:{a:{uid:'a',explorationStamina:5,quizCreditSeq:0}}};
  const c=store({['dungeonRooms/'+ID]:room});
  return {a,c,room};
}
async function question(f){
  const prepared=await Quiz.prepareQuestion(f.a,f.c,'a',ID,0,AT);
  const parsed={q:'以下哪一個選項符合運算定義的完整條件？',
    correct:'只有選項 C 符合定義',
    wrong:['不符合條件 A','不符合條件 B','不符合條件 D'],
    exp:'將四個選項逐項代入定義，可以確認只有選項 C 符合條件。',
    subject:prepared.subject,sub_topic:'基本定義'};
  const q=await Quiz.commitQuestion(f.a,'a',prepared,parsed,AT);
  return {...q,answerText:parsed.correct};
}
const review=async()=>({status:'confirmed',reason:'條件不足，答案不唯一',issueType:'ambiguity'});
let awards=0;
const award=async()=>{awards++;return {status:'confirmed',compensated:true,cultivationAdded:1};};

test('unanswered verified mistake skips without grading, but produces exactly one +4 receipt',async()=>{
  awards=0;const f=setup(),q=await question(f);
  const first=await Reports.report(f.a,f.c,'a',{roomId:ID,
    questionId:q.id,reason:'題目存在條件不足，無法判斷唯一解答'},AT,{review,award});
  assert.equal(first.valid,true);assert.equal(first.skipped,true);
  assert.equal(first.state.answered,1);
  assert.equal(first.state.lastReview.skipped,true);
  assert.equal(first.state.lastReview.answerIndex,null);
  assert.deepEqual(first.state.pendingCredits.map(x=>x.amount),[4]);
  assert.equal(f.a.records.get('users/a').stats.totalAnswered,0);
  assert.equal(f.a.records.get('users/a').stats.totalCorrect,0);
  assert.equal([...f.a.records.keys()].filter(k=>k.startsWith('exam_logs/')).length,0);
  const state=f.a.records.get('dungeonQuizStates/a');
  const credited=Credits.credit(f.room,'a',state,q.id,ID);
  assert.equal(credited.members.a.explorationStamina,9);
  assert.equal(credited.members.a.quizCreditSeq,1);
  assert.equal(ErrorRefund.RECEIPTS,'dungeonQuizErrorRefunds');
  assert.throws(()=>ErrorRefund.calculate({...f.room,members:credited.members},
    'a',state,q.id,ID),/找不到已確認/);
  const duplicate=await Reports.report(f.a,f.c,'a',{roomId:ID,
    questionId:q.id,reason:'反覆重試已核實之錯題'},AT,{review,award});
  assert.equal(duplicate.status,'duplicate');
  assert.equal(awards,1);
  await Quiz.acknowledge(f.a,f.c,'a',{roomId:ID,questionId:q.id},AT);
  assert.equal((await Quiz.state(f.a,f.c,'a',ID,AT)).lastReview,null);
});
test('rejected report does not reveal correct answer before grading',async()=>{
  const f=setup(),q=await question(f);
  const result=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'本題的答案可能存在問題'},AT,{
    review:async()=>({status:'rejected',reason:'正確解答是秘密選項 2'}),
    award:async()=>{throw Error('should not award');}
  });
  assert.equal(result.status,'rejected');
  assert.ok(!result.reason.includes('秘密選項'));
  assert.equal((await Quiz.state(f.a,f.c,'a',ID,AT)).answered,0);
  assert.equal(f.a.records.get('dungeonQuizStates/a').errorReports,undefined);
});
test('wrong graded answer keeps original +1 and authorizes only 3 additional stamina',async()=>{
  awards=0;const f=setup(),q=await question(f);
  const answer=await Quiz.answer(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,
    choice:q.opts.findIndex(v=>v!==q.answerText)
  },AT);
  assert.equal(answer.review.correct,false);assert.equal(answer.review.amount,1);
  const graded=f.a.records.get('dungeonQuizStates/a');
  const credit=Credits.credit(f.room,'a',graded,q.id,ID);
  f.room.members=credit.members;
  assert.equal(f.room.members.a.explorationStamina,6);
  const approved=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'題目條件不完整，選項產生歧義'},AT,{
    review,award
  });
  assert.equal(approved.valid,true);assert.equal(approved.skipped,false);
  assert.equal(approved.state.lastReview.errorConfirmed,true);
  assert.equal(approved.state.errorRefunds[0].id,q.id);
  const proof=f.a.records.get('dungeonQuizStates/a');
  const delta=ErrorRefund.calculate(f.room,'a',proof,q.id,ID);
  assert.equal(delta.nominal,3);assert.equal(delta.granted,3);
  assert.ok(delta.receiptId.length===64);
  assert.equal(ErrorRefund.receiptId(ID,f.room.assembledAtMs,'a',q.id),
    delta.receiptId);
  assert.throws(()=>ErrorRefund.calculate(f.room,'other',proof,q.id,ID),/有效隊員/);
  assert.throws(()=>ErrorRefund.calculate(f.room,'a',proof,'forged-id',ID),/找不到/);
  const tooEarly={...f.room,members:{a:{...f.room.members.a,quizCreditSeq:0}}};
  assert.throws(()=>ErrorRefund.calculate(tooEarly,'a',proof,q.id,ID),/先補領/);
  const full={...f.room,members:{a:{...f.room.members.a,explorationStamina:10}}};
  assert.equal(ErrorRefund.calculate(full,'a',proof,q.id,ID).granted,0);
  assert.equal(awards,1);
});
test('scope, membership and report reason are server verified; no own answer key accepted',async()=>{
  const f=setup(),q=await question(f);
  await assert.rejects(Reports.report(f.a,f.c,'b',
    {roomId:ID,questionId:q.id,reason:'有可核對之錯誤'},AT,{review,award}),/副本未開始/);
  await assert.rejects(Reports.report(f.a,f.c,'a',
    {roomId:ID,questionId:'fake',reason:'有可核對之錯誤'},AT,{review,award}),/識別碼/);
  await assert.rejects(Reports.report(f.a,f.c,'a',
    {roomId:ID,questionId:q.id,reason:'錯'},AT,{review,award}),/至少輸入/);
  await assert.rejects(Reports.report(f.a,f.c,'a',
    {roomId:ID,questionId:'dungeon123fake',reason:'此題內容有很大錯誤'},AT,{review,award}),/已失效/);
  f.room.status='closed';f.c.records.set('dungeonRooms/'+ID,f.room);
  await assert.rejects(Reports.report(f.a,f.c,'a',
    {roomId:ID,questionId:q.id,reason:'此題內容有很大錯誤'},AT,{review,award}),/副本未開始/);
});
test('math formatting audit is read-only and never compensates by itself',async()=>{
  const f=setup(),q=await question(f);
  const before=structuredClone(f.a.records.get('dungeonQuizStates/a'));
  const result=await Reports.reviewMath(f.a,f.c,'a',{roomId:ID,
    questionId:q.id},AT,{review});
  assert.equal(result.status,'confirmed');
  assert.equal(result.submitted,true);
  assert.deepEqual(f.a.records.get('dungeonQuizStates/a'),before);
});

test('confirmed graded error removes only its learning footprint, not strategic stamina',async()=>{
  awards=0;const f=setup(),q=await question(f);
  const before=f.a.records.get('users/a');
  const choice=q.opts.findIndex(v=>v!==q.answerText);
  await Quiz.answer(f.a,f.c,'a',{roomId:ID,questionId:q.id,choice},AT);
  const graded=f.a.records.get('dungeonQuizStates/a');
  const stamina=Credits.credit(f.room,'a',graded,q.id,ID);
  f.room.members=stamina.members;
  assert.equal(f.room.members.a.explorationStamina,6);
  let user=f.a.records.get('users/a');
  assert.equal(user.stats.totalAnswered,1);
  assert.equal(user.stats.knowledgeMap[q.subject]['基本定義'].total,1);
  assert.equal(Object.keys(user.stats.soloLearningV1.mistakes).length,1);
  const result=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'本題的條件不足，無法排除不只一個正確答案'},AT,{review,award});
  assert.equal(result.valid,true);
  assert.equal(result.state.lastReview.excludedFromLearning,true);
  user=f.a.records.get('users/a');
  assert.equal(user.stats.totalAnswered,before.stats.totalAnswered);
  assert.equal(user.stats.totalCorrect,before.stats.totalCorrect);
  assert.equal(user.stats.knowledgeMap[q.subject]['基本定義'].total,0);
  assert.equal(user.stats.knowledgeMap[q.subject]['基本定義'].correct,0);
  assert.equal(Object.keys(user.stats.soloLearningV1.mistakes).length,0);
  assert.equal(result.progress.stats.totalAnswered,0);
  const log=[...f.a.records.entries()].find(([key])=>key.startsWith('exam_logs/'))?.[1];
  assert.equal(log?.errorConfirmed,true);
  assert.equal(log?.excludedFromLearning,true);
  assert.ok(log.learningCorrectionEvidence);
  assert.equal(f.room.members.a.explorationStamina,6,
    'correcting learning evidence must not alter stamina rules');
  assert.equal(ErrorRefund.calculate(f.room,'a',
    f.a.records.get('dungeonQuizStates/a'),q.id,ID).nominal,3);
  const again=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'第二裝置再送相同的錯題回報'},AT,{review,award});
  assert.equal(again.status,'duplicate');
  assert.equal(again.progress.stats.totalAnswered,0);
  assert.equal(f.a.records.get('users/a').stats.totalAnswered,0);
  assert.equal(awards,1);
  f.room.members.a.lastQuizErrorRefund={questionId:q.id,granted:3,nominal:3};
  f.c.records.set('dungeonRooms/'+ID,f.room);
  assert.equal((await Quiz.state(f.a,f.c,'a',ID,AT)).errorRefunds.length,0);
});
test('invalid correct answer retracts success metrics without removing earned cultivation',async()=>{
  const f=setup(),q=await question(f);
  const choice=q.opts.indexOf(q.answerText);
  await Quiz.answer(f.a,f.c,'a',{roomId:ID,questionId:q.id,choice},AT);
  const earned=f.a.records.get('users/a').stats.totalScore;
  assert.equal(f.a.records.get('users/a').stats.totalCorrect,1);
  const report=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'原本被認定的答案其實不唯一'},AT,{review,award});
  assert.equal(report.valid,true);
  const user=f.a.records.get('users/a');
  assert.equal(user.stats.totalCorrect,0);
  assert.equal(user.stats.totalAnswered,0);
  assert.equal(user.stats.currentStreak,0);
  assert.equal(user.stats.totalScore,earned);
  assert.equal(report.progress.stats.totalCorrect,0);
  assert.equal(report.state.errorRefunds.length,0);
});
test('later independent answers are preserved while older bad answer is retracted',async()=>{
  const f=setup(),q=await question(f);
  await Quiz.answer(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,choice:q.opts.findIndex(v=>v!==q.answerText)
  },AT);
  await Quiz.acknowledge(f.a,f.c,'a',{roomId:ID,questionId:q.id},AT);
  const ctx=await Quiz.prepareQuestion(f.a,f.c,'a',ID,0,AT);
  const next=await Quiz.commitQuestion(f.a,'a',ctx,{
    q:'下列哪一項是另外一題獨立成立的條件？',
    correct:'第一個條件成立',wrong:['第二個條件不成立','第三個條件不成立','第四個條件不成立'],
    exp:'將各條件代入定義，只有第一個條件可以正確成立。',
    subject:ctx.subject,sub_topic:'其他觀念'},AT);
  await Quiz.answer(f.a,f.c,'a',{roomId:ID,questionId:next.id,
    choice:next.opts.indexOf('第一個條件成立')},AT);
  const corrected=await Reports.report(f.a,f.c,'a',{
    roomId:ID,questionId:q.id,reason:'第一題中的條件不符合唯一選項的要求'},AT,{review,award});
  assert.equal(corrected.valid,true);
  const user=f.a.records.get('users/a');
  assert.equal(user.stats.totalAnswered,1);
  assert.equal(user.stats.totalCorrect,1);
  assert.equal(user.stats.knowledgeMap[ctx.subject]['其他觀念'].total,1);
  assert.equal(user.stats.knowledgeMap[q.subject]['基本定義'].total,0);
  assert.equal(user.stats.lastQuizAnswer.question,next.q);
  assert.equal(corrected.state.lastReview.questionId,next.id);
});
test('previously approved report repairs missing learning exclusion without repaying',async()=>{
  const f=setup(),q=await question(f);
  await Quiz.answer(f.a,f.c,'a',{roomId:ID,questionId:q.id,
    choice:q.opts.findIndex(v=>v!==q.answerText)},AT);
  const saved=f.a.records.get('dungeonQuizStates/a');
  saved.errorReports={[q.id]:{approved:true,skipped:false,index:1,reason:'既有的獨立審核'}};
  f.a.records.set('dungeonQuizStates/a',saved);
  const repaired=await Reports.report(f.a,f.c,'a',{roomId:ID,
    questionId:q.id,reason:'補做已確認錯題的學習修正'},AT,{
      review:async()=>{throw Error('independent review must not run again');},
      award:async()=>{throw Error('duplicate compensation must not pay again');}
    });
  assert.equal(repaired.status,'duplicate');
  assert.equal(repaired.state.lastReview.errorConfirmed,true);
  assert.equal(repaired.progress.stats.totalAnswered,0);
  assert.equal(f.a.records.get('dungeonQuizStates/a').errorReports[q.id].learningReversed,true);
});
