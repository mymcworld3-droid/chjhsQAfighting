'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rewards=require('../public/cultivation/trial-tower-rewards.js');
test('each floor pays a bounded first-clear reward with specified milestone extras',()=>{
 for(const [floor,gold,forgeFragments,drawTickets,materials]of [
  [1,20,2,1,{}],[5,20,2,1,{'nascent-soul-essence':1}],
  [10,20,2,1,{'nascent-soul-essence':1}],
  [20,30,2,1,{'nascent-soul-essence':1,'raid-refine-key-ii':1}],
  [25,40,3,1,{'nascent-soul-essence':2}],
  [50,310,4,2,{'nascent-soul-essence':3,'raid-refine-key-iii':1}],
  [75,90,5,1,{'nascent-soul-essence':4}],
  [100,610,6,4,{'nascent-soul-essence':5,'raid-refine-key-ii':1,'raid-refine-key-iii':1}]]){
  assert.deepEqual(Rewards.forFloor(floor),{floor,gold,forgeFragments,drawTickets,materials});
 }
});
test('the hundred-floor budget is finite and duplicate or invalid requested floors cannot multiply it',()=>{
 const floors=Array.from({length:100},(_,i)=>i+1),total=Rewards.total(floors);
 assert.deepEqual(total,{gold:7250,forgeFragments:400,drawTickets:104,materials:{'nascent-soul-essence':54,'raid-refine-key-ii':5,'raid-refine-key-iii':2}});
 assert.deepEqual(Rewards.total([...floors,...floors,-1,101,Infinity,1.5,'1']),total);
 for(const floor of [0,-1,101,NaN,Infinity,1.5,'1',null])assert.equal(Rewards.forFloor(floor),null);
});
test('legacy ticket supplements exclude milestone tickets, uncleared floors, duplicate claims and already issued supplements',()=>{
 const old={bestFloor:20,rewardVersion:1,rewardClaims:[1,2,2,5,10,20,0,101,'3']};
 assert.deepEqual(Rewards.ticketBackfill(old),[1,2,5]);
 assert.deepEqual(Rewards.ticketBackfill({...old,rewardVersion:2,floorTicketClaims:[1,5]}),[2]);
 assert.deepEqual(Rewards.ticketBackfill({bestFloor:100}),[]);
 const floors=Array.from({length:100},(_,i)=>i+1);
 const supplements=Rewards.ticketBackfill({bestFloor:100,rewardClaims:floors});
 assert.equal(supplements.length,90);assert.ok(supplements.every(f=>f%10!==0));
 assert.deepEqual(Rewards.ticketBackfill({bestFloor:100,rewardClaims:floors,floorTicketClaims:floors}),[]);
});
test('legacy progress may backfill cleared floors and reward version updates cannot reset claim receipts',()=>{
 const legacy={bestFloor:12};assert.deepEqual(Rewards.pending(legacy),Array.from({length:12},(_,i)=>i+1));
 const record={bestFloor:5,rewardVersion:99,rewardClaims:[1,1,3,0,101,'2']};
 assert.deepEqual(Rewards.claimed(record),[1,3]);assert.deepEqual(Rewards.pending(record),[2,4,5]);
 assert.deepEqual(Rewards.rows(Rewards.forFloor(100)).map(r=>r.name),['靈石','煉器碎片','本命法器抽獎券','元嬰碎精','二階升級石','三階升級石']);
});
