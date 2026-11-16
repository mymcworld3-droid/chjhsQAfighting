'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const api=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
function scene(objective){
  const s=R.create({id:'objective-test',mode:'pve',players:[{uid:'u',atk:200,maxHp:1000}],now});
  s.blocks=[];s.trial={seed:'test',stage:1,layoutVersion:3};s.objective=objective;
  Object.assign(s.actors[0],{x:1,y:1,stamina:10});Object.assign(s.actors[1],{x:6,y:6});
  return s;
}
const move=(s,x,y)=>R.apply(s,'u',{type:'move',x,y},now);
test('transport requires pickup before delivery and records progress in state',()=>{
  let s=scene({type:'transport',phase:'pickup',carrying:false,item:{x:3,y:1,collected:false},destination:{x:2,y:1},completed:false});
  s=move(s,2,1);assert.equal(s.status,'active');assert.equal(s.objective.carrying,false);
  s=move(s,3,1);assert.equal(s.objective.item.collected,true);assert.equal(s.objective.phase,'delivery');
  s=move(s,2,1);assert.equal(s.status,'active');assert.equal(s.objective.completed,true);
  assert.match(s.events.at(-1).text,/一題/);
  s=R.answer(JSON.parse(JSON.stringify(s)),'u',false,now);
  assert.equal(s.status,'finished');assert.equal(s.finishReason,'objective');assert.equal(s.winner,'player');
});
test('sealing counts each point once and does not require killing enemies',()=>{
  let s=scene({type:'sealing',points:[{x:2,y:1,activated:false},{x:3,y:1,activated:false}],completed:false});
  s=R.answer(s,'u',true,now);s=move(s,2,1);assert.equal(s.objective.points.filter(p=>p.activated).length,1);
  s=move(s,1,1);s=move(s,2,1);assert.equal(s.objective.points.filter(p=>p.activated).length,1);
  s=move(s,3,1);assert.equal(s.status,'finished');assert.ok(s.actors[1].hp>0);
});
test('boss objective ends when the designated boss dies, regardless of surviving guards',()=>{
  let s=scene({type:'boss',bossUid:'monster-0',completed:false});
  s.actors[1].uid='monster-0';Object.assign(s.actors[1],{x:2,y:1,hp:100});
  s.actors.push(R.actor({uid:'guard',bot:true,team:'monster',maxHp:1000},{x:5,y:5}));
  s=R.answer(s,'u',true,now);s=R.apply(s,'u',{type:'attack',x:2,y:1},now);
  assert.equal(s.status,'finished');assert.equal(s.winner,'player');assert.ok(s.actors[2].hp>0);
});
test('answering after reaching delivery settles and advances atomically even on replay',async()=>{
  const db=database(),start=await api.start(db,'u1',{mode:'pve'},now),raw=db.records.get(api.ROOMS+'/'+start.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:1,stamina:5});raw.actors.slice(1).forEach(a=>Object.assign(a,{x:6,y:6}));
  raw.objective={type:'transport',carrying:true,destination:{x:2,y:1},completed:false};
  const moved=await api.command(db,'u1',{roomId:start.id,revision:start.revision,requestId:'objective-move-test',type:'move',x:2,y:1},now);
  assert.equal(moved.status,'active');assert.equal(moved.objective.completed,true);
  const expected=await api.prepareQuestion(db,'u1',start.id,now);
  const q=await api.commitQuestion(db,'u1',expected,{q:'計算 2 加 3 的結果為何？',correct:'5',wrong:['1','2','3'],exp:'二加三等於五。'},now);
  const request={roomId:start.id,questionId:q.id,choice:db.records.get(api.ROOMS+'/'+start.id).pending.u1.answerIndex};
  const result=await api.answer(db,'u1',request,now),replay=await api.answer(db,'u1',request,now);
  assert.equal(result.status,'finished');assert.equal(result.nextStage,2);assert.equal(replay.nextStage,2);
  assert.equal(db.records.get(api.PLAYERS+'/u1').trial.stage,2);
  assert.equal(db.records.get('users/u1').stats.gold,150);
  assert.equal(db.records.get('users/u1').stats.totalScore,result.progress.stats.totalScore);
  assert.equal(db.records.get('users/u1').stats.totalAnswered,1);
});
test('non-kill mission rewards only used manuals, once after victory',async()=>{
  const db=database();await api.chooseSchool(db,'u1',{school:'body'});
  const start=await api.start(db,'u1',{mode:'pve'},now),raw=db.records.get(api.ROOMS+'/'+start.id);
  raw.blocks=[];Object.assign(raw.actors[0],{x:1,y:1,stamina:10,answered:1,correct:1});
  raw.actors.slice(1).forEach(a=>Object.assign(a,{x:6,y:6}));
  raw.objective={type:'transport',carrying:true,destination:{x:2,y:1},completed:false};
  const cast=await api.command(db,'u1',{roomId:start.id,revision:start.revision,requestId:'objective-manual-cast',type:'manual',skillId:'rock-fist',x:2,y:1},now);
  const request={roomId:start.id,revision:cast.revision,requestId:'objective-manual-win',type:'move',x:2,y:1};
  const win=await api.command(db,'u1',request,now);assert.equal(win.status,'finished');
  const exp=db.records.get(api.MANUALS+'/u1').books['body-rock'].exp;assert.equal(exp,4);
  await api.command(db,'u1',request,now);assert.equal(db.records.get(api.MANUALS+'/u1').books['body-rock'].exp,exp);
});
