'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),vm=require('node:vm');
const {D1Store}=require('../d1-store.cjs');
const {ReadBatcher}=require('../d1-read-batcher.cjs');
const {setup}=require('./helpers/d1-db.cjs');
const {registerD1BrowserApi}=require('../d1-browser-api.cjs');
const {streamRaidRoom}=require('../raid-room-stream.cjs');
const router=require('../ai-router.js');

test('a closed data stream during its initial read never creates a listener or writes headers',async()=>{
  const {gateway}=setup();let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const db=new D1Store('A',{gateway:async statements=>{const result=await gateway(statements);entered();await gate;return result;}});
  const routes={};registerD1BrowserApi({get(){},post:(path,handler)=>{routes[path]=handler;}},{env:{GAME_DATA_BACKEND:'d1'},store:()=>db,
    resolve:()=>({auth:{verifyIdToken:async()=>({uid:'u',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}})});
  let opened=false;
  const req=new EventEmitter();Object.assign(req,{get:()=>'Bearer token',body:{action:'watch',target:{role:'A',path:'rooms/r',kind:'doc'}}});
  const res=new EventEmitter();Object.assign(res,{set(){return this;},flushHeaders(){opened=true;},status(){return this;},json(){throw Error('closed response');}});
  const pending=routes['/api/data'](req,res);await started;
  res.destroyed=true;res.emit('close');release();await pending;
  assert.equal(opened,false);assert.equal(db.watchers.size,0);
});
test('a raid subscription already closed before authentication completes does no work',()=>{
  let subscribed=false,settled=false;
  streamRaidRoom({req:{aborted:true},res:{},ref:{onSnapshot(){subscribed=true;}},uid:'u',initialRoom:{members:{u:{}}},settleSpirit:()=>{settled=true;}});
  assert.equal(subscribed,false);assert.equal(settled,false);
});
test('throwing cached and error listeners cannot crash delivery to other subscribers',async t=>{
  t.mock.method(console,'error',()=>{});
  const {gateway}=setup();let broken=false;
  const db=new D1Store('A',{gateway:statements=>broken?Promise.reject(Error('offline')):gateway(statements),pollMs:60000});
  const ref=db.doc('users/u');let initial;
  const ready=new Promise(resolve=>{initial=resolve;});
  const stop=ref.onSnapshot(()=>initial(),()=>{});t.after(stop);await ready;
  const stopBroken=ref.onSnapshot(()=>{throw Error('UI callback failed');},()=>{throw Error('error callback failed');});t.after(stopBroken);
  let errors=0;const stopOther=ref.onSnapshot(()=>{},()=>{errors++;});t.after(stopOther);
  await new Promise(resolve=>setImmediate(resolve));
  broken=true;await [...db.watchers.values()][0].tick();assert.equal(errors,1);
});
test('invalid read parameters cannot poison an unrelated coalesced batch',async()=>{
  const sent=[];const batcher=new ReadBatcher(async statements=>{sent.push(statements);return statements.map(()=>({results:[]}));});
  const results=await Promise.allSettled([
    batcher.read({sql:'SELECT 1',params:[]}),
    batcher.read({sql:'SELECT ?',params:[{not:'a SQL binding'}]}),
    batcher.read({sql:'SELECT 2',params:[]})
  ]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','rejected','fulfilled']);
  assert.equal(sent.length,1);assert.equal(sent[0].length,2);
  await assert.rejects(batcher.read({sql:'SELECT ?',params:[Infinity]}),e=>e.code==='invalid-argument');
});
test('avatar and cosmetic markup escapes stored HTML, attributes and non-string legacy values',()=>{
  const legacy=fs.readFileSync(require.resolve('../public/main-legacy.js'),'utf8');
  const escape=legacy.slice(legacy.indexOf('function escapeHtml(text)'),legacy.indexOf('// 新增：將 Markdown'));
  const render=legacy.slice(legacy.indexOf('function renderVisual('),legacy.indexOf('window.updateUserAvatarDisplay ='));
  const context=vm.createContext({});vm.runInContext(escape+render,context);
  const payload='x.png" onerror="globalThis.pwned=true"><svg onload="globalThis.pwned=true">';
  const css='gold" onclick="globalThis.pwned=true';
  for(const html of [context.getAvatarHtml({frame:payload,avatar:payload}),context.getAvatarHtml({frame:css}),
    context.renderVisual('frame',payload),context.renderVisual('avatar',payload),context.renderVisual('frame',css)]){
    assert.doesNotMatch(html,/<svg|on(?:error|load|click)="globalThis/);
    assert.match(html,/&quot;/);
  }
  assert.doesNotThrow(()=>context.getAvatarHtml({frame:{},avatar:[]},undefined,'https://example.test/a.png'));
  assert.equal(context.escapeHtml(42),'42');assert.equal(context.escapeHtml(null),'');
});
test('AI provider errors redact raw and URL-encoded keys before returning or logging them',async t=>{
  const names=['GEMINI_API_KEY','GEMINI_API_KEYS','OPENAI_API_KEY','OPENAI_MODEL','AI_PROVIDERS_JSON'];
  const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];});
  const key='private-key+/audit';for(const name of names)delete process.env[name];
  process.env.AI_PROVIDERS_JSON=JSON.stringify([{name:'test',type:'openai-compatible',model:'m',baseUrl:'https://example.test/v1',apiKey:key}]);
  const logged=[];t.mock.method(console,'warn',message=>logged.push(message));
  t.mock.method(global,'fetch',async()=>{throw Error('HTTP 403 ?key='+encodeURIComponent(key)+' Authorization: Bearer '+key+' JSON '+key);});
  await assert.rejects(router.generateJSON('test'),error=>{
    assert.ok(!error.message.includes(key));assert.ok(!error.message.includes(encodeURIComponent(key)));assert.match(error.message,/REDACTED/);return true;
  });
  assert.ok(logged.length>0);assert.ok(logged.every(message=>!message.includes(key)&&!message.includes(encodeURIComponent(key))));
});
test('successful AI deadline clears its timeout, while a stalled request still times out',async t=>{
  const clear=t.mock.method(global,'clearTimeout');
  assert.equal(await router.withDeadline(Promise.resolve('done'),10000),'done');
  assert.equal(clear.mock.callCount(),1);
  await assert.rejects(router.withDeadline(new Promise(()=>{}),5),/timeout/);
});
test('room event parser rejects an unbounded partial packet and releases the reader',async()=>{
  const code=fs.readFileSync(require.resolve('../public/cultivation/data/room-event-stream.js'),'utf8').replace(/^export /gm,'');
  const parse=vm.runInNewContext(code+'\nreadRoomEvents',{TextDecoder});
  let cancelled=false;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+'x'.repeat(4_000_001)));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(parse(response,()=>{},new AbortController().signal),e=>e.status===413);assert.equal(cancelled,true);
});
test('the patched UUID dependency preserves its callers v4 API and rejects out-of-bounds v5 buffers',()=>{
  const {createRequire}=require('node:module');
  for(const parent of ['google-gax','gaxios','teeny-request']){
    const uuid=createRequire(require.resolve(parent))('uuid');
    assert.match(uuid.v4(),/^[0-9a-f-]{36}$/);
    assert.throws(()=>uuid.v5('audit',uuid.v5.DNS,new Uint8Array(8),4),RangeError);
  }
});
