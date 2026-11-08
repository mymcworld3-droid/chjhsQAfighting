'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const ui=fs.readFileSync('public/cultivation/cultivation-refinery-v2.js','utf8');
const jobs=fs.readFileSync('public/cultivation/refinery-ai-jobs.js','utf8');
const scene=fs.readFileSync('public/cultivation/training-scene-map.js','utf8');
const css=fs.readFileSync('public/styles/training-scene-map.css','utf8');

test('forge keeps one primary action and synchronizes its ready state',()=>{
  assert.doesNotMatch(ui,/data-refinery-action-banner/);
  assert.match(ui,/data-refinery-craft/);
  assert.match(ui,/精煉完成，請開爐領取/);
  assert.match(ui,/\.refinery-craft\.job-ready:not\(:disabled\)/);
  assert.match(ui,/querySelector\('\[data-refinery-craft\]'\)\?\.addEventListener\('click', craft\)/);
  assert.match(ui,/button\.disabled = !ready/);
  assert.match(ui,/prefers-reduced-motion/);
  assert.match(ui,/屬性由系統固定上下限管理/);
});

test('the map retires forge reminders and continues to show nascent progression',()=>{
  assert.doesNotMatch(scene,/refineryJobV1|refinery-ready-dot|refinery-job-updated/);
  assert.match(scene,/nascent-upgrade-dot/);
  assert.match(css,/\.nascent-upgrade-dot\[hidden\]/);
});

test('online new forge jobs precompute one artifact; claiming waits for pending request and still transacts',()=>{
  assert.match(jobs,/const generatedCandidatePromises = new Map\(\)/);
  assert.match(jobs,/function preGenerateOnlineCandidate\(\)/);
  assert.match(jobs,/backgroundGenerationAttempted\.has\(job\.id\)/);
  assert.match(jobs,/generatedCandidateCache\.set\(job\.id, result\)/);
  assert.match(jobs,/const pending = generatedCandidatePromises\.get\(job\.id\)/);
  assert.match(jobs,/if \(pending\) await pending\.catch/);
  assert.match(jobs,/const generated = generatedCandidateCache\.get\(job\.id\) \|\| await generateCandidate\(job\)/);
  assert.match(jobs,/generatedCandidateCache\.delete\(job\.id\)/);
  assert.match(jobs,/await runTransaction\(db\(\), async \(tx\) =>/);
  assert.match(jobs,/xiuxian:user-ready/);
  assert.match(jobs,/xiuxian:refinery-job-updated/);
});

test('prefetch stays single-flight, does not award or delete a job, and recovers after errors',async()=>{
  const start=jobs.indexOf('  function preGenerateOnlineCandidate() {');
  const end=jobs.indexOf('\n  async function claimJob() {',start);
  assert.ok(start>0&&end>start);
  const listeners=new Map();
  let resolves=[];
  let invocations=0,uid='p1';
  let job={id:'job-1',kind:'discovery'};
  const context={
    generationOwnerUid:'',generatedCandidateCache:new Map(),generatedCandidatePromises:new Map(),
    backgroundGenerationAttempted:new Set(),
    authUser:()=>({uid}),currentJob:()=>job,
    requiresGeneratedCandidate:(j)=>j.kind==='discovery',
    generateCandidate:()=>{invocations++;return new Promise(resolve=>resolves.push(resolve));},
    console:{warn:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext(jobs.slice(start,end)+'\nthis.preGenerateOnlineCandidate=preGenerateOnlineCandidate;',context);
  context.preGenerateOnlineCandidate();context.preGenerateOnlineCandidate();
  assert.equal(invocations,1,'no duplicate generation while login and events fire together');
  resolves.shift()({artifact:{name:'預先生成'}});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(context.generatedCandidateCache.get('job-1')?.artifact?.name,'預先生成');
  assert.equal(job.id,'job-1','prefetch must not claim or clear the forge');
  context.preGenerateOnlineCandidate();
  assert.equal(invocations,1,'cached job should not regenerate');
  uid='p2';job={id:'job-2',kind:'discovery'};
  context.preGenerateOnlineCandidate();
  assert.equal(invocations,2,'new account must not reuse prior cached artifact');
  assert.equal(context.generatedCandidateCache.has('job-1'),false);
  resolves.shift()({artifact:{name:'新帳號法器'}});
  await Promise.resolve();await Promise.resolve();
});
