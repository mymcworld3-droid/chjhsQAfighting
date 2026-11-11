'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=Date.now();
const parsed=index=>({
  q:'問道雙題功能測試：請求第 '+index+' 題，正確答案為 5，請判斷。',
  correct:'5',wrong:['1','2','3'],exp:'依照題目敘述，唯一的正確答案是 5。'
});
async function prepare(db,id,slot=0){
  const expected=await api.prepareQuestion(db,'u1',id,now,slot);
  return api.commitQuestion(db,'u1',expected,parsed(slot+1),now);
}
async function setup(){
  const db=database(),room=await api.start(db,'u1',{mode:'pve'},now);
  return {db,id:room.id,room:()=>db.records.get(api.ROOMS+'/'+room.id)};
}

test('two verified questions are reserved before answering without exposing answer indices',async()=>{
  const f=await setup();
  const first=await prepare(f.db,f.id,0);
  const followup=await prepare(f.db,f.id,1);
  assert.notEqual(first.id,followup.id);
  assert.equal(first.answerIndex,undefined);
  assert.equal(followup.answerIndex,undefined);
  const current=f.room();
  assert.equal(current.pending.u1.id,first.id);
  assert.equal(current.pendingFollowup.u1.id,followup.id);
  const snapshot=api.snapshot(current,'u1');
  assert.equal(snapshot.question.id,first.id);
  assert.equal(snapshot.questionFollowup.id,followup.id);
  assert.equal('pendingFollowup' in snapshot,false);
  assert.equal('reviewHistory' in snapshot,false);
  assert.equal(JSON.stringify(snapshot).includes('"answerIndex"'),false);
  const repeat=await prepare(f.db,f.id,1);
  assert.equal(repeat.id,followup.id,'retries reuse the existing second question');
});

test('one submission of two choices grants independent rewards, without a second quiz screen',async()=>{
  const f=await setup();
  const first=await prepare(f.db,f.id);
  const second=await prepare(f.db,f.id,1);
  const firstCorrect=f.room().pending.u1.answerIndex;
  const one=await api.answer(f.db,'u1',{roomId:f.id,questionId:first.id,choice:firstCorrect},now+1);
  assert.equal(one.question.id,second.id,'the reserved second question is promoted immediately');
  assert.equal(one.questionFollowup,null);
  assert.equal(one.review.questionId,first.id);
  const two=await api.answer(f.db,'u1',{roomId:f.id,questionId:second.id,choice:(f.room().pending.u1.answerIndex+1)%4},now+2);
  assert.equal(two.question,null);
  assert.equal(two.review.questionId,second.id);
  assert.equal(two.actors.find(a=>a.uid==='u1').questions,2);
  assert.equal(two.progress.stats.totalAnswered,2);
  assert.equal(two.progress.stats.totalCorrect,1);
  assert.equal(f.room().pending.u1,undefined);
  const replay=await api.answer(f.db,'u1',{roomId:f.id,questionId:second.id,choice:0},now+3);
  assert.equal(replay.progress.stats.totalAnswered,2,'repeat submissions cannot duplicate rewards');
});

test('an approved report can skip the reserved second question without discarding the first',async()=>{
  const f=await setup(),first=await prepare(f.db,f.id),second=await prepare(f.db,f.id,1);
  const result=await api.reportQuestion(f.db,'u1',{
    roomId:f.id,questionId:second.id,reason:'第二題條件有明顯的錯誤'
  },{
    review:async()=>({status:'confirmed',reason:'已確認條件錯誤',issueType:'conditions'}),
    award:async()=>({compensated:false})
  });
  assert.equal(result.questionSkipped,true);
  assert.equal(result.staminaAdded,4);
  assert.equal(result.battle.question.id,first.id);
  assert.equal(result.battle.questionFollowup,null);
  assert.equal(f.room().actors[0].questions,1);
  await assert.rejects(
    api.answer(f.db,'u1',{roomId:f.id,questionId:second.id,choice:0},now+2),
    /失效/
  );
});
