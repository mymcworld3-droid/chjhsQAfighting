'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'../public',p),'utf8');
const math=read('cultivation/quiz-math.js');
const legacy=read('main-legacy.js');

test('real MathJax parse errors emit review signal without removing answer controls',async()=>{
  const emitted=[],warnings=[],replaced=[];
  const badMath={matches:()=>false,closest:s=>s==='mjx-container'?container:null};
  const container={textContent:'\\bad{formula}',getAttribute:()=>null,replaceWith:node=>replaced.push(node)};
  const question={isConnected:true,innerHTML:'<button>Choice A</button><button>Choice B</button>',
    textContent:'\\bad{formula}',querySelector:s=>s.includes('mjx-merror')?badMath:null};
  const context={
    window:{MathJax:{startup:{promise:Promise.resolve()},typesetClear(){},async typesetPromise(){}},dispatchEvent:e=>emitted.push(e)},
    document:{createElement:()=>({})},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    console:{warn:(...args)=>warnings.push(args)}
  };
  vm.runInNewContext(math,context);
  await context.window.quizMathTypeset(question);
  assert.equal(emitted.length,1);
  assert.equal(emitted[0].type,'qa:invalid-tex');
  assert.equal(emitted[0].detail.node,question);
  assert.equal(replaced.length,1);
  assert.equal(replaced[0].className,'quiz-math-fallback tex2jax_ignore');
  assert.match(question.innerHTML,/<button>Choice A<\/button><button>Choice B<\/button>/);
  assert(warnings.some(x=>x[0]==='[Quiz Math] invalid TeX displayed as literal text'));
});

test('active solo question sends one authenticated background review, never opens report modal',async()=>{
  const start=legacy.indexOf('const automaticMathReviewAttempts = new Set();');
  const end=legacy.indexOf('// Helpers submit the exact question snapshot;',start);
  assert(start>=0&&end>start);
  const listener={},calls=[],notices=[],question={isConnected:true},user={uid:'uid-1',getIdToken:async()=> 'valid-token'};
  const quiz={id:'quiz-1',data:{q:'請解下列含有錯誤公式的題目',opts:['$\\broken{1}$','正確選項'],ans:1,exp:'解析'},soloProof:'signed'};
  const page={contains:node=>node===question,classList:{contains:flag=>flag==='active-page'}};
  const context={
    window:{currentActiveQuiz:quiz,addEventListener:(type,fn)=>listener[type]=fn,showToast:t=>notices.push(t)},
    auth:{currentUser:user},quizHelperState:{answered:false},isAnswering:false,
    currentUserData:{stats:{gold:0,totalScore:100}},updateUIStats(){},
    document:{getElementById:id=>id==='page-quiz'?page:id==='question-text'?question:null},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({status:'rejected'})};},
    console
  };
  vm.runInNewContext(legacy.slice(start,end),context);
  const issue={detail:{node:question,source:'\\bad{formula}'}};
  listener['qa:invalid-tex'](issue);listener['qa:invalid-tex'](issue);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/verify-report');
  assert.equal(calls[0].options.headers.Authorization,'Bearer valid-token');
  const payload=JSON.parse(calls[0].options.body);
  assert.equal(payload.question,quiz.data.q);
  assert.deepEqual(payload.options,quiz.data.opts);
  assert.equal(payload.correctIndex,1);
  assert.match(payload.userReason,/MathJax/);
  assert.equal(payload.soloProof,'signed');
  assert.equal(notices.length,1);
  context.quizHelperState.answered=true;
  context.window.currentActiveQuiz={id:'quiz-2',data:{...quiz.data,q:'另一道數學題目'}};
  listener['qa:invalid-tex'](issue);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1,'after-answer previews must not trigger auto-review');
});

test('PvP review only uses authenticated pending question and never exposes its answer',async()=>{
  const API=require('../tactical-combat-api.cjs').__test;
  const {database}=require('./helpers/tactical-db.cjs');
  const db=database();
  const room=await API.start(db,'u1',{mode:'pvp'},2000000000000);
  const record=db.records.get(API.ROOMS+'/'+room.id);
  record.pending={u1:{id:'pvp-q-1',q:'一個含有公式的題目題幹',opts:['選項甲','選項乙'],answerIndex:1,explanation:'正確答案為乙'}};
  let reviews=0;
  const stub=async(data,{trusted})=>{reviews++;assert.equal(trusted,true);assert.equal(data.correctIndex,1);return {status:'confirmed',reason:'私人審核理由'}};
  const result=await API.reviewMathIssue(db,'u1',{roomId:room.id,questionId:'pvp-q-1'},{review:stub});
  assert.equal(result.submitted,true);assert.equal(result.status,'confirmed');
  assert(!JSON.stringify(result).includes('正確答案為乙'));
  assert(!JSON.stringify(result).includes('私人審核理由'));
  assert.equal(reviews,1);
  await assert.rejects(API.reviewMathIssue(db,'u1',{roomId:room.id,questionId:'unknown'},{review:stub}),/沒有這道/);
  assert.equal(reviews,1);
});

test('tactical question auto-report does not expose correct answer or block grading',()=>{
  const tactical=read('cultivation/tactical-combat.js');
  assert.match(tactical,/window\.addEventListener\('qa:invalid-tex'/);
  assert.match(tactical,/api\('\/api\/tactical\/review-math-issue',\{roomId,questionId:q\.id\}/);
  assert.match(tactical,/pairReviews\[pairDisplayIndex\]/);
  assert(!tactical.includes('correctIndex:q.answerIndex'));
});
