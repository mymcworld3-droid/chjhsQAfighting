'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const {createService,createHandler,dayId,SESSIONS,RESULTS}=require('../daily-meditation-api.cjs').__test;
const Rules=require('../public/cultivation/daily-meditation-rules.js');
const Growth=require('../public/cultivation/nascent-growth.js');
const Pool=require('../public/cultivation/soulbound-pool.js');
const {transaction:draw}=require('../soulbound-draw-api.cjs').__test;
const date='2026-10-16',initialTime=Date.parse('2026-10-16T04:00:00Z');
function fixture(extra={}) {
  let time=initialTime,queries=0;
  const db=fakeDb({uid:'u1',displayName:'你',stats:{totalScore:28,gold:0},friends:[],...extra});
  const collection=db.collection.bind(db);
  db.collection=name=>{
    const original=collection(name);let filters=[],maximum=250;
    const result={doc:id=>original.doc(id),where(key,op,value){filters.push([key,value]);return result;},orderBy(){return result;},limit(n){maximum=n;return result;},
      async get(){queries++;return {docs:[...db.docs].filter(([key,value])=>key.startsWith(name+'/')&&filters.every(([k,v])=>value[k]===v)).slice(0,maximum).map(([,value])=>({data:()=>structuredClone(value)}))};}};
    return result;
  };
  for(let i=0;i<3;i++)db.docs.set('exam_logs/old'+i,{uid:'u1',mode:'infinite',question:'歷史錯題'+i,options:['正確','錯誤'],correctIdx:0,userIdx:1,isCorrect:false,timestamp:initialTime-i});
  const service=createService({db,now:()=>time,random:()=>.5});
  return {db,service,user:()=>db.docs.get('users/u1'),advance:ms=>time+=ms,setTime:ms=>time=ms,queries:()=>queries};
}
function friend(f,id,stars,time=1000,{mutual=true,completed=true}={}) {
  f.user().friends.push(id);
  f.db.docs.set('users/'+id,{uid:id,displayName:'好友 '+id,friends:mutual?['u1']:[],stats:{totalScore:28}});
  if(completed)f.db.docs.set(RESULTS+'/'+dayId(id,date),{uid:id,date,completed:true,stars,answerTimeMs:time,rewardScore:28,claimed:[]});
}
async function complete(f,correct=3) {
  let {session}=await f.service.start('u1');
  for(let index=0;index<3;index++){
    f.advance(2000);
    const result=await f.service.answer('u1',{questionId:session.question.id,choice:index<correct?0:1,activeMs:1000});
    session=result.session;
    if(index<2)session=(await f.service.next('u1')).session;
  }
  return f.service.finish('u1');
}

test('server selects three real distinct historical mistakes, hides future answers and resumes the same daily session',async()=>{
  const f=fixture(),a=await f.service.start('u1'),b=await f.service.start('u1');
  assert.equal(a.session.question.id,b.session.question.id);assert.equal(f.queries(),1);
  assert.equal(a.session.question.ans,undefined);assert.equal(a.session.question.correctIdx,undefined);assert.equal(a.session.question.exp,undefined);
  assert.equal(new Set(f.db.docs.get(SESSIONS+'/'+dayId('u1',date)).questions.map(x=>x.data.q)).size,3);
});
test('fewer than three mistakes does not create a session or spend the daily attempt',async()=>{
  const f=fixture();f.db.docs.delete('exam_logs/old2');
  await assert.rejects(f.service.start('u1'),/只有 2 道/);
  assert.equal(f.db.docs.has(SESSIONS+'/'+dayId('u1',date)),false);assert.equal(f.user().dailyMeditation,undefined);
});
test('client claims of correct answers and stars are ignored; repeated answers cannot change score or answer choice',async()=>{
  const f=fixture(),{session}=await f.service.start('u1');f.advance(2000);
  const body={questionId:session.question.id,choice:1,activeMs:1000,isCorrect:true,stars:999};
  const a=await f.service.answer('u1',body),b=await f.service.answer('u1',body);
  assert.equal(a.session.correct,0);assert.deepEqual(a,b);assert.equal(a.session.feedback.correctIdx,0);
  await assert.rejects(f.service.answer('u1',{...body,choice:0}),/不能更換/);
  await assert.rejects(f.service.finish('u1'),/完成三題/);
});
test('unknown question, invalid choice, invalid timing and attempts to skip ahead are rejected',async()=>{
  const f=fixture(),{session}=await f.service.start('u1');
  assert.equal((await f.service.next('u1')).session.index,0);
  await assert.rejects(f.service.answer('u1',{questionId:'forged',choice:0,activeMs:100}),/題目已更新/);
  await assert.rejects(f.service.answer('u1',{questionId:session.question.id,choice:9,activeMs:100}),/有效答案/);
  await assert.rejects(f.service.answer('u1',{questionId:session.question.id,choice:0,activeMs:-1}),/時間無效/);
});
test('personal settlement, quest credit, log and result are atomic and response-loss retry cannot award twice',async()=>{
  const f=fixture(),a=await complete(f),before=structuredClone(f.user());
  assert.equal(a.record.lastResult.stars,3);assert.equal(a.record.lastResult.answerTimeMs,3000);
  assert.equal(f.user().stats.gold,30);assert.equal(f.user().dailyMeditation.totalDays,1);
  assert.equal(f.user().questProgress.daily.counts.meditation,1);
  assert.ok(f.db.docs.has('exam_logs/meditation_'+dayId('u1',date)));
  const b=await f.service.finish('u1');assert.deepEqual(b.record,a.record);assert.deepEqual(f.user(),before);
});
test('clock is capped by server issue time and excludes time spent on the previous explanation',async()=>{
  const f=fixture(),a=await f.service.start('u1');f.advance(2000);
  await f.service.answer('u1',{questionId:a.session.question.id,choice:0,activeMs:999999999});
  f.advance(60000);const b=await f.service.next('u1');f.advance(1000);
  await f.service.answer('u1',{questionId:b.session.question.id,choice:0,activeMs:500});
  const answers=f.db.docs.get(SESSIONS+'/'+dayId('u1',date)).answers;
  assert.equal(answers[0].activeMs,2000);assert.equal(answers[1].activeMs,500);
});
test('only mutual direct friends count, duplicates count once and the shared pool caps at fifteen',async()=>{
  const f=fixture();for(let i=2;i<=8;i++)friend(f,'u'+i,3,1000*i);
  f.user().friends.push('u2','u2');friend(f,'oneway',3,0,{mutual:false});friend(f,'pending',3,0,{completed:false});
  const before=await f.service.status('u1');assert.equal(before.stars,15);assert.deepEqual(before.rankings,[]);assert.equal(before.claimable,false);
  await assert.rejects(f.service.claim('u1',{stars:3}),/自己的三題/);
  await complete(f,2);const after=await f.service.status('u1');assert.equal(after.stars,15);
  assert.equal(after.rankings.length,8);assert.equal(after.rankings.some(x=>['pending','oneway'].includes(x.uid)),false);
  assert.equal(after.rankings.filter(x=>x.uid==='u2').length,1);assert.equal(after.rankings.at(-1).uid,'u1');
});
test('all five rewards total six base gold, three essence, one raid ticket and one soulbound ticket',async()=>{
  const f=fixture();for(let i=2;i<=5;i++)friend(f,'u'+i,3);
  await complete(f);const before=f.user().stats.gold;
  for(const stars of [3,6,9,12,15]){
    const result=await f.service.claim('u1',{stars,date});assert.equal(result.claimedNow,true);
  }
  assert.equal(f.user().stats.gold-before,180);assert.equal(f.user().materialSystem.inventory[Growth.ITEM_ID],3);
  assert.equal(f.user().soulboundDrawTickets,1);assert.equal(f.user().raidTickets.count,3);assert.equal(f.user().raidTickets.dailyGrant,2);
  assert.equal((await f.service.status('u1')).claimable,false);
});
test('concurrent claims and transaction retries award a node once without resetting spent balances',async()=>{
  const f=fixture();for(let i=2;i<=5;i++)friend(f,'u'+i,3);await complete(f);
  f.db.retryNextTransaction();const responses=await Promise.all(Array.from({length:6},()=>f.service.claim('u1',{stars:15,date})));
  assert.equal(responses.filter(x=>x.claimedNow).length,1);assert.equal(f.user().soulboundDrawTickets,1);
  f.user().soulboundDrawTickets=0;f.user().stats.gold=0;
  const retry=await f.service.claim('u1',{stars:15,date});assert.equal(retry.claimedNow,false);assert.equal(f.user().soulboundDrawTickets,0);assert.equal(f.user().stats.gold,0);
});
test('failed claim transaction changes neither its receipt nor player balances',async()=>{
  const f=fixture();for(let i=2;i<=5;i++)friend(f,'u'+i,3);await complete(f);
  const original=f.db.runTransaction.bind(f.db);f.db.runTransaction=worker=>original(async tx=>{
    await worker({...tx,set(ref,value){if(ref.key.startsWith(RESULTS+'/'))throw Error('offline');tx.set(ref,value);}});
  });
  const before=structuredClone(f.user());await assert.rejects(f.service.claim('u1',{stars:15,date}),/offline/);assert.deepEqual(f.user(),before);
  assert.deepEqual(f.db.docs.get(RESULTS+'/'+dayId('u1',date)).claimed,[]);
});
test('ticket cap converts the extra raid entry to two base gold, but still grants the draw ticket',async()=>{
  const f=fixture({raidTickets:{count:10,lastGrantDate:date}});for(let i=2;i<=5;i++)friend(f,'u'+i,3);await complete(f);
  const before=f.user().stats.gold,result=await f.service.claim('u1',{stars:15,date});
  assert.equal(f.user().raidTickets.count,5);assert.equal(f.user().stats.gold-before,90);assert.equal(result.reward.drawTickets,1);
});
test('friend completing later unlocks a red-dot reward; stars persist after a completed friend leaves',async()=>{
  const f=fixture();friend(f,'u2',0,0,{completed:false});await complete(f);
  await f.service.claim('u1',{stars:3,date});assert.equal((await f.service.status('u1')).claimable,false);
  f.db.docs.set(RESULTS+'/'+dayId('u2',date),{uid:'u2',date,completed:true,stars:3,answerTimeMs:4000});
  const next=await f.service.status('u1');assert.equal(next.stars,6);assert.equal(next.claimable,true);
  f.db.docs.get('users/u2').friends=[];
  const removed=await f.service.status('u1');assert.equal(removed.stars,6);assert.equal(removed.rankings.length,1);
});
test('legacy personal completion is preserved and missing old timing does not outrank timed results',async()=>{
  const f=fixture({dailyMeditation:{lastDate:date,streak:4,totalDays:8,lastResult:{correct:3,gold:45}}});friend(f,'u2',3,5000);
  const before=structuredClone(f.user()),s=await f.service.status('u1');assert.equal(s.rankings[0].uid,'u2');
  assert.equal(s.rankings[1].answerTimeMs,null);assert.equal(s.stars,6);
  await f.service.finish('u1');assert.deepEqual(f.user(),before);
});
test('Taiwan midnight creates a new day and rejects stale questions and stale reward claims',async()=>{
  const f=fixture(),a=await f.service.start('u1');f.setTime(Date.parse('2026-10-16T16:00:00Z'));
  await assert.rejects(f.service.answer('u1',{questionId:a.session.question.id,choice:0,activeMs:100}),/尚未開始/);
  await assert.rejects(f.service.claim('u1',{stars:3,date}),/已跨日/);
  const next=await f.service.status('u1');assert.equal(next.date,'2026-10-17');assert.equal(next.stars,0);assert.equal(next.completed,false);
});
test('unattained and invalid nodes are rejected and reward base is frozen at personal completion',async()=>{
  const f=fixture();await complete(f);await assert.rejects(f.service.claim('u1',{stars:4}),/節點/);await assert.rejects(f.service.claim('u1',{stars:6}),/尚未達到/);
  f.user().stats.totalScore=2588;const result=await f.service.claim('u1',{stars:3,date});assert.equal(result.reward.gold,30);
});
test('ranking prioritizes accuracy, then active time, with shared ranks for exact ties',()=>{
  const rows=Rules.rankMeditators([{uid:'a',stars:2,answerTimeMs:100},{uid:'b',stars:3,answerTimeMs:2000},{uid:'c',stars:3,answerTimeMs:2000},{uid:'d',stars:3,answerTimeMs:null}]);
  assert.deepEqual(rows.map(x=>[x.uid,x.rank]),[['b',1],['c',1],['d',3],['a',4]]);
});
test('server authentication ignores body uid and rejects missing, revoked and other-project tokens',async()=>{
  const f=fixture();const handler=createHandler({resolveA:()=>({db:f.db,auth:{verifyIdToken:async token=>{
    if(token==='revoked')throw Error('expired');return {uid:'u1',aud:token==='other'?'wrong':'question-learning',iss:'https://securetoken.google.com/question-learning'};
  }}}),now:()=>initialTime,logger:{error(){}}});
  async function request(token){let code=200,result;await handler({body:{uid:'outsider'},get:()=>token?'Bearer '+token:''},{set(){},status(n){code=n;return this;},json(value){result=value;return this;}});return {code,result};}
  for(const token of ['', 'revoked','other'])assert.equal((await request(token)).code,401);
  assert.equal((await request('valid')).result.ok,true);
});
test('a fifteen-star voucher can immediately draw in the same permanent pool and shared pity without spending gold',async()=>{
  const f=fixture();for(let i=2;i<=5;i++)friend(f,'u'+i,3);await complete(f);await f.service.claim('u1',{stars:15,date});
  f.db.docs.set('soulboundDrawStates/u1',{draws:10,misses:49,poolVersion:Pool.VERSION});
  const gold=f.user().stats.gold,result=await draw(f.db,'u1','draw',{count:1,payment:'ticket',expectedCost:0,poolVersion:Pool.VERSION,requestId:'meditation-draw-voucher-001'},()=>.5);
  assert.equal(result.drawTickets,0);assert.equal(result.balance,gold);assert.equal(result.result.results[0].pity,true);assert.equal(result.result.results[0].paid,0);
});
module.exports={fixture,complete,friend};
