'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const FieldValue={serverTimestamp:()=>0,increment:n=>({__increment:n})};
const sandbox={module:{exports:{}},require:id=>id==='firebase-admin/firestore'?{FieldValue}:require(id.startsWith('./') ? '../'+id.slice(2) : id),console,Date};
vm.runInNewContext(fs.readFileSync(require.resolve('../dongtian-settlement-api.cjs'),'utf8'),sandbox);
const api=sandbox.module.exports.__test;
function fakeDb(seed={}) {
 const docs=new Map(Object.entries(seed).map(([k,v])=>[k,structuredClone(v)]));let queue=Promise.resolve();
 const snap=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const merge=(old,patch)=>{const out=structuredClone(old||{});for(const[k,v]of Object.entries(patch)){const parts=k.split('.');let target=out;for(const p of parts.slice(0,-1))target=target[p]||={};target[parts.at(-1)]=v?.__increment!==undefined?(Number(target[parts.at(-1)])||0)+v.__increment:structuredClone(v);}return out;};
 function collection(name,filters=[]) {return {name,filters,doc:id=>({key:name+'/'+id}),where:(key,op,value)=>collection(name,[...filters,[key,value]])};}
 return {docs,collection,runTransaction(worker){const result=queue.then(async()=>{const staged=new Map();let writing=false;
  const tx={get:async ref=>{assert.equal(writing,false,'all reads precede writes');if(ref.filters)return {docs:[...docs].filter(([k,v])=>k.startsWith(ref.name+'/')&&ref.filters.every(([key,value])=>v[key]===value)).map(([k])=>snap(k))};return snap(ref.key);},
   create(ref,v){writing=true;assert.ok(!docs.has(ref.key));staged.set(ref.key,structuredClone(v));},
   set(ref,v,opts){writing=true;staged.set(ref.key,opts?.merge?merge(docs.get(ref.key),v):structuredClone(v));},
   update(ref,v){writing=true;assert.ok(docs.has(ref.key));staged.set(ref.key,merge(docs.get(ref.key),v));}};
  const output=await worker(tx);for(const[k,v]of staged)docs.set(k,v);return output;});queue=result.catch(()=>{});return result;}};
}
const player=()=>({uid:'u',stats:{gold:0,totalScore:28}});
const pack=()=>({status:'active',ownerUid:'owner',questions:Array.from({length:4},(_,i)=>({id:'Q'+i,q:'Question '+i,correct:'A',wrong:['B','C','D'],exp:'清楚說明原題考查的概念以及各個選項的理由。'.repeat(8)}))});
const entry=(run,correctIndices,owner='owner')=>({id:run,uid:'u',dongtianId:'c',runId:run,ownerUid:owner,...api.verifyAnswers(pack(),pack().questions.map((q,i)=>({id:q.id,selected:correctIndices.includes(i)?'A':'B'})))});
const db=()=>fakeDb({'users/u':player(),'users/owner':{stats:{gold:0,totalScore:0}}});
test('all-wrong first completion gives only 30 stones, then correction pays newly mastered questions',async()=>{
 const d=db();let r=await api.awardProgress(d,'u',entry('r1',[]));assert.equal(r.goldAdded,30);assert.equal(r.cultivationAdded,0);assert.equal(r.ownerRewarded,false);
 r=await api.awardProgress(d,'u',entry('r2',[0,1]));assert.equal(r.goldAdded,80);assert.equal(r.cultivationAdded,2);assert.equal(r.newCorrect,2);
 r=await api.awardProgress(d,'u',entry('r3',[1,2]));assert.equal(r.goldAdded,40);assert.equal(r.newCorrect,1);
 r=await api.awardProgress(d,'u',entry('r4',[0,1,2,3]));assert.equal(r.goldAdded,40);assert.equal(r.newCorrect,1);assert.equal(r.ownerRewarded,true);
 r=await api.awardProgress(d,'u',entry('r5',[0,1,2,3]));assert.equal(r.goldAdded,0);assert.equal(r.cultivationAdded,0);assert.equal(r.ownerRewarded,false);
 assert.equal(d.docs.get('users/u').stats.gold,190);assert.equal(d.docs.get('users/u').stats.totalScore,32);
 assert.equal(d.docs.get('users/owner').stats.gold,5);
});
test('concurrent replays and duplicate receipts cannot award an overlapping question twice',async()=>{
 const d=db();const results=await Promise.all([api.awardProgress(d,'u',entry('a',[0,1,2])),api.awardProgress(d,'u',entry('b',[1,2,3]))]);
 assert.equal(results.reduce((s,r)=>s+r.cultivationAdded,0),4);assert.equal(d.docs.get('users/u').stats.gold,190);
 const repeat=await api.awardProgress(d,'u',entry('a',[0,1,2]));assert.equal(repeat.applied,false);assert.equal(d.docs.get('users/u').stats.gold,190);
});
test('promotion increases gold for newly mastered questions without repricing previously paid mastery',async()=>{
 const d=db(),p=d.docs.get('users/u');p.stats.totalScore=67;
 const first=await api.awardProgress(d,'u',entry('realm-first',[0]));
 assert.equal(first.goldAdded,70);assert.equal(first.realmGoldAdded,10);
 assert.equal(d.docs.get('users/u').stats.totalScore,68);
 assert.equal((await api.awardProgress(d,'u',entry('same-after-promotion',[0]))).goldAdded,0);
 const second=await api.awardProgress(d,'u',entry('realm-second',[0,1]));
 assert.equal(second.goldAdded,50);assert.equal(second.realmGoldAdded,20);
 d.docs.get('users/u').stats.totalScore=188;
 const third=await api.awardProgress(d,'u',entry('realm-third',[0,1,2]));
 assert.equal(third.goldAdded,60);assert.equal(third.realmGoldAdded,30);
 const paid=d.docs.get('users/u').stats.gold;
 assert.equal(paid,180);
 const repeat=await api.awardProgress(d,'u',entry('realm-first',[0]));
 assert.equal(repeat.applied,false);assert.equal(repeat.goldAdded,70);
 assert.equal(d.docs.get('users/u').stats.gold,paid);
 const ledger=d.docs.get('dongtianPlays/u__c').learningRewardV2;
 assert.equal(ledger.goldPaid,120);assert.equal(ledger.realmGoldPaid,60);
});
test('old mastery ledgers do not grant retroactive realm bonuses or repeat them after promotion',async()=>{
 const d=db();d.docs.get('users/u').stats.totalScore=188;
 d.docs.set('dongtianPlays/u__c',{completed:true,learningRewardV2:{version:2,
  masteredKeys:entry('old',[0,1]).masteredKeys,creditedCorrect:2,goldPaid:90,soulClaimed:true,ownerRewardClaimed:true}});
 assert.equal((await api.awardProgress(d,'u',entry('repeat-old',[0,1]))).goldAdded,0);
 const newer=await api.awardProgress(d,'u',entry('learn-new',[0,1,2]));
 assert.equal(newer.goldAdded,60);assert.equal(newer.realmGoldAdded,30);
 assert.equal((await api.awardProgress(d,'u',entry('repeat-new',[0,1,2]))).goldAdded,0);
});
test('legacy first receipt protects paid stones and derives correction baseline even after a worse replay',async()=>{
 const d=db();d.docs.set('dongtianPlays/u__c',{completed:true,correct:0,total:4});
 d.docs.set('dongtianRewardClaims/old',{uid:'u',dongtianId:'c',firstCompletion:true,correct:2,goldAdded:270,cultivationAdded:2});
 const r=await api.awardProgress(d,'u',entry('new',[0,1,2]));assert.equal(r.goldAdded,10);assert.equal(r.newCorrect,1);assert.equal(r.cultivationAdded,1);assert.equal(r.ownerRewarded,false);
 const again=await api.awardProgress(d,'u',entry('next',[0,1,2,3]));assert.equal(again.goldAdded,10);assert.equal(again.cultivationAdded,1);
});
test('owner reward requires quality and meaningful accuracy, excludes self-play, and can be earned on correction',async()=>{
 const d=db();const bad=entry('bad',[0,1,2,3]);bad.qualityEligible=false;
 assert.equal((await api.awardProgress(d,'u',bad)).ownerRewarded,false);
 assert.equal((await api.awardProgress(d,'u',entry('good',[0,1,2]))).ownerRewarded,true);
 assert.equal((await api.awardProgress(d,'u',entry('self',[0,1,2,3],'u'))).ownerRewarded,false);
 const q=pack();q.questions[0].exp='short';assert.equal(api.verifyAnswers(q,q.questions.map(q=>({id:q.id,selected:'A'}))).qualityEligible,false);
});
test('nascent bonus is paid once, and reordering choices cannot recreate mastery',async()=>{
 const d=db(),p=d.docs.get('users/u');p.stats.totalScore=68;p.cultivationTraining={equippedCore:{type:'sword'}};p.nascentSoulGrowth={version:1,branches:{cultivation:4}};
 const first=await api.awardProgress(d,'u',entry('first',[0]));assert.equal(first.cultivationAdded,3);
 const next=await api.awardProgress(d,'u',entry('next',[0,1]));assert.equal(next.cultivationAdded,1);assert.equal(next.soulCultivationAdded,0);
 const q=pack().questions[0];assert.equal(api.questionKey(q),api.questionKey({...q,wrong:q.wrong.slice().reverse()}));
});
test('server eligibility rejects suspended content and pins verified answers across retries',async()=>{
 const cave=pack(),bd=fakeDb({'dongtianIndex/c':{status:'active',ownerUid:'owner'},'dongtians/c':cave});
 const answers=cave.questions.map(q=>({id:q.id,selected:'A'}));
 const e=await api.claimEligibility(bd,'u','c','run',answers);assert.equal(e.correct,4);
 const retry=await api.claimEligibility(bd,'u','c','run',answers.map(q=>({...q,selected:'B'})));assert.equal(retry.correct,4);
 bd.docs.get('dongtians/c').status='suspended';await assert.rejects(api.claimEligibility(bd,'u','c','other',answers),/封印/);
});
