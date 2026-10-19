'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {setup}=require('./helpers/d1-db.cjs');
test('private Worker rejects browser and wrong bearer requests, batches atomically',async()=>{
  const {default:worker}=await import(pathToFileURL(require.resolve('../cloudflare/d1/src/worker.mjs')));
  const {gateway,sql}=setup(),SERVICE_TOKEN='x'.repeat(48);
  const env={SERVICE_TOKEN,DB:{prepare:sql=>({bind:(...params)=>({sql,params})}),batch:gateway}};
  const request=(statements,token=SERVICE_TOKEN)=>new Request('https://gateway.example/query',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({statements})});
  assert.equal((await worker.fetch(request([],''),env)).status,401);
  assert.equal((await worker.fetch(request([],'wrong'),env)).status,401);
  let response=await worker.fetch(request([{sql:"INSERT INTO d1_version_guard VALUES ('bad',0)"}]),env);
  assert.equal(response.status,409);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM d1_version_guard').get().n,0);
  response=await worker.fetch(request([{sql:'SELECT 1 AS ok'}]),env);assert.equal(response.status,200);assert.equal((await response.json()).result[0].results[0].ok,1);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
});
