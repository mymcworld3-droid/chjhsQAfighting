'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../public/cultivation/admin-d1-migration.js'),'utf8').replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(r=>setImmediate(r));
function harness({enabled=true,backend='firestore',response={ok:true,status:200,payload:{status:'running',processed:2,discovered:5,copied:2,message:'正在搬遷'}},transport}={}){
  let callback;const requests=[],timers=[],panels=[];
  const auth={currentUser:null};
  function node(){const children=new Map();return {style:{},hidden:false,textContent:'',setAttribute(){},addEventListener(){},querySelector(selector){if(!children.has(selector))children.set(selector,{hidden:false,textContent:'',addEventListener(){}});return children.get(selector);},remove(){const i=panels.indexOf(this);if(i>=0)panels.splice(i,1);}};}
  const context={autoMigrationEnabled:enabled,dataBackend:backend,getApp:()=>({}),getAuth:()=>auth,
    onAuthStateChanged:(_auth,fn)=>{callback=fn;},document:{addEventListener(){},createElement:node,body:{append:p=>panels.push(p)}},window:{addEventListener(){}},AbortController,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},console,
    fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});if(transport)return transport(url,options);return {ok:response.ok,status:response.status,json:async()=>response.payload};}};
  vm.runInNewContext(source,context);
  return {requests,timers,panels,async login(uid){auth.currentUser=uid?{uid,getIdToken:async()=> 'id-token'}:null;callback?.(auth.currentUser);await flush();}};
}
test('admin-login client starts on authentication and polls only status after the first request',async()=>{
  const h=harness();await h.login('admin');assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.action,'start');
  assert.equal(h.panels.length,1);assert.match(h.panels[0].querySelector('[data-count]').textContent,/2.*5/);
  h.timers[0].fn();await flush();assert.equal(h.requests[1].body.action,'status');
  await h.login(null);assert.equal(h.panels.length,0);
});
test('ordinary players do not receive a migration panel or repeated status requests',async()=>{
  const h=harness({response:{ok:false,status:403,payload:{error:'僅限管理員'}}});await h.login('player');
  assert.equal(h.requests.length,1);assert.equal(h.panels.length,0);assert.equal(h.timers.length,0);
});
test('disabled migration and active D1 perform no login-triggered source requests',async()=>{
  for(const opts of [{enabled:false},{backend:'d1'}]){const h=harness(opts);await h.login('admin');assert.equal(h.requests.length,0);}
});
test('stale administrator response is discarded after an account switch',async()=>{
  let release;const h=harness({transport:()=>new Promise(r=>{release=r;})});await h.login('admin');await h.login(null);
  release({ok:true,status:200,json:async()=>({status:'running',processed:20,discovered:30})});await flush();assert.equal(h.panels.length,0);
});
