'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const api=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
const duel=()=>R.create({id:'arena-0123456789abcdef',mode:'pvp',players:['u1','u2'].map(uid=>({uid,name:uid,maxHp:1000,atk:200})),now});
const complete=(s,uid,time=now)=>R.answer(R.answer(s,uid,true,time),uid,true,time+1);
const parsed={q:'二加三的結果是多少？',correct:'5',wrong:['1','2','3'],exp:'二加三等於五。'};
async function question(db,uid,id,time=now){const expected=await api.prepareQuestion(db,uid,id,time);return api.commitQuestion(db,uid,expected,parsed,time);}
async function answer(db,uid,id,time=now){const q=await question(db,uid,id,time);const raw=db.records.get(api.ROOMS+'/'+id);return api.answer(db,uid,{roomId:id,questionId:q.id,choice:raw.pending[uid].answerIndex},time);}
async function room(db){const first=await api.start(db,'u1',{mode:'pvp'},now);await api.start(db,'u2',{mode:'pvp',code:first.id},now);return first.id;}

test('both players answer immediately; the first to finish two questions earns initiative regardless of seat',()=>{
  const initial=duel();assert.equal(initial.phase,'answer');assert.equal(initial.deadlineMs,0);
  assert.throws(()=>R.apply(initial,'u1',{type:'end'},now),/不是你的/);
  let s=R.answer(initial,'u2',false,now);assert.equal(s.phase,'answer');assert.equal(s.actors[1].stamina,3);
  s=R.answer(s,'u1',true,now+1);s=R.answer(s,'u2',true,now+2);
  assert.equal(s.initiativeUid,'u2');assert.equal(s.turnUid,'u2');assert.equal(s.phase,'action');
  assert.equal(s.deadlineMs,now+30002);assert.equal(s.answerDeadlineMs,now+50002);
  const firstDeadline=s.deadlineMs;
  s=R.answer(s,'u1',true,now+3);assert.equal(s.turnUid,'u2');assert.equal(s.deadlineMs,firstDeadline);
  assert.throws(()=>R.answer(s,'u2',true,now+4),/兩題/);
  s=R.apply(s,'u2',{type:'end'},now+5);assert.equal(s.turnUid,'u1');assert.equal(s.deadlineMs,now+30005);
  s=R.apply(s,'u1',{type:'end'},now+6);assert.equal(s.quizRound,2);assert.equal(s.phase,'answer');
  assert.deepEqual(s.actors.map(a=>a.questions),[0,0]);assert.deepEqual(s.actors.map(a=>a.stamina),[10,7]);
  s=complete(s,'u1',now+7);assert.equal(s.initiativeUid,'u1');assert.equal(s.actors[0].questions,2);
  assert.equal(initial.actors[1].answered,0,'source snapshots remain immutable');
});
test('full stamina still requires two questions, and no extra answers or actions are allowed',()=>{
  const s=duel();s.actors[1].stamina=10;
  const one=R.answer(s,'u2',true,now);assert.equal(one.actors[1].stamina,10);assert.equal(one.phase,'answer');
  assert.throws(()=>R.apply(one,'u2',{type:'guard'},now),/不是你的/);
  const two=R.answer(one,'u2',false,now+1);assert.equal(two.turnUid,'u2');assert.equal(two.actors[1].questions,2);
  assert.throws(()=>R.answer(two,'u2',false,now+2),/兩題/);
});
test('first player can end before the other finishes; only the unfinished player receives a 50-second limit',()=>{
  let s=complete(duel(),'u1');s=R.apply(s,'u1',{type:'end'},now+2);
  assert.equal(s.phase,'waiting-answer');assert.equal(s.deadlineMs,0);
  s=R.answer(s,'u2',true,now+49000);s=R.answer(s,'u2',false,now+49001);
  assert.equal(s.phase,'action');assert.equal(s.turnUid,'u2');assert.equal(s.deadlineMs,now+79001);
  assert.equal(R.expire(s,now+50001),s,'answer deadline does not shorten an already earned action');
});
test('an answer arriving after the first action expires starts a full second action even without a prior sync',async()=>{
  let s=complete(duel(),'u1');s=R.answer(s,'u2',true,now+40000);s=R.answer(s,'u2',true,now+49000);
  assert.equal(s.phase,'action');assert.equal(s.turnUid,'u2');assert.equal(s.deadlineMs,now+79000);
  const db=database(),id=await room(db);await answer(db,'u1',id,now);await answer(db,'u1',id,now+1);
  await answer(db,'u2',id,now+40000);const ready=await answer(db,'u2',id,now+49000);
  assert.equal(ready.turnUid,'u2');assert.equal(ready.deadlineMs,now+79000);
});
test('unanswered questions expire without stamina or answer credit; accumulated stamina survives',()=>{
  let s=complete(duel(),'u1');s=R.answer(s,'u2',false,now+3);
  s=R.apply(s,'u1',{type:'end'},now+4);s.pending={u2:{id:'expired'}};
  assert.equal(R.expire(s,now+50000),s);
  const expired=R.expire(s,now+50001),a=expired.actors[1];
  assert.equal(a.questions,1);assert.equal(a.answered,1);assert.equal(a.stamina,3);assert.equal(a.quizExpired,true);
  assert.equal(expired.turnUid,'u2');assert.equal(expired.deadlineMs,now+80001);assert.equal(expired.pending.u2,undefined);
  assert.throws(()=>R.answer(expired,'u2',true,now+50001),/答題時間/);
});
test('late reconnect resolves the 30-second action and 50-second answer clocks in chronological order',()=>{
  let s=complete(duel(),'u1');const deadline=s.deadlineMs;
  s=R.expire(s,deadline);assert.equal(s.phase,'waiting-answer');assert.equal(s.turn,2);
  s=R.expire(s,now+100000);assert.equal(s.quizRound,2);assert.equal(s.phase,'answer');
  assert.equal(s.turn,3);assert.equal(s.deadlineMs,0);assert.equal(s.actors[1].stamina,2);
  assert.equal(R.expire(s,now+100001),s,'repeated sync cannot duplicate turn transitions');
});
test('two missed action turns forfeit even when the player has answered; real action breaks the streak',()=>{
  let s=complete(duel(),'u1');s=complete(s,'u2',now+2);
  s=R.expire(s,now+30001);assert.equal(s.turnUid,'u2');assert.equal(s.turnTimeouts.u1,1);
  s=R.apply(s,'u2',{type:'end'},now+30002);s=complete(s,'u1',now+30003);
  assert.equal(s.turnTimeouts.u1,1);
  const lost=R.expire(s,now+60004);assert.equal(lost.status,'finished');assert.equal(lost.winner,'u2');
  const active=R.apply(s,'u1',{type:'guard'},now+30005);assert.equal(active.turnTimeouts.u1,0);
  assert.equal(R.expire(active,now+60004).status,'active');
});
test('server generation remains valid while the opponent starts and ends an action; answers are private and idempotent',async()=>{
  const db=database(),id=await room(db);
  const expected=await api.prepareQuestion(db,'u2',id,now);
  await answer(db,'u1',id,now+1);const first=await answer(db,'u1',id,now+2);
  const q=await api.commitQuestion(db,'u2',expected,parsed,now+3);
  assert.equal((await api.state(db,'u2',now+3)).question.id,q.id);
  assert.equal((await api.state(db,'u1',now+3)).question,null);
  assert.equal('answerIndex'in q,false);
  await api.command(db,'u1',{roomId:id,revision:first.revision,type:'end',requestId:'first-end-0001'},now+4);
  const raw=db.records.get(api.ROOMS+'/'+id),choice=raw.pending.u2.answerIndex;
  const input={roomId:id,questionId:q.id,choice};
  const [a,b]=await Promise.all([api.answer(db,'u2',input,now+5),api.answer(db,'u2',input,now+5)]);
  assert.equal(a.actors[1].stamina,6);assert.equal(b.actors[1].answered,1);
  assert.equal(db.records.get('users/u2').stats.totalAnswered,1);
  const second=await answer(db,'u2',id,now+6);assert.equal(second.turnUid,'u2');assert.equal(second.phase,'action');
});
test('an opponent answer does not invalidate a selected action, but a previous action still does',async()=>{
  const db=database(),id=await room(db);await answer(db,'u1',id,now);
  const ready=await answer(db,'u1',id,now+1),actionRevision=ready.actionRevision;
  await answer(db,'u2',id,now+2);
  const input={roomId:id,revision:ready.revision,actionRevision,requestId:'guard-active-001',type:'guard'};
  const applied=await api.command(db,'u1',input,now+3);assert.equal(applied.actors[0].attacks,1);
  const retry=await api.command(db,'u1',input,now+3);assert.equal(retry.actors[0].attacks,1);
  await assert.rejects(api.command(db,'u1',{...input,requestId:'guard-active-002'},now+4),/戰場已更新/);
});
test('expired pending answers and generations cannot escape the answer deadline or be reused next round',async()=>{
  const db=database(),id=await room(db);await answer(db,'u1',id,now);
  await answer(db,'u1',id,now+1);const expected=await api.prepareQuestion(db,'u2',id,now+2);
  const q=await api.commitQuestion(db,'u2',expected,parsed,now+2);
  const expired=await api.state(db,'u2',now+50001);
  assert.equal(expired.question,null);assert.equal(expired.turnUid,'u2');
  await assert.rejects(api.answer(db,'u2',{roomId:id,questionId:q.id,choice:0},now+50001),/失效/);
  await assert.rejects(api.commitQuestion(db,'u2',expected,parsed,now+50001),/回合已更新/);
  const next=await api.state(db,'u2',now+100000);assert.equal(next.quizRound,2);
  await assert.rejects(api.commitQuestion(db,'u2',expected,parsed,now+100001),/回合已更新/);
});
test('question reports use the exact server question and hide pre-answer review spoilers',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},now),q=await question(db,'u1',s.id);
  let evidence,awards=0;const deps={review:async input=>{evidence=input;return {status:'confirmed',reason:'正解是五，原題有錯'};},award:async()=>{awards++;return {status:'confirmed',compensated:true,goldAdded:100,cultivationAdded:1};}};
  const result=await api.reportQuestion(db,'u1',{roomId:s.id,questionId:q.id,question:'偽造題目',correctIndex:99,reason:'題目條件寫得不完整'},deps);
  assert.equal(evidence.question,parsed.q);assert.equal(evidence.options[evidence.correctIndex],'5');assert.equal(awards,1);
  assert.equal(result.reason,'獨立審核已確認本題有誤。');assert.equal('correctIndex'in result,false);
  await assert.rejects(api.reportQuestion(db,'u2',{roomId:s.id,questionId:q.id,reason:'請確認題目錯誤'},deps),/參戰/);
  await assert.rejects(api.reportQuestion(db,'u1',{roomId:s.id,questionId:'stale',reason:'請確認題目錯誤'},deps),/題目已變更/);
  await assert.rejects(api.reportQuestion(db,'u1',{roomId:s.id,questionId:q.id,reason:'錯誤'},deps),/六|6/);
  const raw=db.records.get(api.ROOMS+'/'+s.id);await api.answer(db,'u1',{roomId:s.id,questionId:q.id,choice:raw.pending.u1.answerIndex},now+1);
  const after=await api.reportQuestion(db,'u1',{roomId:s.id,questionId:q.id,reason:'原本解析寫得不完整'},deps);
  assert.equal(after.reason,undefined);assert.equal(evidence.explanation,parsed.exp);
});
