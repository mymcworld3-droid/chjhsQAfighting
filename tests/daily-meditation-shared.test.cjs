'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb}=require('./helpers/inventory-db.cjs');
const {generated}=require('./helpers/meditation-literacy.cjs');
const {createDailySet,SETS,LEASE_MS,RETRY_MS}=require('../daily-meditation-set.cjs');
const {createService,SESSIONS,dayId}=require('../daily-meditation-api.cjs').__test;
const Rules=require('../public/cultivation/daily-meditation-rules.js');
const {createGenerator}=require('../daily-meditation-generator.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const INITIAL=Date.parse('2026-11-07T03:00:00Z');
function fixture({generate=async expected=>generated(expected)}={}){
  let time=INITIAL,calls=0;
  const db=fakeDb({uid:'u1',profile:{educationLevel:'國小四年級'},stats:{totalScore:68,gold:100},gameSettings:{sourceMode:'focused',focusedUnits:[{path:'數學/七年級',detail:'方程式'}]}});
  db.docs.set('users/u2',{uid:'u2',profile:{educationLevel:'高中三年級'},stats:{totalScore:68,gold:100},gameSettings:{sourceMode:'random'}});
  const queue=[],timers=[],heartbeats=[];
  const create=(extra={})=>createDailySet({db,now:()=>time,random:()=>.5,
    generate:(...args)=>{calls++;return generate(...args);},enqueue:fn=>queue.push(fn),
    logger:{warn(){}},setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimer:timer=>{timer.cancelled=true;},
    setHeartbeat:fn=>{const timer={fn};heartbeats.push(timer);return timer;},clearHeartbeat:timer=>{timer.cancelled=true;},...extra});
  const dailySets=create(), service=createService({db,now:()=>time,dailySets,random:()=>.5});
  const date=()=>Rules.meditationDateKey(new Date(time));
  async function run(){const pending=dailySets.whenIdle(date());queue.shift()();await pending;}
  return {db,dailySets,service,create,queue,timers,heartbeats,run,date,calls:()=>calls,advance:ms=>time+=ms};
}

test('login status queues a separate daily job before any meditation session, without waiting on generation',async()=>{
  let release;
  const f=fixture({generate:expected=>new Promise(resolve=>{release=()=>resolve(generated(expected));})});
  const user=structuredClone(f.db.docs.get('users/u1'));
  const status=await f.service.status('u1');await flush();
  assert.equal(status.session,null);assert.equal(f.queue.length,1);assert.equal(f.calls(),0);
  assert.equal(f.db.docs.has(SESSIONS+'/'+dayId('u1',f.date())),false);
  const work=f.dailySets.whenIdle(f.date());f.queue.shift()();await flush();
  assert.equal(f.calls(),1);
  // Even while the daily AI call remains pending, login/status and ordinary
  // quiz work can settle independently and the player's scope stays intact.
  const source=require('node:fs').readFileSync('public/main-legacy.js','utf8');
  let ordinaryCalls=0;
  const fetchQuiz=async()=>{ordinaryCalls++;return {ok:true,json:async()=>({text:JSON.stringify(generated({index:0,subject:'數學',form:'scenario-modeling'}))})};};
  const context={currentUserData:structuredClone(user),getRankName:()=> '煉氣',getSmartDifficulty:()=> 'medium',
    recentSoloQuestionContext:()=>({}),adaptiveQuestionContext:()=>({}),shuffleArray:x=>x,quizMetaFromRaw:()=>({}),
    window:{QAAdaptiveLearning:{fetchQuiz}},console:{log(){},warn(){},error(){}}};
  require('node:vm').runInNewContext(source.slice(source.indexOf('async function fetchOneQuestion(preferredUnit)'),
    source.indexOf('// 閉關三題沿用玩家目前選擇的出題範圍'))+'\nthis.fetchOne=fetchOneQuestion;',context);
  assert.ok((await context.fetchOne()).data.q);assert.equal(ordinaryCalls,1);
  assert.equal((await f.service.status('u2')).session,null);
  assert.deepEqual(f.db.docs.get('users/u1'),user);
  for(let i=0;i<5;i++){release();await flush();}
  await work;assert.equal(f.db.docs.get(SETS+'/'+f.date()).status,'ready');
});

test('simultaneous first logins on different server instances elect one five-question job',async()=>{
  const f=fixture(),other=f.create();
  await Promise.all(Array.from({length:20},(_,i)=>(i%2?other:f.dailySets).ensure('u'+i)));
  assert.equal(f.queue.length,1);await f.run();
  assert.equal(f.calls(),5);assert.equal(f.db.docs.get(SETS+'/'+f.date()).questions.length,5);
  await other.ensure('late-player');assert.equal(f.queue.length,0);assert.equal(f.calls(),5);
});

test('different grades and scopes receive identical questions, IDs, options and order with independent progress and rewards',async()=>{
  const f=fixture();await f.dailySets.ensure('u1');await f.run();
  let a=(await f.service.start('u1')).session,b=(await f.service.start('u2')).session;
  assert.notEqual(a.runId,b.runId);
  for(let i=0;i<5;i++){
    assert.deepEqual(a.question,b.question);
    assert.equal(a.index,i);assert.equal(b.index,i);
    assert.equal(a.questions,undefined);assert.equal(a.question.ans,undefined);assert.equal(a.question.exp,undefined);
    const expected=await f.service.prepareQuestion('u1');assert.deepEqual(expected.pending.question,a.question);
    const stored=f.db.docs.get(SETS+'/'+f.date()).questions[i];f.advance(1000);
    a=(await f.service.answer('u1',{questionId:a.question.id,choice:stored.data.ans,activeMs:1000})).session;
    assert.equal((await f.service.status('u2')).session.answered,i);
    b=(await f.service.answer('u2',{questionId:b.question.id,choice:(stored.data.ans+1)%4,activeMs:1000})).session;
    if(i<4){a=(await f.service.next('u1')).session;b=(await f.service.next('u2')).session;}
  }
  assert.equal((await f.service.finish('u1')).record.lastResult.correct,5);
  assert.equal((await f.service.finish('u2')).record.lastResult.correct,0);
  assert.equal(f.calls(),5);
  const before=structuredClone(f.db.docs.get('users/u1'));await f.service.finish('u1');assert.deepEqual(f.db.docs.get('users/u1'),before);
});

test('opening before the set is ready waits for the shared job and never generates personal replacement questions',async()=>{
  const f=fixture();
  const started=(await f.service.start('u1')).session;
  assert.equal(started.question,null);assert.equal(f.queue.length,0);assert.equal(f.calls(),0);
  await assert.rejects(f.service.prepareQuestion('u1'),error=>error.status===503&&/題庫正在準備/.test(error.message));
  assert.equal(f.calls(),0);
  await f.dailySets.ensure('u2');await f.run();
  const a=(await f.service.prepareQuestion('u1')).pending,b=(await f.service.start('u2')).session;
  assert.deepEqual(a.question,b.question);assert.equal(a.runId,started.runId);
  const stored=f.db.docs.get(SESSIONS+'/'+dayId('u1',f.date()));assert.equal(stored.answers.length,0);
  const issued=stored.issuedAtMs;f.advance(1000);await f.service.prepareQuestion('u1');
  assert.equal(f.db.docs.get(SESSIONS+'/'+dayId('u1',f.date())).issuedAtMs,issued);
});

test('failed jobs retain approved progress and retry in the background without any player opening meditation',async()=>{
  let failing=true;
  const f=fixture({generate:async expected=>{if(expected.index===2&&failing)throw Error('provider unavailable');return generated(expected);}});
  await f.dailySets.ensure('u1');await f.run();
  const partial=structuredClone(f.db.docs.get(SETS+'/'+f.date()));
  assert.equal(partial.status,'failed');assert.equal(partial.questions.length,2);
  assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,RETRY_MS);
  await f.dailySets.ensure('u2');assert.equal(f.queue.length,0,'failure cooldown prevents a request storm');
  failing=false;f.advance(RETRY_MS+1);f.timers[0].fn();await flush();
  assert.equal(f.queue.length,1);await f.run();
  const done=f.db.docs.get(SETS+'/'+f.date());assert.equal(done.status,'ready');
  assert.deepEqual(done.questions.slice(0,2),partial.questions);assert.equal(f.calls(),6);
});

test('a restarted server takes over an expired lease and the stale writer cannot replace the winning daily set',async()=>{
  let release;
  const f=fixture({generate:expected=>new Promise(resolve=>{release=()=>resolve(generated(expected,{q:generated(expected).q+'舊工作'}));})});
  await f.dailySets.ensure('u1');const old=f.dailySets.whenIdle(f.date());f.queue.shift()();await flush();
  f.advance(LEASE_MS+1);
  const newer=f.create({generate:async expected=>generated(expected,{q:generated(expected).q+'新工作'})});
  await newer.ensure('u2');const work=newer.whenIdle(f.date());f.queue.shift()();await work;
  const winning=structuredClone(f.db.docs.get(SETS+'/'+f.date()));assert.equal(winning.status,'ready');
  release();await old;assert.deepEqual(f.db.docs.get(SETS+'/'+f.date()),winning);
});

test('a failure retry replaces a longer lease-wait timer created by a later login',async()=>{
  let reject;
  const f=fixture({generate:()=>new Promise((resolve,no)=>{reject=no;})});
  await f.dailySets.ensure('u1');const work=f.dailySets.whenIdle(f.date());f.queue.shift()();await flush();
  await f.dailySets.ensure('u2');assert.equal(f.timers[0].ms,LEASE_MS);
  reject(Error('provider unavailable'));await work;
  assert.equal(f.timers[0].cancelled,true);assert.equal(f.timers[1].ms,RETRY_MS);
});

test('unexpired work surviving a server restart is rechecked after its lease, without blocking login',async()=>{
  const f=fixture();await f.dailySets.ensure('u1');
  const restarted=f.create();const status=await restarted.ensure('u2');
  assert.equal(status.status,'generating');assert.equal(f.queue.length,1);
  assert.equal(f.timers[0].ms,LEASE_MS);
  await f.run();assert.equal((await restarted.ensure('u2')).ready,true);
});

test('long independent review renews the daily lease so another login cannot schedule a duplicate job',async()=>{
  let release;
  const f=fixture({generate:expected=>new Promise(resolve=>{release=()=>resolve(generated(expected));})});
  await f.dailySets.ensure('u1');const work=f.dailySets.whenIdle(f.date());f.queue.shift()();await flush();
  f.advance(LEASE_MS-1000);f.heartbeats[0].fn();await flush();f.advance(2000);
  await f.create().ensure('u2');assert.equal(f.queue.length,0);
  for(let i=0;i<5;i++){release();await flush();}await work;
  assert.equal(f.db.docs.get(SETS+'/'+f.date()).status,'ready');assert.equal(f.heartbeats[0].cancelled,true);
});

test('Taiwan midnight starts a new shared day and prevents yesterday\'s in-flight response from publishing',async()=>{
  let release;
  const f=fixture({generate:expected=>new Promise(resolve=>{release=()=>resolve(generated(expected));})});
  const oldDate=f.date();await f.dailySets.ensure('u1');const old=f.dailySets.whenIdle(oldDate);f.queue.shift()();await flush();
  await f.service.start('u1');f.advance(24*3600000);
  release();await old;assert.notEqual(f.date(),oldDate);
  assert.equal(f.db.docs.get(SETS+'/'+oldDate).questions.length,0);
  const newer=f.create({generate:async expected=>generated(expected)});
  await newer.ensure('u2');const work=newer.whenIdle(f.date());f.queue.shift()();await work;
  const a=(await f.service.start('u1')).session;
  assert.equal(a.date,f.date());assert.equal(a.answered,0);assert.ok(a.question.id.includes(f.date()));
});

test('shared generation must pass an independent review and rejects uncertain or nonunique answers',async()=>{
  const f=fixture(),expected={...require('../daily-meditation-set.cjs').dailyPlan()[0],date:f.date(),index:0};
  const calls=[];
  const router={generateJSON:async(prompt,options)=>{
    calls.push(options);
    if(options.task==='quiz-generate'){
      const data=generated(expected);options.validate(data);return {data,model:'source-model'};
    }
    const data={approved:true,validIndices:[0,1],reason:'multiple answers'};options.validate(data);return {data};
  }};
  await assert.rejects(createGenerator(router)(expected),/獨立審核未通過/);
  assert.equal(calls.filter(x=>x.task==='quiz-generate').length,3);
  assert.ok(calls.filter(x=>x.task==='quiz-review').every(x=>x.excludeModels.includes('source-model')));
  router.generateJSON=async(prompt,options)=>{
    const data=options.task==='quiz-generate'?generated(expected):{approved:true,validIndices:[0],reason:'verified from text'};
    options.validate(data);return {data,model:'checked-model'};
  };
  assert.equal((await createGenerator(router)(expected)).q,generated(expected).q);
});

test('unknown, malformed and recall-only candidates never pass the daily generator validation',()=>{
  const {validate}=require('../daily-meditation-generator.cjs'),expected={...require('../daily-meditation-set.cjs').dailyPlan()[0],index:0};
  for(const patch of [{wrong:['一本想分享的書','球拍','泳衣']},{reasoning_steps:1},{reasoning_steps:undefined},{literacy_context:''},{q:'如圖所示，'+generated(expected).q}])
    assert.throws(()=>validate(generated(expected,patch),expected));
  assert.throws(()=>validate(generated(expected),expected,[generated(expected).q]),/重複/);
});

test('the shared answer document is not directly readable through the browser data API',()=>{
  const {mayRead}=require('../d1-browser-api.cjs');
  assert.equal(mayRead({role:'A',path:SETS+'/2026-11-07',data:{ownerUid:'u1',status:'ready'},uid:'u1',admin:false}),false);
  assert.equal(mayRead({role:'A',path:SETS+'/2026-11-07',data:{ownerUid:'u1',status:'ready'},uid:'u2',admin:false}),false);
});
