'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createService,SESSIONS,RESULTS,dayId}=require('../daily-meditation-api.cjs').__test;
const Literacy=require('../daily-meditation-literacy.cjs');
const Rules=require('../public/cultivation/daily-meditation-rules.js');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const {generated,ready}=require('./helpers/meditation-literacy.cjs');
const INITIAL=Date.parse('2026-11-04T04:00:00Z');
function fixture(level='國中二年級'){
  let time=INITIAL;
  const db=fakeDb({uid:'u1',displayName:'修士',profile:{educationLevel:level},stats:{gold:100,totalScore:68}});
  const service=createService({db,now:()=>time,random:()=>.5});
  return {db,service,advance:ms=>time+=ms,user:()=>db.docs.get('users/u1')};
}
async function answerCurrent(f,correct=true){let session=(await f.service.start('u1')).session;
  session=await ready(f,session);f.advance(1000);
  const saved=f.db.docs.get(SESSIONS+'/'+dayId('u1',session.date));
  return f.service.answer('u1',{questionId:session.question.id,choice:correct?saved.questions[session.index].data.ans:(saved.questions[session.index].data.ans+1)%4,activeMs:1000});
}
test('five fresh daily questions cover the five subjects and bind the saved grade',async()=>{
  const f=fixture('國小四年級');await f.service.start('u1');
  f.user().profile.educationLevel='高中一年級';
  const subjects=[];
  for(let i=0;i<5;i++){
    const expected=await f.service.prepareQuestion('u1');subjects.push(expected.subject);assert.equal(expected.level,'國小四年級');
    const question=await f.service.commitQuestion('u1',expected,generated(expected));
    assert.equal(question.total,5);assert.equal(question.index,i);assert.equal(question.question.correctIdx,undefined);assert.equal(question.question.exp,undefined);
    await answerCurrent(f);if(i<4)await f.service.next('u1');
  }
  assert.deepEqual(new Set(subjects),new Set(['國文','英文','數學','自然','社會']));
  const result=await f.service.finish('u1');assert.equal(result.record.lastResult.total,5);assert.equal(result.record.lastResult.correct,5);
  assert.equal(result.record.lastResult.stars,5);assert.equal(result.record.lastResult.fragments,3);
  const status=await f.service.status('u1');assert.equal(status.personalStars,5);assert.equal(status.personalTotal,5);assert.equal(status.rankings[0].total,5);
  assert.equal(f.db.docs.get('exam_logs/meditation_'+dayId('u1',status.date)).totalCount,5);
  const before=structuredClone(f.user());await f.service.finish('u1');assert.deepEqual(f.user(),before);
});
test('three and four answers cannot settle the new five-question set',async()=>{
  const f=fixture();await f.service.start('u1');
  for(let i=0;i<4;i++){await answerCurrent(f);await assert.rejects(f.service.finish('u1'),/完成五題/);if(i<3)await f.service.next('u1');}
  assert.equal(f.user().stats.gold,100);assert.equal(f.user().dailyMeditation,undefined);
  await f.service.next('u1');await answerCurrent(f,false);const result=await f.service.finish('u1');
  assert.equal(result.record.lastResult.correct,4);assert.equal(result.record.lastResult.gold,23);assert.equal(result.record.lastResult.fragments,0);
});
test('incomplete literacy materials, recall-only format and invalid options cannot be committed',async()=>{
  const f=fixture();await f.service.start('u1');const expected=await f.service.prepareQuestion('u1');
  for(const patch of [{literacy_context:''},{literacy_task:''},{reasoning_steps:1},{question_form:'direct-application'},
    {q:'計算二加二是多少？'},{wrong:['一本想分享的書','其他','選項']},{subject:'數學'}])
    await assert.rejects(f.service.commitQuestion('u1',expected,generated(expected,patch)));
  assert.equal((await f.service.status('u1')).session.question,null);
  assert.ok((await f.service.commitQuestion('u1',expected,generated(expected))).question.id);
});
test('concurrent generation and response-loss retry keep exactly one question without revealing future answers',async()=>{
  const f=fixture();await f.service.start('u1');const expected=await f.service.prepareQuestion('u1');
  const [a,b]=await Promise.all([f.service.commitQuestion('u1',expected,generated(expected)),f.service.commitQuestion('u1',expected,generated(expected,{q:generated(expected).q+'改寫'}))]);
  assert.equal(a.question.id,b.question.id);assert.equal(f.db.docs.get(SESSIONS+'/'+dayId('u1',a.date)).questions.length,1);
  assert.equal((await f.service.prepareQuestion('u1')).pending.question.id,a.question.id);
  assert.equal(a.question.ans,undefined);assert.equal(a.question.correct,undefined);assert.equal(a.questions,undefined);
  await answerCurrent(f);await f.service.next('u1');
  await assert.rejects(f.service.commitQuestion('u1',expected,generated(expected)),/進度已更新/);
});
test('a failed or interrupted question preparation consumes neither reward nor question position',async()=>{
  const f=fixture();const {session}=await f.service.start('u1');
  await assert.rejects(f.service.answer('u1',{questionId:'fabricated',choice:0,activeMs:0}),/題目已更新/);
  assert.equal((await f.service.next('u1')).session.index,0);
  assert.equal((await f.service.start('u1')).session.runId,session.runId);
  const expected=await f.service.prepareQuestion('u1');f.advance(24*3600000);await f.service.start('u1');
  await assert.rejects(f.service.commitQuestion('u1',expected,generated(expected)),/進度已更新/);
  assert.equal((await f.service.status('u1')).personalStars,0);assert.equal(f.user().stats.gold,100);
});
test('legacy three-question sessions can finish once and are labelled with their actual total',async()=>{
  const f=fixture(),date=Rules.meditationDateKey(new Date(INITIAL));
  const questions=Array.from({length:3},(_,i)=>({id:'legacy-'+i,source:'問道錯題',data:{q:'舊版題目'+i,opts:['正確','錯誤'],ans:0,exp:'舊版解析'}}));
  f.db.docs.set(SESSIONS+'/'+dayId('u1',date),{uid:'u1',date,index:0,questions,answers:[],issuedAtMs:INITIAL});
  for(let i=0;i<3;i++){await answerCurrent(f);if(i<2)await f.service.next('u1');}
  const result=await f.service.finish('u1');assert.equal(result.record.lastResult.total,3);assert.equal(result.record.lastResult.gold,45);
  assert.equal((await f.service.status('u1')).personalTotal,3);
  assert.equal((await f.service.start('u1')).completed,true);
});
test('new and old completion records coexist without granting an already-finished day again',async()=>{
  const f=fixture(),date=Rules.meditationDateKey(new Date(INITIAL));
  f.user().dailyMeditation={lastDate:date,lastResult:{correct:3,total:3,gold:45},streak:1,totalDays:1};
  const original=structuredClone(f.user());assert.equal((await f.service.start('u1')).completed,true);
  const status=await f.service.status('u1');assert.equal(status.personalStars,3);assert.equal(status.personalTotal,3);
  await f.service.finish('u1');assert.deepEqual(f.user(),original);
  f.db.docs.get(RESULTS+'/'+dayId('u1',date)).total=5;f.db.docs.get(RESULTS+'/'+dayId('u1',date)).stars=5;
  assert.equal((await f.service.status('u1')).personalStars,5);
});
test('five-star friends contribute their full result while the cooperative pool still caps at fifteen',async()=>{
  const f=fixture(),date=Rules.meditationDateKey(new Date(INITIAL));
  f.user().friends=['u2','u3','u4'];
  for(const uid of f.user().friends){
    f.db.docs.set('users/'+uid,{uid,displayName:uid,friends:['u1']});
    f.db.docs.set(RESULTS+'/'+dayId(uid,date),{uid,date,total:5,stars:5,completed:true,answerTimeMs:2000});
  }
  const before=await f.service.status('u1');assert.equal(before.stars,15);assert.equal(before.claimable,false);
  await f.service.start('u1');for(let i=0;i<5;i++){await answerCurrent(f);if(i<4)await f.service.next('u1');}
  await f.service.finish('u1');const after=await f.service.status('u1');
  assert.equal(after.stars,15);assert.equal(after.rankings.length,4);assert.ok(after.rankings.every(row=>row.stars===5&&row.total===5));
});
test('five-question rewards use a three-correct threshold, full reward only on five, and retain legacy amounts',()=>{
  assert.equal(Rules.MEDITATION_QUESTION_COUNT,5);
  for(const correct of [0,1,2]){assert.equal(Rules.meditationReward(68,1,correct).gold,5);assert.equal(Rules.meditationReward(68,1,correct).cultivation,0);}
  for(const correct of [3,4]){assert.equal(Rules.meditationReward(68,1,correct).gold,23);assert.equal(Rules.meditationReward(68,1,correct).cultivation,2);}
  assert.equal(Rules.meditationReward(68,1,5).gold,45);assert.equal(Rules.meditationReward(68,1,3,3).gold,45);
});
test('generation pipeline authenticates, fixes grade and subject, restricts forms, validates literacy and shares spare candidates',()=>{
  const source=fs.readFileSync('server.js','utf8');
  assert.match(source,/const meditationMode = String\(quizMode \|\| ''\) === 'meditation-literacy'/);
  const route=source.slice(source.indexOf('    if (meditationMode) {'),source.indexOf('    if(req.body?.adaptiveScope)'));
  assert.match(route,/verifyMainIdentity\(req\)/);assert.match(route,/service.prepareQuestion\(uid\)/);
  assert.match(route,/subject = meditationContext.subject; level = meditationContext.level/);
  assert.match(source,/forms:meditationMode\?MeditationLiteracy.FORMS:QUESTION_FORMS/);
  assert.match(source,/MeditationLiteracy.assertQuestion\(parsed,meditationContext\)/);
  assert.match(source,/MeditationLiteracy.prompt\(meditationContext\)/);
  assert.match(source,/meditationMode \? `meditation:/);assert.match(source,/meditationSession:session/);
  for(const domain of Literacy.plan({profile:{educationLevel:'國小六年級'}})){
    const prompt=Literacy.prompt({...domain,index:0});assert.match(prompt,/至少兩項資訊|依證據推論/);assert.match(prompt,/literacy_context/);
  }
});
