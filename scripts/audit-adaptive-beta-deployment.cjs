#!/usr/bin/env node
'use strict';
// Read-only deployment probes. Never prints credentials, rules content, UID,
// document paths or player data. A successful probe is NOT stage 2 approval.
const {createHash}=require('node:crypto');
const {PROJECT_IDS,adminProject}=require('../firebase-admin-projects.cjs');
const {PREFIX}=require('../adaptive-learning-engine-beta-store.cjs');
const {betaEnabled}=require('../adaptive-learning-engine-beta-api.cjs');
const RULES_ROOT='https://firebaserules.googleapis.com/v1/';
const project=PROJECT_IDS.A;
const releaseName='projects/'+project+'/releases/cloud.firestore';
const validRuleset=name=>typeof name==='string'&&name.startsWith('projects/'+project+'/rulesets/')&&/^[A-Za-z0-9_-]+$/.test(name.slice(('projects/'+project+'/rulesets/').length));
async function rulesProbe({resolve,fetchFn}){
  const {app,db}=resolve();
  if(app?.options?.projectId!==project||db?.isD1)throw Error('Wrong Firestore project');
  const credential=app.options.credential;
  const token=(await credential.getAccessToken()).access_token;
  if(typeof token!=='string'||!token)throw Error('No token');
  async function read(name){
    const res=await fetchFn(RULES_ROOT+name,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw Error('Rules read failed');
    return res.json();
  }
  const release=await read(releaseName);
  if(release.name!==releaseName||!validRuleset(release.rulesetName))throw Error('Rules release mismatch');
  const rules=await read(release.rulesetName);
  if(rules.name!==release.rulesetName||!Array.isArray(rules.source?.files)||!rules.source.files.length||rules.source.files.some(f=>typeof f.name!=='string'||typeof f.content!=='string'))throw Error('Invalid rules source');
  const digest=createHash('sha256').update(JSON.stringify(rules.source.files.map(f=>[f.name,f.content]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
  const collections=await db.listCollections();
  const reservedCount=collections.filter(c=>typeof c.id==='string'&&c.id.startsWith(PREFIX)).length;
  return {status:reservedCount===0?'read-confirmed':'unexpected-reserved-collections',rulesetHash:digest,reservedCollectionCount:reservedCount,ruleSemantics:'manual-review-required'};
}
function gatewayURL(env){
  const u=new URL(env.D1_WORKER_URL);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Invalid D1 URL');
  return new URL('/query',u).href;
}
async function d1Probe({env,fetchFn}){
  const endpoint=gatewayURL(env);
  const token=env.D1_SERVICE_TOKEN;
  if(typeof token!=='string'||token.length<32)throw Error('Missing D1 credential');
  // Fixed SELECT only; no SQL, UID or path supplied by an operator or model.
  const body=JSON.stringify({statements:[{sql:'SELECT namespace, COUNT(*) AS count FROM documents WHERE substr(path,1,?)=? GROUP BY namespace',params:[PREFIX.length,PREFIX]}]});
  const request=headers=>fetchFn(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body,redirect:'error',signal:AbortSignal.timeout(20000)});
  const denied=await request({});
  // Never send credentials if the gateway unexpectedly accepts anonymous queries.
  if(denied.status!==401)return {status:'anonymous-access-not-denied',httpStatus:denied.status};
  const response=await request({Authorization:'Bearer '+token});
  if(!response.ok)throw Error('Authenticated D1 read failed');
  const payload=await response.json();
  const rows=payload?.result?.[0]?.results;
  if(payload?.success!==true||!Array.isArray(rows)||rows.some(row=>!['A','BD','C'].includes(row.namespace)||!Number.isSafeInteger(row.count)||row.count<0)||new Set(rows.map(r=>r.namespace)).size!==rows.length)throw Error('Unexpected D1 response');
  const counts={A:0,BD:0,C:0};
  for(const row of rows)counts[row.namespace]=row.count;
  return {status:counts.BD||counts.C?'unexpected-beta-namespace':'read-confirmed',anonymousDenied:true,reservedDocumentCounts:counts};
}
async function audit({env=process.env,fetchFn=fetch,resolve=()=>adminProject('A',{env:{...env,GAME_DATA_BACKEND:'firestore'}})}={}){
  const result={mode:'read-only',backend:['d1','firestore'].includes(env.GAME_DATA_BACKEND)?env.GAME_DATA_BACKEND:env.GAME_DATA_BACKEND?'invalid':'firestore-default',productionBetaEnabled:betaEnabled({...env,NODE_ENV:'production'}),storageRequired:env.ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED==='1',lifecycleEnabled:env.ADAPTIVE_LEARNING_ENGINE_LIFECYCLE_ENABLED==='1',firestore:{status:'unavailable'},d1:{status:'unavailable'},stage2Approval:false};
  // Do not leak upstream error messages; they may contain URLs, SQL or credentials.
  try{result.firestore=await rulesProbe({resolve,fetchFn});}catch(_){}
  try{result.d1=await d1Probe({env,fetchFn});}catch(_){}
  result.readOnlyChecksPassed=result.firestore.status==='read-confirmed'&&result.d1.status==='read-confirmed'&&!result.productionBetaEnabled;
  result.remaining=['review effective Firestore rules (including overlapping allow matches)','verify Auth lifecycle with isolated test account','verify isolated D1 restore and backup retention','confirm deployment SHA and backend'];
  return result;
}
async function main(){
  if(process.argv.slice(2).join(' ')!=='--read-only'){console.error('Usage: node scripts/audit-adaptive-beta-deployment.cjs --read-only');process.exitCode=2;return;}
  require('dotenv').config({quiet:true});
  const report=await audit();console.log(JSON.stringify(report,null,2));
  if(!report.readOnlyChecksPassed)process.exitCode=2;
}
if(require.main===module)main().catch(()=>{console.error('Read-only audit unavailable');process.exitCode=2;});
module.exports={audit,rulesProbe,d1Probe};
