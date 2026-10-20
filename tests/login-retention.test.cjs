'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {queueAnalyticsCleanup}=require('../analytics-retention.cjs');
const register=require('../player-analytics-api.cjs');
const HOUR=3600000;

test('simultaneous player arrivals share one cleanup Worker request, then an hourly cooldown',async()=>{
  const batches=[];
  const db={isD1:true,role:'A',gateway:async statements=>{batches.push(statements);return [{},{meta:{changes:500}},{}];}};
  const task=queueAnalyticsCleanup(db,{now:1000});
  for(let i=0;i<100;i++)assert.equal(queueAnalyticsCleanup(db,{now:1000}),false);
  assert.equal(await task,true);assert.equal(batches.length,1);assert.equal(batches[0].length,3);
  assert.equal(queueAnalyticsCleanup(db,{now:1000+HOUR-1}),false);
  assert.equal(await queueAnalyticsCleanup(db,{now:1000+HOUR}),true);
  assert.equal(batches.length,2);
});
test('an empty indexed sweep defers further Worker requests for twelve hours',async()=>{
  let requests=0;
  const db={isD1:true,role:'A',gateway:async()=>{requests++;return [{},{meta:{changes:0}},{}];}};
  await queueAnalyticsCleanup(db,{now:1000});
  for(let hour=1;hour<12;hour++)assert.equal(queueAnalyticsCleanup(db,{now:1000+hour*HOUR}),false);
  assert.equal(requests,1);
  await queueAnalyticsCleanup(db,{now:1000+12*HOUR});assert.equal(requests,2);
});
test('cleanup errors are swallowed and cannot cause repeated requests from subsequent logins',async()=>{
  let requests=0,warnings=0;
  const db={isD1:true,role:'A',gateway:async()=>{requests++;throw Error('quota exhausted');}};
  const logger={warn(){warnings++;}};
  assert.equal(await queueAnalyticsCleanup(db,{now:1000,logger}),false);
  for(let i=0;i<100;i++)assert.equal(queueAnalyticsCleanup(db,{now:1000+i,logger}),false);
  assert.equal(requests,1);assert.equal(warnings,1);
  await queueAnalyticsCleanup(db,{now:1000+HOUR,logger});assert.equal(requests,2);
});
test('legacy stores and secondary namespaces never trigger cleanup',()=>{
  const gateway=()=>{throw Error('must not be called');};
  for(const db of [{gateway},{isD1:true,role:'BD',gateway},{isD1:true,role:'C',gateway}]){
    assert.equal(queueAnalyticsCleanup(db),false);
  }
});
test('only authenticated arrivals trigger cleanup, after the response, without awaiting it',async()=>{
  const routes=new Map(),today=register.__test.dayOf(new Date());
  const db={collection(){return {doc(){return {get:async()=>({exists:true,data:()=>({lastDay:today,seenDays:[today]})})};}};},
    runTransaction:async fn=>fn({get:ref=>ref.get(),set(){},update(){}})};
  let cleanupCalls=0,sent=false;
  const a={db,auth:{verifyIdToken:async token=>{
    if(token==='bad')throw Error('expired');
    return {uid:'alice',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'};
  }}};
  register({post:(path,handler)=>routes.set(path,handler)},{resolve:()=>a,
    cleanup(given){assert.equal(given,db);assert.equal(sent,true);cleanupCalls++;return new Promise(()=>{});}});
  async function visit(token=''){
    sent=false;let status=200;
    const res={set(){},status(code){status=code;return this;},json(){sent=true;}};
    await routes.get('/api/analytics/visit')({get:name=>name==='authorization'?token:name==='cookie'?'qa_analytics_vid='+'a'.repeat(32):''},res);
    return status;
  }
  assert.equal(await visit(),200);assert.equal(cleanupCalls,0);
  assert.equal(await visit('Bearer bad'),401);assert.equal(cleanupCalls,0);
  assert.equal(await visit('Bearer good'),200);assert.equal(cleanupCalls,1);
});
test('Worker configuration removes fixed cron invocations',async()=>{
  const config=JSON.parse(fs.readFileSync(require.resolve('../cloudflare/d1/wrangler.jsonc'),'utf8'));
  assert.deepEqual(config.triggers.crons,[]);
  const {default:worker}=await import('../cloudflare/d1/src/worker.mjs');
  assert.equal(worker.scheduled,undefined);
});
