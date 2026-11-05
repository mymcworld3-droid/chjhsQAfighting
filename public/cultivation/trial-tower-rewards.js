// One-time floor rewards, shared by the tower preview and authoritative settlement.
(function(root){
 'use strict';
 const VERSION=3,MAX_FLOOR=100;
 const ITEMS=Object.freeze({
  'nascent-soul-essence':Object.freeze({name:'元嬰碎精',icon:'nascent-soul-essence'}),
  'raid-refine-key-ii':Object.freeze({name:'二階升級石',icon:'raid-refine-key-ii'}),
  'raid-refine-key-iii':Object.freeze({name:'三階升級石',icon:'raid-refine-key-iii'})
 });
 function previousForFloor(floor){
  if(!Number.isInteger(floor)||floor<1||floor>MAX_FLOOR)return null;
  const materials={};
  if(floor%5===0)materials['nascent-soul-essence']=1+Math.floor(floor/25);
  if(floor%20===0)materials['raid-refine-key-ii']=1;
  if(floor%50===0)materials['raid-refine-key-iii']=1;
  return {floor,gold:20+10*Math.floor((floor-1)/10)+(floor===50?250:floor===100?500:0),
   forgeFragments:2+Math.floor((floor-1)/20),
   drawTickets:1+(floor===50?1:floor===100?3:0),materials};
 }
 function forFloor(floor){
  const previous=previousForFloor(floor);if(!previous)return null;
  return {floor,gold:50+20*Math.floor((floor-1)/10)+(floor===50?750:floor===100?1500:0),
   forgeFragments:5+2*Math.floor((floor-1)/20),
   drawTickets:1+(floor%10===0?1:0)+(floor===50?5:floor===100?10:0),
   materials:Object.fromEntries(Object.entries(previous.materials).map(([id,quantity])=>[id,quantity*2]))};
 }
 function bonusForFloor(floor){
  const before=previousForFloor(floor),after=forFloor(floor);if(!after)return null;
  return {floor,gold:after.gold-before.gold,forgeFragments:after.forgeFragments-before.forgeFragments,
   drawTickets:after.drawTickets-before.drawTickets,
   materials:Object.fromEntries(Object.entries(after.materials).map(([id,quantity])=>[id,quantity-(before.materials[id]||0)]))};
 }
 function sum(floors,rewardFor){
  const sum={gold:0,forgeFragments:0,drawTickets:0,materials:{}};
  for(const floor of new Set(floors)){
   const reward=rewardFor(floor);if(!reward)continue;
   for(const key of ['gold','forgeFragments','drawTickets'])sum[key]+=reward[key];
   for(const [id,quantity]of Object.entries(reward.materials))sum.materials[id]=(sum.materials[id]||0)+quantity;
  }
  return sum;
 }
 function total(floors=[]){return sum(floors,forFloor);}
 function bonusTotal(floors=[]){return sum(floors,bonusForFloor);}
 function payout(floors=[],ticketFloors=[],bonusFloors=[]){
  const reward=total(floors),full=new Set(floors),bonus=bonusTotal(bonusFloors.filter(f=>!full.has(f)));
  for(const key of ['gold','forgeFragments','drawTickets'])reward[key]+=bonus[key];
  reward.drawTickets+=[...new Set(ticketFloors)].filter(f=>Number.isInteger(f)&&f>=1&&f<=MAX_FLOOR&&f%10!==0&&!full.has(f)).length;
  for(const [id,quantity]of Object.entries(bonus.materials))reward.materials[id]=(reward.materials[id]||0)+quantity;
  return reward;
 }
 function claimed(record={}){return [...new Set((Array.isArray(record.rewardClaims)?record.rewardClaims:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=MAX_FLOOR))].sort((a,b)=>a-b);}
 function pending(record={}){const done=new Set(claimed(record)),best=Math.min(MAX_FLOOR,Math.max(0,Math.floor(Number(record.bestFloor)||0)));return Array.from({length:best},(_,i)=>i+1).filter(f=>!done.has(f));}
 // Version 1 already paid tickets on multiples of ten. Only supplement the
 // previously claimed ordinary floors, without paying their other rewards again.
 function ticketBackfill(record={}){const done=new Set(Array.isArray(record.floorTicketClaims)?record.floorTicketClaims:[]);return claimed(record).filter(f=>f%10!==0&&!done.has(f));}
 // Track each floor separately: earning a new floor must not consume older
 // rewards' upgrade differences merely by updating the record-wide version.
 function bonusPending(record={}){return claimed(record).filter(f=>!(Number(record.floorRewardVersions?.[f])>=VERSION));}
 function rows(reward){
  if(!reward)return [];
  const result=[];
  if(reward.gold)result.push({name:'靈石',icon:'gold',quantity:reward.gold});
  if(reward.forgeFragments)result.push({name:'煉器碎片',icon:'forge-fragment',quantity:reward.forgeFragments});
  if(reward.drawTickets)result.push({name:'本命法器抽獎券',icon:'draw-ticket',quantity:reward.drawTickets});
  for(const [id,quantity]of Object.entries(reward.materials||{}))if(ITEMS[id]&&quantity)result.push({...ITEMS[id],quantity});
  return result;
 }
 const api=Object.freeze({VERSION,MAX_FLOOR,ITEMS,forFloor,total,bonusTotal,payout,claimed,pending,ticketBackfill,bonusPending,rows});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.QATrialTowerRewards=api;
})(globalThis);
