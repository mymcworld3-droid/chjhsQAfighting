'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../public/cultivation/quest-rules.js');
const {questTransaction}=require('../quest-api.cjs').__test;
const today=new Date('2026-10-16T05:00:00Z'),date=rules.dateKey(today);
function fake(user,state={},trial=null){
 const docs=new Map([['users/u1',structuredClone(user)],['questStates/u1',structuredClone(state)]]);
 if(trial)docs.set('enlightenmentTrialStates/u1',structuredClone(trial));
 const snap=key=>({exists:docs.has(key),data:()=>structuredClone(docs.get(key))});
 const update=(row,patch)=>{const copy=structuredClone(row);for(const [key,val] of Object.entries(patch)){
   const keys=key.split('.'),last=keys.pop();let curr=copy;for(const part of keys)curr=curr[part]??={};curr[last]=structuredClone(val);
 }return copy;};
 let queue=Promise.resolve();
 return {docs,collection(collection){return {doc(id){return {key:collection+'/'+id}}};},
   runTransaction(work){
     const p=queue.then(async()=>{
       let writing=false;const changed=new Map();
       const tx={get:async ref=>{assert.equal(writing,false);return snap(ref.key);},
         update:(ref,patch)=>{writing=true;changed.set(ref.key,update(changed.get(ref.key)||docs.get(ref.key),patch));},
         set:(ref,value)=>{writing=true;changed.set(ref.key,structuredClone(value));}};
       const outcome=await work(tx);for(const [key,value] of changed)docs.set(key,value);return outcome;
     });queue=p.catch(()=>{});return p;
   }
 };
}
const user=()=>({uid:'u1',stats:{gold:100,totalScore:28,totalCorrect:20,
  knowledgeMap:{數學:{二次函數:{total:8,correct:2}}}},
  questProgress:{totals:{solo:20},daily:{date,counts:{solo:6}}}});
test('same day and uid generate identical two commissions without locking beginners into high-realm content',()=>{
 let x=rules.dailyCommissions(user(),'u1',date),y=rules.dailyCommissions(user(),'u1',date);
 assert.deepEqual(x,y);assert.equal(x.length,2);assert.equal(x[0].metric,'solo');
 assert.ok(x.every(q=>user().stats.totalScore>=q.minScore));
 const beginner=user();beginner.stats.totalScore=0;beginner.stats.knowledgeMap={};
 const tasks=rules.dailyCommissions(beginner,'u1',date);
 assert.ok(tasks.every(q=>['solo','meditation','dongtian'].includes(q.metric)));
 assert.ok(tasks.every(q=>q.reward.drawTickets==null));
});
test('assignment is stored once, cannot claim unassigned mission or claim assigned mission twice',async()=>{
 const db=fake(user());
 const opening=await questTransaction(db,'u1',null,today),assigned=opening.quests.commissions;
 assert.equal(assigned.length,2);
 const initial=structuredClone(db.docs.get('questStates/u1'));
 assert.equal(initial.commissionDate,date);
 assert.deepEqual(initial.commissionIds,assigned.map(q=>q.id));
 const again=await questTransaction(db,'u1',null,today);
 assert.deepEqual(again.quests.commissions.map(q=>q.id),assigned.map(q=>q.id));
 assert.deepEqual(db.docs.get('questStates/u1'),initial);
 const unassigned=rules.COMMISSION_POOL.find(q=>!initial.commissionIds.includes(q.id));
 await assert.rejects(questTransaction(db,'u1',{kind:'commission',id:unassigned.id,date},today),
   /找不到今日指定的委託/);
 const solo=assigned.find(q=>q.metric==='solo');
 assert.ok(solo);
 const qProgress=db.docs.get('users/u1');qProgress.questProgress.daily.counts.solo=8;
 const attempts=await Promise.all(Array.from({length:4},()=>questTransaction(db,'u1',{kind:'commission',id:solo.id,date,gold:999999},today)));
 assert.equal(attempts.filter(x=>x.awarded).length,1);
 assert.equal(db.docs.get('users/u1').stats.gold,100+solo.reward.gold);
 assert.ok(db.docs.get('questStates/u1').commissionClaimed.includes(solo.id));
 const tomorrow=new Date('2026-10-16T16:00:01Z');
 const next=await questTransaction(db,'u1',null,tomorrow);
 assert.equal(next.quests.commissions.length,2);
 assert.equal(next.quests.commissions[0].claimed,false);
 assert.equal(next.quests.date,'2026-10-17');
 await assert.rejects(questTransaction(db,'u1',{kind:'commission',id:solo.id,date},tomorrow),/跨日/);
});
test('specialist commission credits server-authenticated enlightenment completion only',async()=>{
 const snapshot={commissionDate:date,commissionIds:['commission-solo-four','commission-enlightenment'],commissionClaimed:[],dailyDate:date};
 const db=fake(user(),snapshot);
 await assert.rejects(questTransaction(db,'u1',{kind:'commission',id:'commission-enlightenment',date},today),/尚未完成/);
 db.docs.set('enlightenmentTrialStates/u1',{day:date,status:'active',correct:4});
 await assert.rejects(questTransaction(db,'u1',{kind:'commission',id:'commission-enlightenment',date},today),/尚未完成/);
 db.docs.set('enlightenmentTrialStates/u1',{day:date,status:'completed',correct:3,success:false});
 const success=await questTransaction(db,'u1',{kind:'commission',id:'commission-enlightenment',date},today);
 assert.equal(success.awarded,true,'completion itself counts regardless of win');
 assert.equal(success.reward.gold,90);
 const replay=await questTransaction(db,'u1',{kind:'commission',id:'commission-enlightenment',date},today);
 assert.equal(replay.awarded,false);
});
test('zero-knowledge map never generates specialist task and legacy six dailies remain untouched',()=>{
 const u=user();u.stats.knowledgeMap={};
 const pool=rules.dailyCommissions(u,'u1',date);
 assert.ok(pool.every(q=>q.metric!=='enlightenment'));
 assert.equal(rules.DAILY.length,6);
 assert.equal(rules.PATH.length,37);
});
