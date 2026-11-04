// One-time floor rewards, shared by the tower preview and authoritative settlement.
(function(root){
 'use strict';
 const VERSION=1,MAX_FLOOR=100;
 const ITEMS=Object.freeze({
  'nascent-soul-essence':Object.freeze({name:'元嬰碎精',icon:'nascent-soul-essence'}),
  'raid-refine-key-ii':Object.freeze({name:'二階升級石',icon:'raid-refine-key-ii'}),
  'raid-refine-key-iii':Object.freeze({name:'三階升級石',icon:'raid-refine-key-iii'})
 });
 function forFloor(floor){
  if(!Number.isInteger(floor)||floor<1||floor>MAX_FLOOR)return null;
  const materials={};
  if(floor%5===0)materials['nascent-soul-essence']=1+Math.floor(floor/25);
  if(floor%20===0)materials['raid-refine-key-ii']=1;
  if(floor%50===0)materials['raid-refine-key-iii']=1;
  return {floor,gold:20+10*Math.floor((floor-1)/10)+(floor===50?250:floor===100?500:0),
   forgeFragments:2+Math.floor((floor-1)/20),
   drawTickets:(floor%10===0?1:0)+(floor===50?1:floor===100?3:0),materials};
 }
 function total(floors=[]){
  const sum={gold:0,forgeFragments:0,drawTickets:0,materials:{}};
  for(const floor of new Set(floors)){
   const reward=forFloor(floor);if(!reward)continue;
   for(const key of ['gold','forgeFragments','drawTickets'])sum[key]+=reward[key];
   for(const [id,quantity]of Object.entries(reward.materials))sum.materials[id]=(sum.materials[id]||0)+quantity;
  }
  return sum;
 }
 function claimed(record={}){return [...new Set((Array.isArray(record.rewardClaims)?record.rewardClaims:[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=MAX_FLOOR))].sort((a,b)=>a-b);}
 function pending(record={}){const done=new Set(claimed(record)),best=Math.min(MAX_FLOOR,Math.max(0,Math.floor(Number(record.bestFloor)||0)));return Array.from({length:best},(_,i)=>i+1).filter(f=>!done.has(f));}
 function rows(reward){
  if(!reward)return [];
  const result=[];
  if(reward.gold)result.push({name:'靈石',icon:'gold',quantity:reward.gold});
  if(reward.forgeFragments)result.push({name:'煉器碎片',icon:'forge-fragment',quantity:reward.forgeFragments});
  if(reward.drawTickets)result.push({name:'本命法器抽獎券',icon:'draw-ticket',quantity:reward.drawTickets});
  for(const [id,quantity]of Object.entries(reward.materials||{}))if(ITEMS[id]&&quantity)result.push({...ITEMS[id],quantity});
  return result;
 }
 const api=Object.freeze({VERSION,MAX_FLOOR,ITEMS,forFloor,total,claimed,pending,rows});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.QATrialTowerRewards=api;
})(globalThis);
