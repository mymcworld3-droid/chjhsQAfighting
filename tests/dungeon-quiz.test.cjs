'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
process.env.GAME_DATA_BACKEND='d1';
const Q=require('../dungeon-quiz-api.cjs').__test;
const Credits=require('../dungeon-quiz-credit.cjs');
const at=1800000001000,roomId='dungeon123456789';
function db(initial={}){
  const records=new Map(Object.entries(initial));let chain=Promise.resolve();
  const clone=v=>structuredClone(v);
  const snap=ref=>({exists:records.has(ref.key),id:ref.id,data:()=>clone(records.get(ref.key))});
  const doc=(collection,id)=>({id,key:collection+'/'+id,get:async()=>snap({id,key:collection+'/'+id})});
  return {records,collection:name=>({doc:id=>doc(name,id)}),
    runTransaction:fn=>{
      const run=chain.then(async()=>{
        const changes=new Map();let writing=false;
        const tx={get:async ref=>{
          assert.equal(writing,false,'read after write in transaction');
          return snap(ref);
        },set:(ref,value)=>{writing=true;changes.set(ref.key,clone(value));},
          update:(ref,value)=>{writing=true;changes.set(ref.key,
            {...clone(records.get(ref.key)||{}),...clone(value)}}};
        const result=await fn(tx);for(const [k,v]of changes)records.set(k,v);
        return result;
      });
      chain=run.catch(()=>{});return run;
    }};
}
function environment(){
  const user=uid=>({uid,profile:{educationLevel:'國中二年級'},
    gameSettings:{sourceMode:'random'},stats:{totalScore:20,totalAnswered:0,totalCorrect:0}});
  const a=db({'users/a':user('a'),'users/b':user('b')});
  const room={id:roomId,mode:'dungeon',status:'assembled',
    assembledAtMs:at-5000,expiresAtMs:at+600000,
    members:{a:{uid:'a',explorationStamina:93,quizCreditSeq:0},
      b:{uid:'b',explorationStamina:70,quizCreditSeq:0}}};
  const c=db({['dungeonRooms/'+roomId]:room});
  return {a,c,room};
}
const item=subject=>({q:'在同一課程中，請判斷下列哪項敘述符合定義？',
  correct:'明確符合課本定義',wrong:['與定義相反','只符合部分條件','無法由條件推出'],
  exp:'根據課本定義逐項驗證，只有「明確符合課本定義」滿足所有必要條件。',
  subject,sub_topic:'定義理解',difficulty:'easy',
  question_form:'direct-application',concept_id:'definition'});
test('authentic C room and A grade scope determine each personal question slot',async()=>{
  const {a,c,room}=environment();
  const first=await Q.prepareQuestion(a,c,'a',roomId,0,at);
  const second=await Q.prepareQuestion(a,c,'a',roomId,1,at);
  assert.equal(first.questionIndex,0);assert.equal(second.questionIndex,1);
  assert.equal(first.level,'國中二年級');
  assert.notEqual(first.subject,second.subject);
  const q=await Q.commitQuestion(a,'a',first,item(first.subject),at);
  assert.equal(q.opts.length,4);
  assert.equal('answerIndex' in q,false);
  assert.equal('explanation' in q,false);
  const repeat=await Q.prepareQuestion(a,c,'a',roomId,0,at);
  assert.deepStrictEqual(repeat.pending,q);
  const next=await Q.commitQuestion(a,'a',second,
    {...item(second.subject),q:item(second.subject).q+' 第二題'},at);
  assert.notEqual(next.id,q.id);
  assert.equal((await Q.state(a,c,'a',roomId,at)).stock,2);
  assert.equal((await Q.state(a,c,'b',roomId,at)).stock,0);
});
test('graded answer changes only answering player progression and C credit is once-only',async()=>{
  const {a,c,room}=environment();
  const ctx=await Q.prepareQuestion(a,c,'a',roomId,0,at);
  const q=await Q.commitQuestion(a,'a',ctx,item(ctx.subject),at);
  const choice=q.opts.indexOf(item(ctx.subject).correct);
  const result=await Q.answer(a,c,'a',{roomId,questionId:q.id,choice},at);
  assert.equal(result.review.correct,true);
  assert.equal(result.review.amount,4);
  assert.equal(result.review.answerIndex,choice);
  assert.ok(result.review.explanation.length>5);
  assert.equal(a.records.get('users/a').stats.totalAnswered,1);
  assert.equal(a.records.get('users/a').stats.totalCorrect,1);
  assert.equal(a.records.get('users/b').stats.totalAnswered,0);
  const stored=a.records.get('dungeonQuizStates/a');
  const applied=Credits.credit(room,'a',stored,q.id,roomId);
  assert.equal(applied.members.a.explorationStamina,97);
  assert.equal(applied.members.b.explorationStamina,70);
  assert.equal(applied.members.a.quizCreditSeq,1);
  assert.equal(Credits.credit({...room,members:applied.members},'a',stored,q.id,roomId).duplicate,true);
  const duplicated=await Q.answer(a,c,'a',{roomId,questionId:q.id,choice:0},at);
  assert.equal(duplicated.review.questionId,q.id);
  assert.equal(a.records.get('users/a').stats.totalAnswered,1);
  assert.equal([...a.records.keys()].filter(v=>v.startsWith('exam_logs/')).length,1);
});
test('two independent answers, out-of-order credits forbidden and cap enforced',async()=>{
  const {a,c,room}=environment();
  const ctx=await Q.prepareQuestion(a,c,'b',roomId,0,at);
  const q=await Q.commitQuestion(a,'b',ctx,item(ctx.subject),at);
  const wrong=q.opts.findIndex(v=>v!==item(ctx.subject).correct);
  const result=await Q.answer(a,c,'b',{roomId,questionId:q.id,choice:wrong},at);
  assert.equal(result.review.correct,false);assert.equal(result.review.amount,1);
  const graded=a.records.get('dungeonQuizStates/b');
  const applied=Credits.credit(room,'b',graded,q.id,roomId);
  assert.equal(applied.members.b.explorationStamina,71);
  assert.equal(applied.members.a.explorationStamina,93);
  assert.throws(()=>Credits.credit(room,'a',graded,q.id,roomId),/不屬於|找不到/);
  assert.throws(()=>Credits.credit(room,'b',graded,'invented',roomId),/找不到/);
  const low={...room,members:{...room.members,b:{...room.members.b,quizCreditSeq:2}}};
  assert.equal(Credits.credit(low,'b',graded,q.id,roomId).duplicate,true);
  const max={...room,members:{...room.members,b:{...room.members.b,explorationStamina:100}}};
  const capped=Credits.credit(max,'b',graded,q.id,roomId);
  assert.equal(capped.credit.granted,0);
  assert.equal(capped.members.b.quizCreditSeq,1);
});
test('invalid room membership, expired session and malformed answer fail closed',async()=>{
  const {a,c,room}=environment();
  await assert.rejects(Q.prepareQuestion(a,c,'x',roomId,0,at),/副本未開始/);
  await assert.rejects(Q.prepareQuestion(a,c,'a',roomId,5,at),/備題位置/);
  const ctx=await Q.prepareQuestion(a,c,'a',roomId,0,at);
  const q=await Q.commitQuestion(a,'a',ctx,item(ctx.subject),at);
  await assert.rejects(Q.answer(a,c,'a',{roomId,questionId:q.id,choice:4},at),/選項無效/);
  await assert.rejects(Q.answer(a,c,'a',{roomId,questionId:'fabricated',choice:0},at),/失效/);
  room.status='closed';c.records.set('dungeonRooms/'+roomId,room);
  await assert.rejects(Q.answer(a,c,'a',{roomId,questionId:q.id,choice:0},at),/副本未開始/);
  assert.equal(a.records.get('users/a').stats.totalAnswered,0);
});
test('answering advances only the individual question cursor, never the C world clock',async()=>{
  const {a,c,room}=environment();
  const context=await Q.prepareQuestion(a,c,'a',roomId,0,at);
  const first=await Q.commitQuestion(a,'a',context,item(context.subject),at);
  const secondContext=await Q.prepareQuestion(a,c,'a',roomId,1,at);
  await Q.commitQuestion(a,'a',secondContext,{
    ...item(secondContext.subject),q:item(secondContext.subject).q+' 後續'},at);
  await Q.answer(a,c,'a',{roomId,questionId:first.id,
    choice:first.opts.indexOf(item(context.subject).correct)},at);
  const state=await Q.state(a,c,'a',roomId,at);
  assert.equal(state.answered,1);
  assert.equal(state.stock,1);
  assert.equal(state.pendingCredits.length,1);
  assert.equal(c.records.get('dungeonRooms/'+roomId).battleAppliedTick,undefined);
  assert.equal((await Q.state(a,c,'b',roomId,at)).answered,0);
});
