'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-combat.js'),'utf8');
const toolsSource=source.slice(source.indexOf('function setQuizContext('),source.indexOf('function paintQuestion('));
const q={id:'question-one',q:'計算二加三的結果？',opts:['1','2','3','5'],subject:'數學'};
const node=()=>({value:'',textContent:'',hidden:false,disabled:false,children:[],focus(){},append(...v){this.children.push(...v);},setAttribute(){}});
function client(reply=async()=>({answer:'先把兩個數相加。'})){
  const nodes=new Map(),requests=[];const $=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  const user={stats:{gold:0,totalScore:30}},legacyQuiz={data:{q:'另一頁的題目'}};
  const ctx={quizContext:null,state:{id:'arena-one',mode:'pve'},uid:'u1',epoch:1,AbortController,
    valid:(e,uid)=>ctx.epoch===e&&uid===ctx.uid,localUser:()=>user,$,esc:String,rich:String,
    document:{createElement:node},window:{currentActiveQuiz:legacyQuiz,quizMathTypeset(){},updateUIStats(){},refreshXiuxianLiveSync(){}},
    api:async(url,body,signal)=>{requests.push({url,body,signal});return reply(url,body);}};
  vm.createContext(ctx);vm.runInContext(toolsSource,ctx);ctx.setQuizContext(q);
  return {ctx,$,requests,user,legacyQuiz};
}
test('trial tools appear below the answer options and keep the original solo quiz state isolated',async()=>{
  const c=client();assert.match(c.ctx.quizTools(),/問題回報/);assert.match(c.ctx.quizTools(),/問道助手/);
  c.$('[data-helper-input]').value='第一步怎麼算？';await c.ctx.askHelper();
  assert.equal(c.requests[0].url,'/api/question-helper');assert.equal(c.requests[0].body.question,q.q);
  assert.equal(c.requests[0].body.answered,false);assert.equal(c.requests[0].body.correctOption,'');
  assert.equal(c.$('[data-helper-messages]').children.length,2);assert.equal(c.ctx.window.currentActiveQuiz,c.legacyQuiz);
  c.ctx.state.mode='pvp';assert.equal(c.ctx.quizTools(),'');
});
test('review discussion sends the actual chosen answer and explanation, preserving same-question conversation',async()=>{
  const c=client();c.$('[data-helper-input]').value='如何移項？';await c.ctx.askHelper();
  c.ctx.setQuizContext(q,{choice:1,answerIndex:3,explanation:'二加三等於五。'});
  c.$('[data-helper-input]').value='為什麼我錯了？';await c.ctx.askHelper();
  assert.equal(c.requests[1].body.selectedOption,'2');assert.equal(c.requests[1].body.correctOption,'5');
  assert.equal(c.requests[1].body.explanation,'二加三等於五。');assert.equal(c.requests[1].body.history.length,2);
});
test('changing question or account discards delayed helper replies and cancels the old request',async()=>{
  let resolve;const c=client(()=>new Promise(r=>resolve=r));c.$('[data-helper-input]').value='這題怎麼算？';
  const pending=c.ctx.askHelper();const old=c.ctx.quizContext;
  c.ctx.setQuizContext({...q,id:'question-two',q:'新題目'});assert.equal(old.abort.signal.aborted,true);
  resolve({answer:'上一題答案',questionIssue:{confirmed:true,reason:'上一題的資料有誤'}});await pending;
  assert.equal(c.$('[data-helper-messages]').children.length,1);assert.equal(c.requests.length,1);
  assert.equal(c.ctx.quizContext.messages.length,0);
  c.$('[data-helper-input]').value='再問一次';const again=c.ctx.askHelper();c.ctx.uid='u2';resolve({answer:'舊帳號回答'});await again;
  assert.equal(c.$('[data-helper-messages]').children.length,2);
});
test('report failures remain retryable and transmit only the server question reference and reason',async()=>{
  let fail=true;const c=client(async()=>{if(fail)throw Error('網路中斷');return {state:{status:'confirmed',reason:'審核確認有誤。',compensated:true,goldAdded:100,cultivationAdded:1,newGold:100,newTotalScore:31}};});
  c.$('[data-report-reason]').value='錯了';await c.ctx.reportQuestion();assert.equal(c.requests.length,0);
  c.$('[data-report-reason]').value='題目的條件不夠完整';await c.ctx.reportQuestion();assert.match(c.$('[data-report-status]').textContent,/重試/);
  assert.equal(c.$('[data-report-send]').disabled,false);fail=false;await c.ctx.reportQuestion();
  assert.deepEqual(Object.keys(c.requests[1].body).sort(),['questionId','reason','roomId']);
  assert.equal(c.requests[1].body.questionId,q.id);assert.equal(c.user.stats.gold,100);assert.equal(c.user.stats.totalScore,31);
});
test('a helper-confirmed issue automatically submits the current question for independent review',async()=>{
  const c=client(async url=>url==='/api/question-helper'?{answer:'條件有疑點。',questionIssue:{confirmed:true,reason:'題目的條件互相矛盾'}}:{state:{status:'rejected',reason:'未確認實質錯誤。'}});
  c.$('[data-helper-input]').value='題目有沒有錯？';await c.ctx.askHelper();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.requests[1].url,'/api/tactical/report-question');assert.equal(c.requests[1].body.questionId,q.id);
  assert.match(c.$('[data-report-status]').textContent,/未確認/);
});
test('background state synchronization preserves the current question; expiry closes an invalid question',()=>{
  const acceptSource=source.slice(source.indexOf('function accept('),source.indexOf('function applyProgress('));
  let hides=0,preserved;const ctx={state:{id:'room',revision:1,question:{id:'q'}},appliedOp:0,clockOffset:0,modalOpen:true,
    $:()=>({}),applyProgress(){},hideModal(){hides++;ctx.modalOpen=false;},notice(){},paint(options){preserved=options.preserveModal;}};
  vm.createContext(ctx);vm.runInContext(acceptSource,ctx);
  ctx.accept({id:'room',revision:2,question:{id:'q'}},1);assert.equal(hides,0);assert.equal(preserved,true);
  ctx.accept({id:'room',revision:3,question:null},2);assert.equal(hides,1);assert.equal(preserved,false);
  ctx.state={id:'room',revision:4,quizRound:1,actionRevision:3,phase:'action',turnUid:'u1'};
  const selected={x:2,y:3};ctx.selection=selected;
  ctx.accept({...ctx.state,revision:5},3);assert.equal(ctx.selection,selected,'opponent answers preserve the selected target');
  ctx.accept({...ctx.state,revision:6,actionRevision:6},4);assert.equal(ctx.selection,null,'a real action requires a new target');
});
