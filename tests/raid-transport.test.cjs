const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/cultivation/data/raid-transport.js','utf8')
  .replace(/^import .*;\n/,'').replace('export async function','async function');
function harness(fetch) {
  let expire,cleared=false;
  const context={AbortController,Promise,Error,JSON,authenticatedMainFetch:fetch,
    setTimeout(fn){expire=fn;return 1;},clearTimeout(){cleared=true;}};
  vm.runInNewContext(source+'\nthis.request=raidRequestJson;',context);
  return {request:context.request,expire:()=>expire(),cleared:()=>cleared};
}
test('a stalled token or network operation returns a retryable timeout',async()=>{
  let signal;
  const h=harness(async(_endpoint,init)=>{signal=init.signal;return new Promise(()=>{});});
  const work=h.request('/api/raid/room',{action:'player-action'});
  h.expire();
  await assert.rejects(work,error=>error.code==='raid-timeout'&&error.status===408);
  assert.equal(signal.aborted,true);
  assert.equal(h.cleared(),true);
});
test('the same timeout also bounds a stalled response body',async()=>{
  let reading;
  const h=harness(async()=>({ok:true,json(){reading=true;return new Promise(()=>{});}}));
  const work=h.request('/api/raid/room',{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reading,true);
  h.expire();await assert.rejects(work,error=>error.code==='raid-timeout');
});
test('successful and denied responses release the deadline and preserve server status',async()=>{
  const h=harness(async()=>({ok:true,json:async()=>({ok:true,room:{revision:2}})}));
  assert.equal((await h.request('/api/raid/room',{})).room.revision,2);
  assert.equal(h.cleared(),true);
  const denied=harness(async()=>({ok:false,status:403,json:async()=>({error:'not a member'})}));
  await assert.rejects(denied.request('/api/raid/room',{}),error=>error.status===403&&error.message==='not a member');
  assert.equal(denied.cleared(),true);
});
