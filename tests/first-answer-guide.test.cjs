'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
function guideHarness(records = {}) {
  const storage = new Map(Object.entries(records)), handlers = {}, timers = new Map();
  let layer = null, timerId = 0, page = 'home', blocked = false, player = { uid:'new' }, starts = 0;
  function node(id = '') {
    return { id, style:{}, textContent:'', setAttribute(){}, focus(){}, scrollIntoView(){},
      closest(selector){ return selector === '#' + id ? this : null; },
      getClientRects(){ return (id === 'page-home' && page !== 'home') || (id === 'page-quiz' && page !== 'quiz') ? [] : [{}]; },
      getBoundingClientRect(){return {left:20,right:200,top:500,bottom:550,height:140};} };
  }
  const nodes = Object.fromEntries(['page-home','page-quiz','quiz-container','btn-home-start','btn-report','quiz-helper-launcher'].map(id=>[id,node(id)]));
  const context = vm.createContext({ localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
    document:{documentElement:{clientWidth:390,clientHeight:844},getElementById:id=>nodes[id],querySelector:()=>blocked?{}:null,
      addEventListener:(name,fn)=>handlers[name]=fn,
      createElement(){ const children = new Map(), masks = Array.from({length:4},()=>node());
        return Object.assign(node(),{querySelector(selector){if(!children.has(selector))children.set(selector,node());return children.get(selector);},
          querySelectorAll:()=>masks,remove(){if(layer===this)layer=null;}}); },body:{append:el=>{layer=el;}}},
    window:{getCurrentUserData:()=>player,addEventListener(){},startQuizFlow:async()=>{starts++;page='quiz';}} });
  nodes['btn-home-start'].click=()=>handlers.click({target:nodes['btn-home-start'],preventDefault(){},stopImmediatePropagation(){}});
  vm.runInContext(read('cultivation/first-answer-guide.js'),context);
  return { window:context.window, storage, nodes, timers, layer:()=>layer, starts:()=>starts,
    tick(){for(const fn of [...timers.values()])fn();},block:value=>blocked=value,
    account:uid=>{player={uid};},page:value=>page=value };
}
const key = uid=>'qingyun:first-answer-guide:v1:'+uid;
const flush = ()=>new Promise(resolve=>setImmediate(resolve));
test('only a newly created or unfinished account gets the three short pointers', () => {
  const h=guideHarness(); h.window.scheduleFirstAnswerGuide('new',false);h.tick();assert.equal(h.layer(),null);
  h.window.scheduleFirstAnswerGuide('new',true);h.block(true);h.tick();assert.equal(h.layer(),null,'wait for character setup and startup curtain');
  h.block(false);h.tick();assert.equal(h.layer().querySelector('p').textContent,'從這裡開始答題。');
  assert.equal(h.starts(),0,'logging in never submits or generates a sample answer');
});
test('the real answer entry starts once, then report and helper pointers finish and never repeat', async () => {
  const h=guideHarness();h.window.scheduleFirstAnswerGuide('new',true);h.tick();
  h.layer().querySelector('[data-guide-next]').onclick();await flush();h.tick();
  assert.equal(h.starts(),1);assert.equal(h.layer().querySelector('p').textContent,'如果題目有問題，可以按下「題目有錯」。');
  h.layer().querySelector('[data-guide-next]').onclick();
  assert.equal(h.layer().querySelector('p').textContent,'有問題隨時提問！');
  h.layer().querySelector('[data-guide-next]').onclick();assert.equal(h.layer(),null);assert.equal(h.timers.size,0);
  h.window.scheduleFirstAnswerGuide('new',true);h.tick();assert.equal(h.layer(),null);
  assert.equal(JSON.parse(h.storage.get(key('new'))).status,'done');
});
test('an interrupted guide resumes on its own account; logout and account changes clear its overlay', () => {
  const h=guideHarness({[key('new')]:JSON.stringify({status:'pending',step:2})});
  h.window.scheduleFirstAnswerGuide('new');h.tick();assert.ok(h.layer());
  h.window.cancelFirstAnswerGuide();assert.equal(h.layer(),null);assert.equal(h.timers.size,0);
  h.window.scheduleFirstAnswerGuide('new');h.tick();h.account('other');h.tick();
  assert.equal(h.layer(),null);assert.equal(h.timers.size,0);assert.equal(JSON.parse(h.storage.get(key('new'))).status,'pending');
});
test('failed question entry restores the first pointer and permits a retry', async () => {
  const h=guideHarness();h.window.startQuizFlow=async()=>{throw Error('offline');};
  h.window.scheduleFirstAnswerGuide('new',true);h.tick();h.layer().querySelector('[data-guide-next]').onclick();await flush();
  assert.equal(h.layer().querySelector('p').textContent,'從這裡開始答題。');
  h.window.startQuizFlow=async()=>h.page('quiz');h.layer().querySelector('[data-guide-next]').onclick();await flush();h.tick();
  assert.equal(h.layer().querySelector('h2').textContent,'題目有錯');
});
test('setting the question scope opens the editor without scoring or abandoning an answer', () => {
  const legacy=read('main-legacy.js');
  const code=legacy.slice(legacy.indexOf('window.openQuizScopeSettings ='),legacy.indexOf('// 問道題目錯誤回報'));
  const calls=[],quiz={data:{q:'原題'},answered:false};
  const ctx=vm.createContext({isAnswering:false,window:{currentActiveQuiz:quiz,switchToPage:page=>calls.push(page),openCurriculumStudio:()=>calls.push('scope')}});
  vm.runInContext(code,ctx);assert.equal(ctx.window.openQuizScopeSettings(),true);assert.deepEqual(calls,['page-settings','scope']);
  assert.equal(ctx.window.currentActiveQuiz,quiz);assert.equal(quiz.answered,false);
  ctx.isAnswering=true;assert.equal(ctx.window.openQuizScopeSettings(),false);assert.equal(calls.length,2);
  assert.match(read('index.html'),/id="btn-giveup"[^>]*onclick="openQuizScopeSettings\(\)"[\s\S]*?<span[^>]*>設定範圍<\/span>/);
});

test('arrival schedules the guide per account even on a device that already completed another arrival', async () => {
  const source=read('cultivation/first-visit.js');
  const code=source.slice(source.indexOf('  window.handleFirstVisitReady ='),source.indexOf('  window.openFirstVisitAccountBinding ='));
  const calls=[],state={version:1,stage:'done',completed:true};
  const ctx=vm.createContext({window:{scheduleFirstAnswerGuide:(uid,isNew)=>calls.push([uid,isNew])},
    Rules:require('../public/cultivation/first-visit-rules.js'),user:null,state,
    removeLayer(){},store:patch=>Object.assign(state,patch),gender(){},$:()=>({classList:{remove(){}}})});
  vm.runInContext(code,ctx);
  const guest={uid:'fresh-guest',isAnonymous:true};
  await ctx.window.handleFirstVisitReady(guest,{stats:{totalScore:0}},true);
  assert.deepEqual(calls,[['fresh-guest',true]]);
  await ctx.window.handleFirstVisitReady(guest,{stats:{totalScore:0}},false);
  assert.deepEqual(calls.at(-1),['fresh-guest',false]);
});
