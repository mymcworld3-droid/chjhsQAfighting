'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const Rules=require('../public/cultivation/adaptive-learning-rules.js');
const Api=require('../adaptive-learning-api.cjs').__test;
const {createSparePool}=require('../quiz-spare-pool.cjs');
const unit={path:'物理/高中二年級/下學期/物理',detail:'鉛直圓面運動',sub_topics:[]};
const scope=Api.scopeFor(unit), plan=Api.normalizePlan({concepts:Api.seedConcepts(scope)},scope,'rules');
const meta=(facet=plan.facets[0], extra={})=>({questionId:'question_'+Math.random().toString(36).slice(2),scopeId:plan.scopeId,conceptId:facet.conceptId,facetId:facet.id,role:'diagnostic',...extra});
function observe(raw, facet, correct, extra={}) { return Rules.record(raw,meta(facet),{correct,at:1000,...extra}); }
function database(user={}) {
  const docs=new Map([['users/u1',structuredClone(user)]]);
  return {docs,collection:name=>({doc:id=>({get:async()=>({exists:docs.has(name+'/'+id),data:()=>structuredClone(docs.get(name+'/'+id))}),set:async value=>docs.set(name+'/'+id,structuredClone(value))})})};
}
function fixture({generate,clock=()=>1000,stats={}}={}) {
  const user={profile:{educationLevel:'國中一年級'},gameSettings:{sourceMode:'focused',focusedUnits:[unit],difficulty:'auto'},stats};
  const db=database(user), calls=[];
  const ai=generate|| (async(prompt,options)=>{calls.push(prompt);const data=prompt.includes('80～250字')?{explanation:'最高點張力與重力一起提供向心力，先釐清受力方向。',example:'示例：先畫出受力圖，再列徑向運動方程式，最後檢查張力不可為負。'}:{concepts:Api.seedConcepts(scope)};options.validate(data);return {data};});
  const api=Api.createAdaptiveLearning({resolve:()=>({db}),verify:async req=>{if(req.uid!=='u1')throw Object.assign(Error('unauthorized'),{status:401});return req.uid;},generate:ai,now:clock,logger:{warn(){}}});
  const req={uid:'u1',body:{adaptiveScope:unit}};
  return {api,db,user,calls,req};
}

test('vertical-circle scope separates all three positions and both quantities, with different workbook methods',()=>{
  assert.deepEqual(plan.concepts.map(x=>x.name),['最高點速率','最高點張力','水平位置（中點）速率','水平位置（中點）張力','最低點速率','最低點張力']);
  assert.equal(plan.facets.length,12);assert.equal(new Set(plan.facets.map(x=>x.id)).size,12);
  assert(plan.facets.every(x=>x.name.includes('求')));
  const merged=Api.normalizePlan({concepts:[{name:'最高點的速率',methods:[{name:'由能量與臨界條件反推最高點速率',forms:['inverse-reasoning']}]},{name:'繩子繃緊的臨界條件',methods:[{name:'判斷整圈繩子是否保持繃緊',forms:['comparison']},{name:'反推最低點初速門檻',forms:['inverse-reasoning']}]}]},scope);
  assert.equal(merged.concepts.length,7);assert.equal(merged.concepts[0].methods[0].name,'由能量與臨界條件反推最高點速率');
});
test('diagnosis covers untouched concepts before repeating a concept; pending questions reserve coverage too',()=>{
  let state;const selected=[];
  for(let i=0;i<6;i++){const decision=Rules.decide(plan,state),target=decision.targets[0];assert.equal(decision.role,'diagnostic');selected.push(target.conceptId);state=observe(state,target,true);}
  assert.equal(new Set(selected).size,6);assert.equal(Rules.scopeState(state,plan.scopeId).answered,6);
  const first=Rules.decide(plan,null).targets[0];
  const second=Rules.decide(plan,null,{pending:[meta(first)]}).targets[0];assert.notEqual(second.conceptId,first.conceptId);
  assert.equal(Rules.status(null),'待診斷');assert.equal(Rules.status(Rules.scopeState(state,plan.scopeId).concepts[first.conceptId]),'持續診斷');
});
test('diagnostic length is 5–8 and ten eligible practice slots contain six reinforcements, two reviews, two challenges',()=>{
  const short={...plan,concepts:plan.concepts.slice(0,2)},long={...plan,concepts:Array.from({length:20},()=>plan.concepts[0])};
  assert.equal(Rules.decide(short).diagnosticTarget,5);assert.equal(Rules.decide(long).diagnosticTarget,8);
  const row={n:10,c:10,u:10,uc:10,recent:[1,1,1,1,1],dueAt:1,level:0};
  const s={facets:Object.fromEntries(plan.facets.map(x=>[x.id,row])),concepts:Object.fromEntries(plan.concepts.map(x=>[x.id,row]))};
  const roles=[];
  for(let i=0;i<10;i++)roles.push(Rules.decide(plan,{scopes:{[plan.scopeId]:{...s,answered:6+i}}},{now:10}).role);
  assert.deepEqual(roles.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{}),{reinforce:6,review:2,challenge:2});
  const challenge=Rules.decide(plan,{scopes:{[plan.scopeId]:{...s,answered:9}}},{now:10});
  assert(challenge.targets.every(f=>f.forms.includes('concept-transfer')&&f.difficulty==='medium'));
  const capped=Rules.decide(plan,{scopes:{[plan.scopeId]:{...s,answered:9}}},{now:10,manualDifficulty:'easy'});
  assert(capped.targets.every(f=>f.difficulty==='easy'&&f.forms.every(x=>['comparison','error-analysis'].includes(x))));
  const absent=Rules.decide(plan,{scopes:{[plan.scopeId]:{answered:9}}});assert.equal(absent.requestedRole,'challenge');assert.equal(absent.role,'reinforce');
});
test('helped completion is retained without becoming independent mastery or passing a scheduled review',()=>{
  const f=plan.facets[0];let raw=observe(null,f,true,{at:0});
  raw=observe(raw,f,true,{help:2,at:Rules.DAY});const r=Rules.scopeState(raw,plan.scopeId).facets[f.id];
  assert.equal(r.n,2);assert.equal(r.c,2);assert.equal(r.h,1);assert.equal(r.u,1);assert.equal(r.uc,1);assert.equal(r.stage,0);assert.equal(r.dueAt,Rules.DAY);
});
test('two wrong answers across different methods of the same concept trigger a lesson and a new same-concept scenario',()=>{
  const [a,b]=plan.concepts[0].methods;let raw=observe(null,a,false);raw=observe(raw,plan.concepts[1].methods[0],true);raw=observe(raw,b,false);
  let state=Rules.scopeState(raw,plan.scopeId);assert(Rules.needsLesson(state,a.conceptId));
  const lessonMeta=meta(a);raw=Rules.record(raw,lessonMeta,{id:'lesson_observation_1',kind:'lesson',through:2,at:1500});
  state=Rules.scopeState(raw,plan.scopeId);assert(!Rules.needsLesson(state,a.conceptId));assert.equal(state.answered,3);
  const decision=Rules.decide(plan,raw);assert.equal(decision.role,'reinforce');assert(decision.targets.every(x=>x.conceptId===a.conceptId));
  raw=observe(raw,a,true);assert(!Rules.needsLesson(Rules.scopeState(raw,plan.scopeId),a.conceptId));
});
test('skip has no false incorrect evidence, and repeated transactions are idempotent',()=>{
  const m=meta(),event={id:'answer_retry_123',correct:false,skipped:true,at:0};
  const raw=Rules.record(null,m,event),state=Rules.scopeState(raw,plan.scopeId);
  assert.equal(state.skipped,1);assert.equal(state.answered,0);assert.equal(Object.keys(state.concepts).length,0);
  assert.equal(Rules.record(raw,m,event),raw);assert.equal(state.updatedAt,0);
});
test('independent success raises difficulty gradually; manual selection remains the ceiling and helped success does not promote',()=>{
  const f=plan.facets[0];let raw;
  for(let i=0;i<10;i++)raw=observe(raw,f,true);
  assert.equal(Rules.scopeState(raw,plan.scopeId).concepts[f.conceptId].level,1);
  const target=(raw,manual)=>Rules.decide(plan,raw,{conceptId:f.conceptId,manualDifficulty:manual}).targets[0];
  assert.equal(target(raw,'auto').difficulty,'medium');assert.equal(target(raw,'easy').difficulty,'easy');
  for(let i=0;i<10;i++)raw=observe(raw,f,true);
  assert.equal(target(raw,'auto').difficulty,'hard');assert.equal(target(raw,'medium').difficulty,'medium');
  let helped;for(let i=0;i<20;i++)helped=observe(helped,f,true,{help:1});
  assert.equal(target(helped,'auto').difficulty,'easy');
});
test('review advances 1, 3, 7 days only after due independent answers; error resets the interval',()=>{
  const f=plan.facets[0],D=Rules.DAY;let raw=observe(null,f,true,{at:100});
  const row=()=>Rules.scopeState(raw,plan.scopeId).facets[f.id];assert.equal(row().dueAt,100+D);
  raw=observe(raw,f,true,{at:200});assert.equal(row().dueAt,100+D);assert.equal(row().stage,0);
  raw=observe(raw,f,true,{at:100+D});assert.equal(row().dueAt,100+4*D);assert.equal(row().stage,1);
  raw=observe(raw,f,true,{at:100+4*D});assert.equal(row().dueAt,100+11*D);assert.equal(row().stage,2);
  raw=observe(raw,f,false,{at:100+5*D});assert.equal(row().stage,0);assert.equal(row().dueAt,100+6*D);
});
test('records isolate different scopes and cap retained scopes and observation identifiers',()=>{
  let raw;const f=plan.facets[0];for(let i=1;i<=30;i++)raw=Rules.record(raw,meta(f,{scopeId:i.toString(16).padStart(24,'0')}),{correct:true,at:i});
  assert.equal(Object.keys(raw.scopes).length,24);assert(!raw.scopes['1'.padStart(24,'0')]);
  for(let i=0;i<140;i++)raw=observe(raw,f,true,{id:'bounded_event_'+i,at:1000+i});
  assert.equal(Rules.scopeState(raw,plan.scopeId).seen.length,128);assert.equal(Rules.scopeState(raw,plan.scopeId).recent.length,8);
  assert.equal(Rules.scopeState(raw,'f'.repeat(24)).answered,0);
});
test('scope analysis is authenticated and uses the exact saved range and its grade',async()=>{
  const f=fixture();await assert.rejects(f.api.prepare({uid:'other',body:f.req.body}),e=>e.status===401);
  await assert.rejects(f.api.prepare({uid:'u1',body:{adaptiveScope:{...unit,detail:'天體運動'}}}),e=>e.status===409);assert.equal(f.calls.length,0);
  const c=await f.api.prepare(f.req);assert.equal(c.scope.level,'高中二年級');assert.equal(c.scope.subject,'物理');assert.equal(c.plan.provisional,false);
  assert.equal(Api.scopeFor({path:'數學/八下/單元',detail:'幾何'}).level,'國中二年級');
  f.db.docs.get('users/u1').gameSettings.sourceMode='random';await assert.rejects(f.api.prepare(f.req),e=>e.status===409);
});
test('AI decomposition is singleflight, persisted and reused across requests and server instances',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.api.prepare(f.req),f.api.prepare(f.req)]);
  assert.equal(f.calls.length,1);assert.equal(a.plan.version,b.plan.version);assert(f.db.docs.has('adaptiveScopePlans/'+scope.scopeId));
  const other=Api.createAdaptiveLearning({resolve:()=>({db:f.db}),verify:async()=> 'u1',generate:async()=>{throw Error('should not call');},logger:{warn(){}}});
  assert.equal((await other.prepare(f.req)).plan.source,'ai');assert.equal(f.calls.length,1);
});
test('failed AI analysis has an honest provisional fallback and retries rather than persisting a false AI outline',async()=>{
  let clock=1000,calls=0;const f=fixture({clock:()=>clock,generate:async()=>{calls++;throw Error('offline');}});
  const a=await f.api.prepare(f.req);assert.equal(a.plan.source,'rules');assert.equal(a.plan.concepts.length,6);assert.equal(f.db.docs.size,1);
  await f.api.prepare(f.req);assert.equal(calls,1);clock+=60001;await f.api.prepare(f.req);assert.equal(calls,2);
});
test('malformed AI outlines are rejected, while names and IDs remain stable under normalization',()=>{
  assert.throws(()=>Api.normalizePlan({concepts:[]},scope));assert.throws(()=>Api.normalizePlan({concepts:[{name:'x'},{name:'y'}]},scope));
  const a=Api.normalizePlan({concepts:Api.seedConcepts(scope)},scope),b=Api.normalizePlan({concepts:a.concepts},scope);
  assert.equal(a.version,b.version);assert.equal(a.scopeId,b.scopeId);assert.equal(a.facets.length,b.facets.length);
});
test('parallel facets have strict scope, method and difficulty binding and metadata has no provider credentials',async()=>{
  const f=fixture(),c=await f.api.prepare(f.req),assigned=[0,1,2].map(i=>c.target(i));assert.equal(new Set(assigned.map(x=>x.id)).size,3);
  const data={adaptive_scope_id:c.scope.scopeId,adaptive_facet_id:assigned[1].id,adaptive_difficulty:assigned[1].difficulty};
  assert(f.api.validate(c,data,1));assert.throws(()=>f.api.validate(c,data,0));assert.throws(()=>f.api.validate(c,{...data,adaptive_difficulty:'hard'},1));
  const m=f.api.metadata(c,data);assert.equal(m.facetId,assigned[1].id);assert.equal(m.outline.length,6);assert.equal(m.difficulty,'easy');
  assert(!JSON.stringify(m).includes('apiKey'));assert.match(f.api.prompt(c,1),/繩／桿／軌道/);
});
test('lesson is eligible only for the wrong concept, cached, and contains no identity or invented diagnosis of the student',async()=>{
  const f=fixture();await assert.rejects(f.api.lesson({...f.req,body:{...f.req.body,conceptId:plan.concepts[0].id}}),e=>e.status===409);
  let raw=observe(null,plan.facets[0],false);raw=observe(raw,plan.facets[1],false);f.db.docs.get('users/u1').stats.adaptiveLearningV1=raw;
  const request={...f.req,body:{...f.req.body,conceptId:plan.concepts[0].id}};
  const [a,b]=await Promise.all([f.api.lesson(request),f.api.lesson(request)]);assert.equal(a.through,2);assert.equal(a.explanation,b.explanation);
  assert.equal(f.calls.length,2);assert(!f.calls[1].includes('u1'));assert.match(f.calls[1],/不猜測學生錯因/);
});
test('matching spare selection preserves other valid fine methods and rejects newly stale history',()=>{
  const pool=createSparePool({similar:(a,b)=>a===b}),key=pool.key({owner:'u1',subject:'物理',topic:'圓周'});
  const a={data:{q:'第一考法',adaptive_facet_id:'a',template_id:'a'}},b={data:{q:'第二考法',adaptive_facet_id:'b',template_id:'b'}};
  pool.offer(key,a);pool.offer(key,b);assert.equal(pool.takeMatching(key,()=>true,d=>d.adaptive_facet_id==='b'?0:-1),b);assert.equal(pool.count(key),1);
  assert.equal(pool.takeMatching(key,()=>false,()=>0),null);assert.equal(pool.count(key),0);assert.equal(pool.offer(key,b),false);
});
