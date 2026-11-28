'use strict';
// Fixture responses only; the audit CLI is not run against production by CI.
const test=require('node:test'),assert=require('node:assert/strict');
const {audit,d1Probe,rulesProbe}=require('../scripts/audit-adaptive-beta-deployment.cjs');
const env={GAME_DATA_BACKEND:'d1',D1_WORKER_URL:'https://gateway.example.invalid',D1_SERVICE_TOKEN:'private-token-'.repeat(3),ADAPTIVE_LEARNING_ENGINE_BETA:'1'};
const ruleToken='secret-fixture-token',project='question-learning',name='projects/'+project+'/rulesets/fixture',release='projects/'+project+'/releases/cloud.firestore';
const resolve=()=>({app:{options:{projectId:project,credential:{getAccessToken:async()=>({access_token:ruleToken})}}},db:{listCollections:async()=>[{id:'users'}]}});
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
function fixture(calls,counts=[]){
  return async(url,init)=>{
    calls.push({url,init});assert.equal(init.redirect,'error');
    if(url.startsWith('https://firebaserules.googleapis.com/')){
      assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer '+ruleToken);
      if(url.endsWith(release))return response(200,{name:release,rulesetName:name});
      if(url.endsWith(name))return response(200,{name,source:{files:[{name:'firestore.rules',content:'fixture rules not proof of access'}]}});
      assert.fail('unexpected Rules path');
    }
    assert.equal(url,'https://gateway.example.invalid/query');assert.equal(init.method,'POST');
    const body=JSON.parse(init.body);assert.equal(body.statements.length,1);assert.match(body.statements[0].sql,/^SELECT /);
    assert.deepEqual(body.statements[0].params,['adaptiveEngineBeta'.length,'adaptiveEngineBeta']);
    if(!init.headers.Authorization)return response(401,{});
    assert.equal(init.headers.Authorization,'Bearer '+env.D1_SERVICE_TOKEN);
    return response(200,{success:true,result:[{results:counts}]});
  };
}
test('readonly probes report hash and namespace counts without secrets or claiming stage approval',async()=>{
  const calls=[];const result=await audit({env,resolve,fetchFn:fixture(calls,[{namespace:'A',count:2}])});
  assert.equal(result.readOnlyChecksPassed,true);assert.equal(result.stage2Approval,false);
  assert.equal(result.productionBetaEnabled,false);assert.match(result.firestore.rulesetHash,/^[0-9a-f]{64}$/);
  assert.deepEqual(result.d1.reservedDocumentCounts,{A:2,BD:0,C:0});
  assert.equal(calls.length,4);
  const json=JSON.stringify(result);
  for(const secret of [ruleToken,env.D1_SERVICE_TOKEN,'fixture rules not proof of access'])assert.ok(!json.includes(secret));
});
test('unexpected anonymous access is reported without sending D1 credentials',async()=>{
  let calls=0;const result=await d1Probe({env,fetchFn:async(_url,init)=>{calls++;assert.equal(init.headers.Authorization,undefined);return response(200,{});}});
  assert.equal(result.status,'anonymous-access-not-denied');assert.equal(calls,1);
});
test('wrong namespace and reserved Firestore collections block readonly checks',async()=>{
  const result=await audit({env,resolve:()=>({...resolve(),db:{listCollections:async()=>[{id:'adaptiveEngineBetaV1_scope'}]}}),fetchFn:fixture([],[{namespace:'BD',count:1}])});
  assert.equal(result.readOnlyChecksPassed,false);assert.equal(result.firestore.status,'unexpected-reserved-collections');assert.equal(result.d1.status,'unexpected-beta-namespace');
});
test('wrong ruleset project or gateway credentials never cause unsafe outbound requests',async()=>{
  await assert.rejects(rulesProbe({resolve,fetchFn:async()=>response(200,{name:release,rulesetName:'projects/other/rulesets/fixture'})}),/mismatch/);
  for(const url of ['http://example.invalid','https://user:password@example.invalid','https://example.invalid/path','https://example.invalid/?token=secret']){
    await assert.rejects(d1Probe({env:{...env,D1_WORKER_URL:url},fetchFn:()=>assert.fail('unsafe request')}));
  }
  const result=await audit({env:{},resolve:()=>{throw Error('private-secret');},fetchFn:()=>assert.fail('missing credentials')});
  assert.equal(result.readOnlyChecksPassed,false);assert.ok(!JSON.stringify(result).includes('private-secret'));
});
