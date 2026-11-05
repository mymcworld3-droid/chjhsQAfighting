'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/cultivation/martial-trial.js','utf8');
const flow=source.slice(source.indexOf(' async function redeemQuestion()'),source.indexOf(' async function sync()'));
function client({answered=false,loseResponse=false}={}){
 const q={id:'reported-q',q:'錯題'},calls=[],watched=[],wallet=[];
 const state={runId:'run',floor:1,round:answered?1:0,status:'active',lastTurn:answered?{questionId:q.id,question:q,correct:false}:null};
 const corrected={...state,round:1,lastTurn:{questionId:q.id,question:q,correct:answered?false:null,verifiedError:true},economy:{gold:120}};
 const ctx={serial:1,owner:'u',state,question:q,verifiedQuestionId:'',phase:answered?'review':'question',busy:false,error:'',pending:null,notice:'',rewardPage:1,
  window:{QAStudyQuestion:{waitForAnswer:async()=>{}}},crypto:{randomUUID:()=> 'same-request-id'},
  alive:id=>id===ctx.serial,render(){},prefetchPractice(){},applyEconomy:value=>wallet.push(value.gold),
  request:async(action,body)=>{calls.push({action,body});if(loseResponse&&calls.length===1)throw Error('response lost after server commit');return corrected;},
  watchCombat:async()=>{if(ctx.phase!=='review'||ctx.busy||ctx.pending)return;watched.push(ctx.state.lastTurn);ctx.phase='animation';ctx.question=null;},
  Promise,Number,Math};
 vm.runInNewContext(flow+'\nthis.api={redeemQuestion,continueQuestion,skipQuestion};',ctx);
 return {ctx,calls,watched,wallet};
}
test('an approved pending or wrong question enters the normal review and combat flow, including repeated clicks',async()=>{
 for(const answered of [false,true]){
  const {ctx,calls,watched,wallet}=client({answered});
  await ctx.api.redeemQuestion();assert.equal(ctx.phase,'review');assert.equal(ctx.question.id,'reported-q');assert.equal(ctx.state.lastTurn.verifiedError,true);
  assert.deepEqual(wallet,[120]);assert.equal(calls.length,1);assert.equal(calls[0].action,'replace');assert.equal(calls[0].body.round,answered?1:0);
  await ctx.api.skipQuestion();await ctx.api.skipQuestion();await ctx.api.continueQuestion();
  assert.equal(calls.length,1);assert.equal(watched.length,1);assert.equal(watched[0].verifiedError,true);
 }
});
test('closing the approval screen and continuing retries a lost redemption response with the same receipt before combat',async()=>{
 const {ctx,calls,watched}=client({answered:true,loseResponse:true});
 await ctx.api.redeemQuestion();assert.ok(ctx.pending);assert.equal(ctx.phase,'review');assert.equal(watched.length,0);
 await ctx.api.continueQuestion();assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);assert.equal(ctx.pending,null);
 assert.equal(watched.length,1);assert.equal(watched[0].verifiedError,true);
});
test('ordinary reviews do not redeem, and a delayed confirmation cannot change a newer question or closed session',async()=>{
 const ordinary=client({answered:true});await ordinary.ctx.api.continueQuestion();assert.equal(ordinary.calls.length,0);assert.equal(ordinary.watched.length,1);
 for(const change of [ctx=>ctx.serial++,ctx=>ctx.question={id:'new-question'}]){
  const {ctx,calls}=client({answered:true});let finish;
  ctx.window.QAStudyQuestion.waitForAnswer=()=>new Promise(resolve=>finish=resolve);
  const pending=ctx.api.redeemQuestion();change(ctx);finish();await pending;assert.equal(calls.length,0);
 }
});
