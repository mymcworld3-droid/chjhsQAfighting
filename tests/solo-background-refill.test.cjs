const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
const cacheSource = readFileSync(join(__dirname, '../public/solo-question-cache.js'), 'utf8');
const quiz = label => ({data:{q:label,opts:['A','B'],ans:0,exp:'解析'},rank:'煉氣',badge:'數學'});
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };

function harness({count=0,active=false,fetchQuestion}={}) {
  const events = {}, timers = [];
  let calls = 0;
  const context = vm.createContext({
    console:{warn(){}},
    auth:{currentUser:{uid:'player'}}, currentUserData:{}, soloCacheRevision:0,
    scope:'math', quizBuffer:[], BUFFER_SIZE:5,
    isFetchingBuffer:false, bufferFillPromise:null, bufferNextQuestionPromise:null,
    window:{__xiuxianFeaturesReady:true,__xiuxianMigrationApproved:true,
      addEventListener:(name,fn)=>{events[name]=fn;}},
    document:{hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}},
    setInterval:(fn,ms)=>{timers.push({fn,ms});},
    fetchOneQuestion:()=>{calls++;return fetchQuestion ? fetchQuestion(calls) : Promise.resolve(quiz('Q'+calls));}
  });
  vm.runInContext(cacheSource.replace(/^export /gm,'')+`
    const storage = new Map();
    const soloQuestionCache = createSoloQuestionCache({
      getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)
    });
    function soloQuestionScope(){return scope;}
    function syncSoloQuestionCache(){
      const uid=auth.currentUser?.uid;
      if(!uid||!currentUserData)return '';
      if(!soloQuestionCache.isCurrent(uid,scope)){
        soloQuestionCache.activate(uid,scope);soloCacheRevision++;
      }
      quizBuffer=soloQuestionCache.getQueue();return scope;
    }
    syncSoloQuestionCache();
    globalThis.cache=soloQuestionCache;
  `,context);
  for(let i=0;i<count;i++)context.cache.append(quiz('stored-'+i));
  if(active)context.cache.takeNext();
  vm.runInContext(source.slice(source.indexOf('function checkSoloQuestionStock()'),
    source.indexOf('// ==========================================\n//  Quiz UI Logic')),context);
  return {context,events,timers,calls:()=>calls};
}

function mountQuizFlow(h) {
  const nodes=new Map(), renders=[];
  const get=id=>{
    if(!nodes.has(id)){
      const classes=new Set(['hidden']);
      nodes.set(id,{innerText:'',classList:{
        add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)
      }});
    }
    return nodes.get(id);
  };
  Object.assign(h.context,{
    soloSession:{active:true,correctCount:0,wrongCount:0},
    soloQuizOpenSerial:0,answeredSoloQuizzes:new WeakSet(),
    extendedPracticeState:{active:false},switchToPage(){},
    renderQuiz(data){renders.push(data);get('quiz-loading').classList.add('hidden');},
    alert:message=>assert.fail(message)
  });
  h.context.document.getElementById=get;
  vm.runInContext(source.slice(source.indexOf('window.startQuizFlow ='),
    source.indexOf('// 🆕 單人模式選擇與啟動邏輯')),h.context);
  return {get,renders};
}

for(const background of [true,false])test(`empty buffer shows filling message before awaiting ${background?'background':'new'} question`,async()=>{
  const pending=[];
  const h=harness({fetchQuestion:()=>new Promise(resolve=>pending.push(resolve))});
  const ui=mountQuizFlow(h);
  if(background)h.context.checkSoloQuestionStock();
  const opening=h.context.window.startQuizFlow();
  assert.equal(ui.get('quiz-loading').classList.contains('hidden'),false);
  assert.equal(ui.get('loading-text').innerText,'正在填充題庫中');
  assert.equal(h.calls(),1,'opening shares any existing request');
  pending.shift()(quiz('ready'));await opening;
  assert.equal(ui.renders[0].q,'ready');
  assert.equal(ui.get('quiz-loading').classList.contains('hidden'),true);
  for(let i=0;i<4;i++){pending.shift()(quiz('more-'+i));await flush();}
});

test('available cached question opens directly without showing filling message',async()=>{
  const h=harness({count:5}), ui=mountQuizFlow(h);
  await h.context.window.startQuizFlow();
  assert.equal(ui.renders.length,1);
  assert.equal(ui.get('loading-text').innerText,'');
  assert.equal(h.calls(),0);
});

test('home-page stock check counts active plus queued questions and fills four to five',async()=>{
  const h=harness({count:4,active:true});
  h.context.checkSoloQuestionStock();await flush();
  assert.equal(h.calls(),1);
  assert.equal(h.context.cache.pendingCount(),5);
  assert.equal(h.context.cache.getActive().data.q,'stored-0');
  h.events['xiuxian:quest-progress-updated']();await flush();
  assert.equal(h.calls(),1,'full stock must not generate');
  h.context.cache.consumeActive();
  h.events['xiuxian:quest-progress-updated']();await flush();
  assert.equal(h.calls(),2);
  assert.equal(h.context.cache.pendingCount(),5);
});

test('empty stock fills to five without opening a quiz, and five queued questions need no work',async()=>{
  const empty=harness();empty.context.checkSoloQuestionStock();await flush();
  assert.equal(empty.calls(),5);assert.equal(empty.context.cache.pendingCount(),5);
  const full=harness({count:5});full.context.checkSoloQuestionStock();await flush();
  assert.equal(full.calls(),0);
});

test('startup checks stock before entering home or first-visit flows',()=>{
  const start=source.indexOf('// 所有腳本都已成功載入');
  const check=source.indexOf('checkSoloQuestionStock();',start);
  const home=source.indexOf('await enterHomeWithStartupCloudCurtain();',start);
  const firstVisit=source.indexOf('const arrival = window.getFirstVisitState?.();',start);
  assert.ok(check>start&&check<home&&check<firstVisit);
});

test('opening during refill shares the next request and does not wait for all five',async()=>{
  const pending=[];
  const h=harness({fetchQuestion:()=>new Promise(resolve=>pending.push(resolve))});
  const all=h.context.fillBuffer();
  h.context.checkSoloQuestionStock();
  let ready=false,complete=false;
  all.then(()=>{complete=true;});
  const first=h.context.fillBuffer({firstReady:true}).then(()=>{ready=true;});
  assert.equal(h.calls(),1,'one request despite several refill triggers');
  pending.shift()(quiz('first'));await first;
  assert.equal(ready,true);assert.equal(complete,false);
  assert.equal(h.context.cache.takeNext().data.q,'first');
  h.context.cache.consumeActive();
  let secondReady=false;
  const second=h.context.fillBuffer({firstReady:true}).then(()=>{secondReady=true;});
  await flush();assert.equal(secondReady,false,'wait for the current request, not an old readiness signal');
  pending.shift()(quiz('second'));await second;
  assert.equal(h.context.cache.takeNext().data.q,'second');
  for(let i=0;i<4;i++){pending.shift()(quiz('rest-'+i));await flush();}
  await all;assert.equal(h.context.cache.pendingCount(),5);
});

test('old scope responses are discarded and the new scope refills automatically',async()=>{
  const pending=[];
  const h=harness({fetchQuestion:()=>new Promise(resolve=>pending.push(resolve))});
  const old=h.context.fillBuffer();
  h.context.scope='geometry';h.context.checkSoloQuestionStock();
  pending.shift()(quiz('stale'));await old;await flush();
  assert.equal(h.context.cache.pendingCount(),0);
  assert.equal(h.calls(),2);
  for(let i=0;i<5;i++){pending.shift()(quiz('new-'+i));await flush();}
  assert.equal(h.context.cache.pendingCount(),5);
  assert.ok(h.context.cache.getQueue().every(q=>q.data.q.startsWith('new-')));
});

test('background checks recover from failure and do nothing after logout or before startup readiness',async()=>{
  const h=harness({fetchQuestion:n=>n===1?Promise.reject(Error('offline')):Promise.resolve(quiz('retry-'+n))});
  await h.context.fillBuffer();assert.equal(h.context.isFetchingBuffer,false);
  assert.equal(h.timers[0].ms,30000);
  h.timers[0].fn();await flush();assert.equal(h.context.cache.pendingCount(),5);
  h.context.cache.consumeActive();
  h.context.window.__xiuxianFeaturesReady=false;h.events.online();await flush();
  assert.equal(h.calls(),6);
  h.context.window.__xiuxianFeaturesReady=true;h.context.auth.currentUser=null;
  h.timers[0].fn();await flush();assert.equal(h.calls(),6);
});

test('logout during a request discards the response without generating more',async()=>{
  let release;
  const h=harness({fetchQuestion:()=>new Promise(resolve=>{release=resolve;})});
  const work=h.context.fillBuffer();
  h.context.auth.currentUser=null;h.context.currentUserData=null;
  h.context.cache.activate('','');h.context.soloCacheRevision++;
  release(quiz('old account'));await work;
  assert.equal(h.context.cache.pendingCount(),0);assert.equal(h.calls(),1);
  assert.equal(h.context.isFetchingBuffer,false);
});

test('switching away and back cannot restore an in-flight question from an earlier cache revision',async()=>{
  const pending=[];
  const h=harness({fetchQuestion:()=>new Promise(resolve=>pending.push(resolve))});
  const old=h.context.fillBuffer();
  h.context.scope='geometry';h.context.checkSoloQuestionStock();
  h.context.scope='math';h.context.checkSoloQuestionStock();
  pending.shift()(quiz('old math'));await old;await flush();
  assert.equal(h.context.cache.pendingCount(),0);
  for(let i=0;i<5;i++){pending.shift()(quiz('fresh-'+i));await flush();}
  assert.equal(h.context.cache.pendingCount(),5);
  assert.ok(h.context.cache.getQueue().every(q=>q.data.q.startsWith('fresh-')));
});
