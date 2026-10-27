'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../tactical-combat-api.cjs').__test;
const reports=require('../question-report-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=Date.now(),parsed={q:'計算二加三的結果是多少？',correct:'5',wrong:['1','2','3'],exp:'二加三等於五。'};
const confirmed={status:'confirmed',reason:'題目條件互相矛盾，應作廢。',issueType:'conditions'};
const fieldValue={increment:amount=>({refundTestIncrement:amount}),serverTimestamp:()=>now};

function fixtureDb(){
  const db=database(),run=db.runTransaction.bind(db);
  db.runTransaction=callback=>run(tx=>{
    const set=tx.set,update=tx.update;
    tx.create=(ref,value)=>{assert.equal(db.records.has(ref.key),false);set(ref,value);};
    tx.set=(ref,value)=>{
      if(db.failRefund&&ref.key.startsWith(api.ROOMS+'/')&&value.questionRefunds){db.failRefund=false;throw Error('refund transaction failed');}
      set(ref,value);
    };
    tx.update=(ref,patch)=>{
      const values={...patch};
      for(const [key,value]of Object.entries(values))if(Number.isFinite(value?.refundTestIncrement)){
        const before=key.split('.').reduce((v,k)=>v?.[k],db.records.get(ref.key));values[key]=(before||0)+value.refundTestIncrement;
      }
      update(ref,values);
    };
    return callback(tx);
  });
  return db;
}
const deps={review:async()=>confirmed,award:(db,uid,input,result)=>reports.awardOnce(db,uid,input,result,{fieldValue})};
async function question(db,id,ordinal=0){
  const expected=await api.prepareQuestion(db,'u1',id,now+ordinal);
  return api.commitQuestion(db,'u1',expected,{...parsed,q:parsed.q+'（'+ordinal+'）'},now+ordinal);
}
async function setup(stamina=2){
  const db=fixtureDb(),s=await api.start(db,'u1',{mode:'pve'},now),raw=db.records.get(api.ROOMS+'/'+s.id);
  raw.actors[0].stamina=stamina;
  const q=await question(db,s.id);return {db,id:s.id,q};
}
const raw=f=>f.db.records.get(api.ROOMS+'/'+f.id);
const input=f=>({roomId:f.id,questionId:f.q.id,reason:'題目的條件互相矛盾',stamina:999,correctIndex:0});
async function answer(f,correct=false){const q=raw(f).pending.u1,choice=correct?q.answerIndex:(q.answerIndex+1)%4;return api.answer(f.db,'u1',{roomId:f.id,questionId:q.id,choice},now+1);}
const report=f=>api.reportQuestion(f.db,'u1',input(f),deps);

test('confirmed wrong answers receive only missing stamina, with authoritative progress and a recovery event',async()=>{
  const f=await setup();await answer(f);assert.equal(raw(f).actors[0].stamina,3);
  const out=await report(f);assert.equal(out.staminaAdded,3);assert.equal(out.staminaRefunded,3);
  assert.equal(out.questionSkipped,false);assert.equal(out.battle.actors[0].stamina,6);
  assert.equal(out.battle.progress.stats.gold,100);assert.equal(out.battle.progress.stats.totalScore,31);
  assert.equal(raw(f).actors[0].questions,1);assert.equal(raw(f).actors[0].answered,1);
  assert.equal(raw(f).actors[0].correct,0,'invalid questions do not mint correct-answer credit');
  assert.equal(raw(f).events.at(-1).animation.kind,'answer');
  assert.equal('answerStamina'in out.battle,false);assert.equal('questionRefunds'in out.battle,false);
});

test('unanswered confirmed questions are skipped once, earn correct-answer stamina and consume one question opportunity',async()=>{
  const f=await setup(),out=await report(f);
  assert.equal(out.staminaAdded,4);assert.equal(out.questionSkipped,true);assert.equal(out.battle.question,null);
  assert.equal(raw(f).actors[0].stamina,6);assert.equal(raw(f).actors[0].questions,1);
  assert.equal(raw(f).actors[0].answered,0);assert.equal(f.db.records.get('users/u1').stats.totalAnswered,undefined);
  await assert.rejects(api.answer(f.db,'u1',{roomId:f.id,questionId:f.q.id,choice:0},now+2),/失效/);
  const next=await question(f.db,f.id,1);assert.notEqual(next.id,f.q.id);
});

test('the answer-time cap is preserved after spending stamina; already-correct answers receive no extra stamina',async()=>{
  for(const [start,spent,correct,expected]of [[8,0,false,1],[9,0,false,0],[8,6,false,1],[2,0,true,0]]){
    const f=await setup(start);await answer(f,correct);raw(f).actors[0].stamina-=spent;
    const before=raw(f).actors[0].stamina,out=await report(f);
    assert.equal(out.staminaAdded,expected);assert.equal(raw(f).actors[0].stamina,before+expected);
    assert.ok(raw(f).actors[0].stamina<=10);
  }
  const full=await setup(9),out=await report(full);assert.equal(out.staminaAdded,1);assert.equal(raw(full).actors[0].stamina,10);
});

test('concurrent reports and response-loss replays cannot duplicate stamina, currency, question slots or events',async()=>{
  const f=await setup(),[a,b]=await Promise.all([report(f),report(f)]);
  assert.equal(a.staminaAdded+b.staminaAdded,4);assert.equal(raw(f).actors[0].stamina,6);
  assert.equal(raw(f).actors[0].questions,1);assert.equal(f.db.records.get('users/u1').stats.gold,100);
  const revision=raw(f).revision,events=raw(f).events.length;
  const replay=await api.reportQuestion(f.db,'u1',input(f),{review:()=>{throw Error('must not review again');}});
  assert.equal(replay.staminaAdded,0);assert.equal(replay.staminaRefunded,4);assert.equal(replay.battle.actors[0].stamina,6);
  assert.equal(raw(f).revision,revision);assert.equal(raw(f).events.length,events);
});

test('rejected or unavailable reports cannot grant stamina or change the pending question',async()=>{
  for(const result of [{status:'rejected',reason:'題目正確'},{status:'unavailable',reason:'審核暫時無法使用'}]){
    const f=await setup(),before=structuredClone([...f.db.records]);
    const pending=api.reportQuestion(f.db,'u1',input(f),{review:async()=>result,award:()=>{throw Error('must not award');}});
    if(result.status==='unavailable')await assert.rejects(pending,/暫時/);else assert.equal((await pending).status,'rejected');
    assert.deepEqual([...f.db.records],before);
  }
});

test('currency daily limits do not block a confirmed gameplay stamina correction',async()=>{
  const f=await setup();await answer(f);f.db.records.get('users/u1').questionReportDaily={date:reports.dateInTaiwan(),count:reports.DAILY_LIMIT};
  const out=await report(f);assert.equal(out.compensated,false);assert.equal(out.staminaAdded,3);
  assert.equal(raw(f).actors[0].stamina,6);assert.equal(f.db.records.get('users/u1').stats.gold,0);assert.match(out.reason,/上限/);
});

test('an award committed before a failed refund can retry without another AI review or another currency grant',async()=>{
  const f=await setup();await answer(f);f.db.failRefund=true;
  await assert.rejects(report(f),/refund transaction failed/);
  assert.equal(f.db.records.get('users/u1').stats.gold,100);assert.equal(raw(f).actors[0].stamina,3);
  const out=await api.reportQuestion(f.db,'u1',input(f),{...deps,review:()=>{throw Error('persisted approval must be reused');}});
  assert.equal(out.staminaAdded,3);assert.equal(out.compensated,false);assert.equal(raw(f).actors[0].stamina,6);
  assert.equal(f.db.records.get('users/u1').stats.gold,100);
});

test('a confirmation arriving after another answer still compensates its original question only',async()=>{
  const f=await setup();let finish;const waiting=api.reportQuestion(f.db,'u1',input(f),{...deps,review:()=>new Promise(resolve=>finish=resolve)});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await answer(f);await question(f.db,f.id,1);await answer(f,true);
  assert.notEqual(raw(f).reviews.u1.questionId,f.q.id);assert.equal(raw(f).actors[0].stamina,7);
  finish(confirmed);const out=await waiting;assert.equal(out.staminaAdded,3);assert.equal(raw(f).actors[0].stamina,10);
  assert.equal(raw(f).actors[0].questions,2);assert.equal(out.questionSkipped,false);
});

test('finished rooms and later trials cannot receive stamina from a delayed report',async()=>{
  const f=await setup();let finish;const pending=api.reportQuestion(f.db,'u1',input(f),{...deps,review:()=>new Promise(resolve=>finish=resolve)});
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await api.command(f.db,'u1',{roomId:f.id,type:'leave',requestId:'leave-refund-test'},now+2);
  const next=await api.start(f.db,'u1',{mode:'pve'},now+3);assert.notEqual(next.id,f.id);
  finish(confirmed);const out=await pending;assert.equal(out.staminaAdded,0);assert.equal(out.questionSkipped,false);
  assert.equal(f.db.records.get(api.ROOMS+'/'+next.id).actors[0].stamina,2);
});

test('claims for a different explanation do not bypass independent review, and nonmembers cannot refund',async()=>{
  const f=await setup(),q=raw(f).pending.u1;
  const trusted=reports.validateReport({question:q.q,options:q.opts,correctIndex:q.answerIndex,explanation:q.explanation,userReason:input(f).reason});
  f.db.records.set('questionErrorCompensations/'+reports.reportKey('u1',trusted.question),{uid:'u1',...trusted,explanation:'另一份解析'});
  let reviewed=0;const out=await api.reportQuestion(f.db,'u1',input(f),{review:async()=>{reviewed++;return {status:'rejected',reason:'未確認有誤'};}});
  assert.equal(reviewed,1);assert.equal(out.status,'rejected');assert.equal(raw(f).actors[0].stamina,2);
  await assert.rejects(api.reportQuestion(f.db,'u2',input(f),deps),/參戰/);
  await assert.rejects(api.reportQuestion(f.db,'u1',{...input(f),questionId:'forged-id'},deps),/題目已變更/);
});
