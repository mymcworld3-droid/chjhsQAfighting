'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rewards=require('../public/cultivation/trial-tower-rewards.js');
test('each floor pays a bounded first-clear reward with specified milestone extras',()=>{
 for(const [floor,gold,forgeFragments,drawTickets,materials]of [
  [1,50,5,1,{}],[5,50,5,1,{'nascent-soul-essence':2}],
  [10,50,5,2,{'nascent-soul-essence':2}],
  [20,70,5,2,{'nascent-soul-essence':2,'raid-refine-key-ii':2}],
  [25,90,7,1,{'nascent-soul-essence':4}],
  [50,880,9,7,{'nascent-soul-essence':6,'raid-refine-key-iii':2}],
  [75,190,11,1,{'nascent-soul-essence':8}],
  [100,1730,13,12,{'nascent-soul-essence':10,'raid-refine-key-ii':2,'raid-refine-key-iii':2}]]){
  assert.deepEqual(Rewards.forFloor(floor),{floor,gold,forgeFragments,drawTickets,materials});
 }
});
test('the hundred-floor budget is finite and duplicate or invalid requested floors cannot multiply it',()=>{
 const floors=Array.from({length:100},(_,i)=>i+1),total=Rewards.total(floors);
 assert.deepEqual(total,{gold:16250,forgeFragments:900,drawTickets:125,materials:{'nascent-soul-essence':108,'raid-refine-key-ii':10,'raid-refine-key-iii':4}});
 assert.deepEqual(Rewards.total([...floors,...floors,-1,101,Infinity,1.5,'1']),total);
 for(const floor of [0,-1,101,NaN,Infinity,1.5,'1',null])assert.equal(Rewards.forFloor(floor),null);
});
test('version 1 and version 2 upgrades pay only their exact missing amounts, with no duplicate full-floor or bonus payment',()=>{
 const floors=Array.from({length:100},(_,i)=>i+1),bonus=Rewards.bonusTotal(floors);
 assert.deepEqual(bonus,{gold:9000,forgeFragments:500,drawTickets:21,materials:{'nascent-soul-essence':54,'raid-refine-key-ii':5,'raid-refine-key-iii':2}});
 assert.deepEqual(Rewards.bonusTotal([...floors,...floors,0,101,'1']),bonus);
 assert.equal(Rewards.payout([],Rewards.ticketBackfill({rewardClaims:floors}),floors).drawTickets,111);
 assert.equal(Rewards.payout([],[],floors).drawTickets+104,125);
 assert.deepEqual(Rewards.payout([1,10],[1,2,2],[1,5,5,10]),{gold:130,forgeFragments:13,drawTickets:4,materials:{'nascent-soul-essence':3}});
 const record={bestFloor:3,rewardVersion:999,rewardClaims:[1,2,3],floorRewardVersions:{1:3,3:4}};
 assert.deepEqual(Rewards.bonusPending(record),[2]);assert.deepEqual(Rewards.bonusPending({bestFloor:100}),[]);
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
