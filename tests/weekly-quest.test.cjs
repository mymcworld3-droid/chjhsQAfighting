'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const rules=require('../public/cultivation/quest-rules.js');
const {questTransaction}=require('../quest-api.cjs').__test;
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const date=new Date('2026-10-16T05:00:00Z'),day=rules.dateKey(date),week=rules.weekKey(day);
function dbFor(user) {
 const docs=new Map([['users/u1',structuredClone(user)]]);
 const snapshot=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 let queue=Promise.resolve();
 return {docs,collection(name){return {doc(id){return {key:name+'/'+id}}};},
 runTransaction(callback) {
   const work=queue.then(async()=>{
     let written=false;const pending=new Map();
     const tx={get:async ref=>{assert.equal(written,false,'transaction reads before writes');return snapshot(ref.key);},
       set(ref,value){written=true;pending.set(ref.key,structuredClone(value));},
       update(ref,patch){written=true;const copy=structuredClone(pending.get(ref.key)||docs.get(ref.key));
         for(const [key,value] of Object.entries(patch)){
           const keys=key.split('.'),leaf=keys.pop();let item=copy;
           for(const part of keys)item=item[part]??={};item[leaf]=structuredClone(value);
         }
         pending.set(ref.key,copy);
       }};
     const result=await callback(tx);
     for(const [key,value] of pending)docs.set(key,value);
     return result;
   });
   queue=work.catch(()=>{});return work;
 }};
}
const user=()=>({uid:'u1',stats:{gold:7,totalScore:28,totalCorrect:12}});
test('Taipei weeks begin Monday, cross year boundary and never reset at Sunday local midnight',()=>{
 assert.equal(rules.weekKey('2026-10-12'),'2026-10-12');
 assert.equal(rules.weekKey('2026-10-18'),'2026-10-12');
 assert.equal(rules.weekKey('2026-10-19'),'2026-10-19');
 assert.equal(rules.weekKey(new Date('2026-10-18T15:59:59Z')),'2026-10-12');
 assert.equal(rules.weekKey(new Date('2026-10-18T16:00:00Z')),'2026-10-19');
 assert.equal(rules.weekKey('2027-01-01'),'2026-12-28');
});
test('weekly counters accumulate through daily resets and keep corrections separate',()=>{
 let p=rules.recordEvent({},'solo','2026-10-12');
 p=rules.recordEvent(p,'solo','2026-10-16');
 p=rules.recordEvent(p,'correction','2026-10-16');
 p=rules.recordEvent(p,'meditation','2026-10-18');
 p=rules.recordEvent(p,'dongtian','2026-10-18');
 assert.equal(p.weekly.key,'2026-10-12');
 assert.equal(p.weekly.counts.solo,2);assert.equal(p.weekly.counts.correction,1);
 assert.equal(p.weekly.counts.meditation+p.weekly.counts.dongtian,2);
 assert.equal(p.daily.counts.solo,0);
 assert.equal(rules.normalizeProgress(p,'2026-10-19').weekly.counts.solo,0);
 assert.equal(rules.normalizeProgress(p,'2026-10-19').totals.solo,2);
});
test('week starts with no retroactive credit from old lifetime statistics',()=>{
 const u=user();u.stats.totalCorrect=500;
 const view=rules.view(u,{},day);
 assert.equal(view.weekly.length,5);
 assert.ok(view.weekly.every(q=>q.current===0&&q.claimable===false));
 assert.equal(view.daily.length,6);
 assert.equal(view.commissions.length,0);
});
test('seven-day progress enables low-pressure 20 questions, corrections and cross-mode activity',()=>{
 const u=user();
 let p;
 for(let i=0;i<20;i++)p=rules.recordEvent(p,'solo','2026-10-12');
 for(let i=0;i<2;i++)p=rules.recordEvent(p,'correction','2026-10-14');
 p=rules.recordEvent(p,'meditation','2026-10-15');
 p=rules.recordEvent(p,'dongtian','2026-10-16');
 u.questProgress=p;
 const v=rules.view(u,{},day);
 for(const id of ['week-solo-20','week-correction-2','week-activity-2'])
   assert.equal(v.weekly.find(q=>q.id===id).claimable,true,id);
 assert.equal(v.weekly.find(q=>q.id==='week-solo-50').claimable,false);
});
test('server prevents replay, forged completion, stale week keys and duplicate concurrent reward',async()=>{
 const u=user();let p;
 for(let i=0;i<20;i++)p=rules.recordEvent(p,'solo','2026-10-16');
 u.questProgress=p;
 const db=dbFor(u),id='week-solo-20';
 await assert.rejects(questTransaction(db,'u1',{kind:'weekly',id,weeklyKey:'2025-02-03'},date),/跨週/);
 await assert.rejects(questTransaction(db,'u1',{kind:'weekly',id:'week-solo-50',weeklyKey:week},date),/尚未完成/);
 const attempts=await Promise.all(Array.from({length:6},()=>questTransaction(db,'u1',{kind:'weekly',id,weeklyKey:week,gold:9999},date)));
 assert.equal(attempts.filter(x=>x.awarded).length,1);
 assert.equal(db.docs.get('users/u1').stats.gold,147);
 assert.equal(db.docs.get('questStates/u1').weeklyKey,week);
 assert.deepEqual(db.docs.get('questStates/u1').weeklyClaimed,[id]);
 const nextMonday=new Date('2026-10-18T16:00:01Z'),v=await questTransaction(db,'u1',null,nextMonday);
 assert.equal(v.quests.weekly[0].claimed,false);
 assert.equal(v.quests.weekly[0].current,0);
 await assert.rejects(questTransaction(db,'u1',{kind:'weekly',id,weeklyKey:week},nextMonday),/跨週/);
});
test('weekly task display uses same claim pathway, keyboard tab and independent red-dot',()=>{
 const ui=read('public/cultivation/quest-system.js');
 const backend=read('quest-api.cjs');
 const training=read('public/main-legacy.js');
 assert.match(ui,/quest-tab-weekly/);
 assert.match(ui,/quest-weekly-dot/);
 assert.match(ui,/kind === 'weekly'/);
 assert.match(ui,/weeklyKey:snapshot.weeklyKey/);
 assert.match(ui,/週一 00:00/);
 assert.match(backend,/request.kind === 'weekly'/);
 assert.match(training,/recordEvent\(patch.questProgress, 'correction'\)/);
});
