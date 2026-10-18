'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=require('../enlightenment-trial-api.cjs').__test;
const tickets=require('../raid-question-ticket.cjs');
const baseEnv=process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=JSON.stringify({
  type:'service_account',project_id:'question-learning',
  private_key:'-----BEGIN PRIVATE KEY-----\nnonsecret-test-key\n-----END PRIVATE KEY-----',
  client_email:'enlightenment-test@question-learning.iam.gserviceaccount.com'
});
test.after(()=>{if(baseEnv===undefined)delete process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
  else process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=baseEnv;});
function database(user={}){
  const records=new Map([['users/u1',structuredClone(user)]]);
  const ref=(key)=>({key,get:async()=>snap(key)});
  const snap=key=>({exists:records.has(key),data:()=>structuredClone(records.get(key))});
  let queue=Promise.resolve();
  return {records,collection(name){return {doc(id){return ref(name+'/'+id);}};},
    runTransaction(callback){
      const work=queue.then(async()=>{
        const updates=new Map(),reads=[];
        const tx={
          async get(target){if(updates.size)throw Error('reads-after-writes');reads.push(target.key);return snap(target.key);},
          set(target,value){updates.set(target.key,structuredClone(value));},
          update(target,patch){
            const before=updates.has(target.key)?updates.get(target.key):records.get(target.key);
            const copy=structuredClone(before);
            for(const [key,val] of Object.entries(patch)){
              const parts=key.split('.');let cursor=copy;
              for(let i=0;i<parts.length-1;i++){cursor[parts[i]]??={};cursor=cursor[parts[i]];}
              cursor[parts.at(-1)]=structuredClone(val);
            }
            updates.set(target.key,copy);
          }
        };
        const value=await callback(tx);
        for(const [key,doc] of updates)records.set(key,doc);
        return value;
      });
      queue=work.catch(()=>{});
      return work;
    }
  };
}
function user(){
  return {uid:'u1',profile:{educationLevel:'國中二年級'},
    stats:{totalScore:30,gold:70,totalAnswered:11,totalCorrect:4,
      knowledgeMap:{數學:{二次函數:{total:8,correct:1},一次方程式:{total:7,correct:7}},
        英文:{單字:{total:2,correct:0}}}}};
}
const parsed=n=>({q:'請計算 '+n+' 與二次函數的根如何相關？',correct:'判別式',wrong:['一次項係數','常數項','未知數名稱'],exp:'判別式可用來判斷二次方程式的根。'});
test('weakness selection ignores unmeasured topics and uses conservative knowledge estimate',()=>{
  const values=rules.candidateWeaknesses(user().stats.knowledgeMap);
  assert.equal(values.length,1);
  assert.equal(values[0].subject,'數學');
  assert.equal(values[0].topic,'二次函數');
  assert.equal(values[0].total,8);
  assert.deepEqual(rules.candidateWeaknesses({英文:{單字:{total:3,correct:0}}}),[]);
  assert.equal(rules.titleFor(1),'悟道學徒');
  assert.equal(rules.titleFor(3),'辨惑行者');
  assert.equal(rules.titleFor(7),'明心悟道');
});
test('start is persistent, same-day idempotent during active and rejects repeat after completion',async()=>{
  const db=database(user()),now=Date.now();
  const first=await rules.start(db,'u1',{subject:'數學',topic:'二次函數'},now);
  const second=await rules.start(db,'u1',{},now);
  assert.equal(first.runId,second.runId);
  assert.equal(first.level,'國中二年級');
  assert.equal(first.index,0);
  assert.equal(first.topic,'二次函數');
  const raw=db.records.get('enlightenmentTrialStates/u1');
  assert.equal(raw.status,'active');
});
test('fixed knowledge weaknesses start a matching trial and recorded answers retain their knowledge point',async()=>{
  const player=user();player.stats.knowledgePointMapV1={數學:{'math-4':{total:8,correct:1}}};
  const db=database(player),trial=await rules.start(db,'u1',{subject:'數學',topic:'函數與圖形'});
  assert.equal(trial.topic,'函數與圖形');
  const expected=await rules.prepareQuestion(db,'u1');assert.equal(expected.knowledgePointId,'math-4');
  const q=await rules.commitQuestion(db,'u1',expected,{...parsed(1),knowledge_subject:'數學',knowledge_point_id:'math-4',knowledge_point:'函數與圖形'});
  assert.equal(q.knowledge_point_id,'math-4');
  const ticket=tickets.readRaidQuestionTicket(q.ticket);
  await submit(db,q,trial,ticket.answerIndex);
  assert.deepEqual(db.records.get('users/u1').stats.knowledgePointMapV1.數學['math-4'],{total:9,correct:2});
  await assert.rejects(submit(db,q,trial,ticket.answerIndex));
  assert.equal(db.records.get('users/u1').stats.knowledgePointMapV1.數學['math-4'].total,9);
});
async function submit(db,question,trial,choice,now=Date.now()){
  return rules.answer(db,'u1',{runId:trial.runId,index:trial.index,questionId:question.id,
    ticket:question.ticket,choice},now);
}
test('five trusted answers earn one-time mastery reward and cannot replay tickets or mint duplicate questions',async()=>{
  const db=database(user());
  let state=await rules.start(db,'u1');
  const original=state.runId;
  for(let i=0;i<5;i++){
    const req=await rules.prepareQuestion(db,'u1');
    assert.equal(req.runId,original);
    assert.equal(req.index,i);
    const q=await rules.commitQuestion(db,'u1',req,parsed(i));
    const duplicate=await rules.commitQuestion(db,'u1',req,parsed(i+100));
    assert.equal(q.id,duplicate.id,'concurrent generation cannot replace issued question');
    const token=tickets.readRaidQuestionTicket(q.ticket);
    const choice=i===4?(token.answerIndex+1)%4:token.answerIndex;
    const result=await submit(db,q,state,choice);
    assert.equal(result.review.correct,i<4);
    assert.equal(result.review.correctIndex,token.answerIndex);
    assert.ok(result.review.explanation);
    state=result.state;
    await assert.rejects(submit(db,q,{...state,index:i},choice),/已結算|進度不符/);
  }
  assert.equal(state.status,'completed');
  assert.equal(state.success,true);
  assert.equal(state.correct,4);
  assert.equal(state.masteryCount,1);
  assert.equal(state.title,'悟道學徒');
  assert.equal(state.rewarded,true);
  assert.deepEqual(state.reward,{gold:45,cultivation:3});
  const saved=db.records.get('users/u1');
  assert.equal(saved.stats.gold,115);
  assert.equal(saved.stats.totalScore,33);
  assert.equal(saved.stats.knowledgeMap.數學.二次函數.total,13);
  assert.equal(saved.stats.knowledgeMap.數學.二次函數.correct,5);
  assert.equal(saved.stats.totalAnswered,16);
  assert.equal(saved.stats.totalCorrect,8);
  assert.equal(Object.keys(saved.enlightenmentProgress.masteredTopics).length,1);
  await assert.rejects(rules.start(db,'u1'),/今日悟道試煉已結束/);
});
test('wrong responses still count as learning, but never earn gold or mastery',async()=>{
  const db=database(user());
  let state=await rules.start(db,'u1');
  for(let i=0;i<5;i++){
    const prepared=await rules.prepareQuestion(db,'u1');
    const q=await rules.commitQuestion(db,'u1',prepared,parsed(i));
    const correct=tickets.readRaidQuestionTicket(q.ticket).answerIndex;
    const result=await submit(db,q,state,(correct+1)%4);
    state=result.state;
  }
  assert.equal(state.success,false);
  assert.equal(state.rewarded,false);
  assert.equal(state.reward.gold,0);
  assert.equal(db.records.get('users/u1').stats.totalScore,30);
  assert.equal(db.records.get('users/u1').stats.knowledgeMap.數學.二次函數.total,13);
});
test('ticket cannot be accepted by a different user, wrong question or wrong round',async()=>{
  const db=database(user()),state=await rules.start(db,'u1');
  const prepared=await rules.prepareQuestion(db,'u1');
  const q=await rules.commitQuestion(db,'u1',prepared,parsed(0));
  await assert.rejects(rules.answer(db,'u1',{runId:state.runId,index:4,questionId:q.id,ticket:q.ticket,choice:0}),/不符/);
  await assert.rejects(rules.answer(db,'u1',{runId:state.runId,index:0,questionId:'forged',ticket:q.ticket,choice:0}),/不符/);
  await assert.rejects(rules.answer(db,'u2',{runId:state.runId,index:0,questionId:q.id,ticket:q.ticket,choice:0}),/不符/);
  assert.equal(db.records.get('enlightenmentTrialStates/u1').index,0);
});
test('UI is installed in learning insights, server only issues redacted questions',()=>{
  const file=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
  const ui=file('public/cultivation/ability-insights-ui.js');
  const main=file('public/main.js');
  const server=file('server.js');
  const trialUI=file('public/cultivation/enlightenment-trial-ui.js');
  assert.match(ui,/data-ability-start/);
  assert.match(main,/enlightenment-trial-ui\.js/);
  assert.match(server,/registerEnlightenmentTrialApi\(app\)/);
  assert.match(server,/enlightenmentTrial\.commitQuestion/);
  assert.match(trialUI,/authenticatedMainFetch/);
  assert.match(trialUI,/quizMathRichText/);
  assert.doesNotMatch(trialUI,/correct:\s*true/);
});
