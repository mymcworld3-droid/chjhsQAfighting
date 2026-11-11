'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const Rules=require('../public/cultivation/adaptive-learning-rules.js'), Api=require('../adaptive-learning-api.cjs').__test;
const unit={path:'物理/高中二年級/下學期/物理',detail:'鉛直圓周運動',sub_topics:[]};
const scope=Api.scopeFor(unit),plan=Api.normalizePlan({concepts:Api.seedConcepts(scope)},scope,'rules');
const q=(i=0)=>({data:{q:'待答題目'+i},adaptive:{questionId:'test_question_'+i,scopeId:scope.scopeId,scope:unit,conceptId:plan.facets[i].conceptId,facetId:plan.facets[i].id,concept:plan.facets[i].concept,method:plan.facets[i].name,outline:plan.concepts}});
function fixture(storage=new Map(),docs=new Map([['u1',{stats:{gold:42},gameSettings:{sourceMode:'focused',focusedUnits:[unit]}}]])) {
  const nodes=new Map(),events={},calls=[],patches=[],timers=[];let uid='u1',fail=false,afterGet=null;
  class Node {
    constructor(){this.children=[];this.textContent='';this.innerHTML='';}
    set id(value){this._id=value;nodes.set(value,this);} get id(){return this._id;}
    appendChild(node){this.children.push(node);return node;}
    remove(){nodes.delete(this.id);}
    insertAdjacentElement(_position,node){this.children.push(node);}
  }
  for(const id of ['question-text','feedback-text']){const node=new Node();node.id=id;}
  const state=()=>docs.get(uid), document={getElementById:id=>nodes.get(id),createElement:()=>new Node()};
  const window={getCurrentUserData:state,addEventListener:(name,fn)=>{events[name]=fn;},quizMathRichText:text=>'SAFE:'+text,quizMathTypeset:async()=>{},persistAdaptiveActiveQuiz:quiz=>{window.persisted=structuredClone(quiz);}};
  const getMainUser=()=>uid?{uid}:null;
  const runTransaction=async(_db,fn)=>{
    if(fail)throw Error('offline');
    return fn({get:async ref=>{if(afterGet)await afterGet();return {exists:()=>docs.has(ref.uid),data:()=>structuredClone(docs.get(ref.uid))};},update:(ref,patch)=>{
      assert.deepEqual(Object.keys(patch),['stats.adaptiveLearningV1'],'replay must not update any game reward or question');
      patches.push(patch);docs.get(ref.uid).stats.adaptiveLearningV1=structuredClone(patch['stats.adaptiveLearningV1']);
    }});
  };
  const source=fs.readFileSync('public/cultivation/adaptive-learning.js','utf8').replace(/^import .*;\n/gm,'');
  const context={window,document,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,val)},getMainUser,
    getFirestore:()=>({}),doc:(_db,_name,uid)=>({uid}),runTransaction,QAAdaptiveLearningRules:Rules,console:{warn(){}},
    authenticatedMainFetch:async(input,init)=>{calls.push({input,init});return f.response;},setTimeout:fn=>{timers.push(fn);return 1;},Date,Map,Set,JSON};
  const f={window,document,events,calls,patches,storage,docs,state,nodes,timers,get uid(){return uid;},set uid(v){uid=v;},set fail(v){fail=v;},set afterGet(v){afterGet=v;},response:{ok:true,json:async()=>({})}};
  vm.runInNewContext(source,context);f.api=window.QAAdaptiveLearning;return f;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('answer observations survive reload and replay exactly once without touching rewards',async()=>{
  const f=fixture(),quiz=q();f.fail=true;f.api.answer(quiz,false,false);await f.api.flush();assert.equal(f.patches.length,0);
  const reload=fixture(f.storage,f.docs);await reload.api.flush();const state=Rules.scopeState(reload.state().stats.adaptiveLearningV1,scope.scopeId);
  assert.equal(state.answered,1);assert.equal(reload.state().stats.gold,42);await reload.api.flush();assert.equal(reload.patches.length,1);
});
test('main save and background replay merge idempotently, and acknowledgement leaves later observations pending',async()=>{
  const f=fixture(),quiz=q(),rows=f.api.answer(quiz,true,false);const merged=f.api.merge(undefined,rows);
  f.state().stats.adaptiveLearningV1=merged;f.api.answer(q(1),false,false);f.api.acknowledge('u1',rows);await f.api.flush();
  assert.equal(Rules.scopeState(f.state().stats.adaptiveLearningV1,scope.scopeId).answered,2);assert.equal(f.state().stats.gold,42);
});
test('outboxes and stale transaction responses remain isolated by account',async()=>{
  const f=fixture();f.api.answer(q(),true,false);f.docs.set('u2',{stats:{gold:99}});f.uid='u2';await f.api.flush();assert.equal(f.patches.length,0);
  f.uid='u1';f.afterGet=async()=>{f.uid='u2';};await f.api.flush('u1');assert.equal(f.patches.length,0);assert(!f.docs.get('u2').stats.adaptiveLearningV1);
  f.uid='u1';f.afterGet=null;await f.api.flush();assert.equal(Rules.scopeState(f.state().stats.adaptiveLearningV1,scope.scopeId).answered,1);
});
test('successful pre-answer help persists with the cached question and is separate from independent completion',async()=>{
  const f=fixture(),quiz=q();f.api.hint(quiz);assert.equal(f.window.persisted.adaptiveHelp,1);f.api.answer(quiz,true,false);f.api.hint(quiz);await f.api.flush();
  const row=Rules.scopeState(f.state().stats.adaptiveLearningV1,scope.scopeId).concepts[quiz.adaptive.conceptId];assert.equal(row.h,1);assert.equal(row.c,1);assert.equal(row.u,0);assert.equal(quiz.adaptiveHelp,1);
});
test('pending cache metadata reserves only learning targets and sends no answer or question content',()=>{
  const f=fixture(),result=f.api.request(unit,[q(),null,q(1),{data:{q:'bank question'}}]);
  assert.equal(result.adaptivePending.length,2);assert.equal(result.adaptiveScope.detail,unit.detail);assert(!JSON.stringify(result.adaptivePending).includes('待答題目'));assert(!JSON.stringify(result.adaptivePending).includes('correct'));
});
test('collapsed progress shows distinct untested concepts and methods without replacing the active question',()=>{
  const f=fixture(),quiz=q();f.window.currentActiveQuiz=quiz;f.api.render(quiz);const details=f.nodes.get('adaptive-scope-progress');
  assert(details);assert.equal(details.children.filter(n=>n.className==='adaptive-concept-row').length,6);
  assert(details.children.filter(n=>n.className==='adaptive-concept-row').every(n=>n.children[0].textContent.includes('待診斷')));
  assert.equal(f.window.currentActiveQuiz,quiz);assert.equal(f.nodes.get('question-text').textContent,'');
});
test('a late lesson cannot cross accounts or ranges, and valid lesson content uses the safe rich-text renderer',async()=>{
  const f=fixture(),quiz=q();f.window.currentActiveQuiz=quiz;f.api.answer(quiz,false,false);f.api.answer(q(1),false,false);await f.api.flush();
  let respond;f.response={ok:true,json:()=>new Promise(resolve=>{respond=resolve;})};const job=f.api.afterSaved(quiz);await tick();assert.equal(f.calls.length,1);
  f.uid='u2';respond({scopeId:scope.scopeId,conceptId:quiz.adaptive.conceptId,concept:'最高點速率',explanation:'說明文字',example:'示例文字',through:2});await job;
  assert(!f.nodes.has('adaptive-concept-lesson'));
  f.uid='u1';f.response={ok:true,json:async()=>({scopeId:scope.scopeId,conceptId:quiz.adaptive.conceptId,concept:'最高點速率',explanation:'<script>bad</script>',example:'$v^2$ 示例',through:2})};await f.api.afterSaved(quiz);await tick();
  const panel=f.nodes.get('adaptive-concept-lesson');assert(panel);assert.equal(panel.children[2].innerHTML,'SAFE:<script>bad</script>');assert.equal(f.window.currentActiveQuiz,quiz);
});
test('unavailable storage retains observations in memory and normal question fetching still uses authenticated requests',async()=>{
  const f=fixture();f.storage.set=()=>{throw Error('quota');};f.api.answer(q(),true,false);await f.api.flush();assert.equal(f.patches.length,1);
  await f.api.fetchQuiz('/api/generate-quiz',{method:'POST'});assert.equal(f.calls.length,1);assert.equal(f.calls[0].input,'/api/generate-quiz');
});
test('main quiz integrates observations in its existing transaction and exempts question quality checks from assistance',()=>{
  const main=fs.readFileSync('public/main-legacy.js','utf8');
  assert.match(main,/adaptiveLearningV1:window\.QAAdaptiveLearning\.merge\(remote\.stats\?\.adaptiveLearningV1, adaptiveRows\)/);
  assert.match(main,/remote\.stats\?\.adaptiveLearningV1 \? \{adaptiveLearningV1:remote\.stats\.adaptiveLearningV1\}/);
  assert.match(main,/!quizHelperState\.answered && intent !== 'check-question'/);
  assert.match(main,/adaptiveQuestionContext\(randomUnit\)/);assert.match(main,/adaptiveConceptId:adaptive\.conceptId/);
});
