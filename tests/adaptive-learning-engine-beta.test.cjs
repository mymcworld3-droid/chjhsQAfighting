'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {betaEnabled,createStatusHandler,register}=require('../adaptive-learning-engine-beta-api.cjs');
const env={NODE_ENV:'test',ADAPTIVE_LEARNING_ENGINE_BETA:'1'};
function response(){return {code:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
async function check(options,request={}){const res=response();await createStatusHandler(options)(request,res);assert.equal(res.headers['Cache-Control'],'private, no-store');return res;}
test('adaptive Beta is opt-in only for test/development and release-locked in production',()=>{
  for(const e of [{},{NODE_ENV:'test'},{NODE_ENV:'production',ADAPTIVE_LEARNING_ENGINE_BETA:'1'},{ADAPTIVE_LEARNING_ENGINE_BETA:'1'},{NODE_ENV:'development',ADAPTIVE_LEARNING_ENGINE_BETA:'true'}])assert.equal(betaEnabled(e),false);
  assert.equal(betaEnabled(env),true);assert.equal(betaEnabled({...env,NODE_ENV:'development'}),true);
});
test('disabled gate does not authenticate or expose a preview, regardless of client input',async()=>{
  const res=await check({env:{},verify:()=>assert.fail('verify called while disabled')},{body:{enabled:true},query:{enabled:'1'}});
  assert.equal(res.code,404);assert.deepEqual(res.body,{ok:false,enabled:false});
});
test('enabled preview requires a verified main identity, fails closed on errors and returns no identity or data',async()=>{
  for(const status of [401,403,500]){const r=await check({env,verify:async()=>{throw Object.assign(Error('private detail'),{status});}});assert.equal(r.code,status===500?503:status);assert.deepEqual(r.body,{ok:false,enabled:false});}
  const empty=await check({env,verify:async()=>''});assert.equal(empty.code,401);
  const valid=await check({env,verify:async()=> 'fixture-user'});assert.deepEqual(valid.body,{ok:true,enabled:true,phase:'preview-shell'});
});
test('a flag disabled during identity verification cannot authorize entry',async()=>{
  const mutable={...env};const r=await check({env:mutable,verify:async()=>{mutable.ADAPTIVE_LEARNING_ENGINE_BETA='0';return 'u1';}});assert.equal(r.code,404);
});
test('independent route and hidden adjacent entry preserve old source-mode values and navigation',()=>{
  const routes=[];register({get:(route,handler)=>routes.push([route,handler])});assert.deepEqual(routes.map(r=>r[0]),['/api/adaptive-learning-engine-beta/status']);
  const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const html=read('public/index.html'),select=html.match(/<select id="set-source-mode"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['random','focused','bank']);
  assert.match(html,/<\/select>\s*<button id="adaptive-learning-beta-entry"[^>]*type="button" hidden/);
  assert.match(read('server.js'),/require\('\.\/adaptive-learning-engine-beta-api\.cjs'\)\.register\(app\)/);
  assert.match(read('public/cultivation/scope-fullscreen.js'),/if \(returnPage === 'page-settings'\) \{\s*void import\('\.\/adaptive-learning-engine-beta\.js'\)/);
  assert.match(read('public/styles/curriculum-studio.css'),/#adaptive-learning-beta-entry\[hidden\]\{display:none!important\}/);
});
