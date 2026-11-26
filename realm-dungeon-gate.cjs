'use strict';
// Server-owned realm gate. Never trust a player-supplied dungeon count.
// Existing attained realms are grandfathered; surplus cultivation stays banked.
const {DUNGEON_GATES,dungeonClearCount}=require('./public/cultivation/quest-rules.js');
const n=v=>Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):0;
const attained=score=>DUNGEON_GATES.reduce((highest,g)=>n(score)>=g.score?g.score:highest,0);
function highest(stats){return Math.max(attained(stats?.totalScore),attained(stats?.realmDungeonGateV1?.highestScore));}
function nextGate(stats,pointer){
 const cleared=dungeonClearCount(pointer),passed=highest(stats);
 return DUNGEON_GATES.find(g=>g.score>passed&&cleared<g.clears)||null;
}
function needsRead(stats,desired){
 return n(stats?.realmDungeonGateV1?.reserve)>0||
  DUNGEON_GATES.some(g=>g.score>highest(stats)&&n(desired)>=g.score);
}
function apply(stats={},desired=stats.totalScore,pointer={}){
 const previous=n(stats.totalScore),old=stats.realmDungeonGateV1;
 const total=n(desired)+n(old?.reserve),gate=nextGate(stats,pointer);
 const score=gate?Math.min(total,gate.score-1):total;
 const reserve=total-score,highestScore=Math.max(highest(stats),attained(score));
 const state=old||reserve>0||attained(previous)!==attained(score)?{version:1,highestScore,reserve}:null;
 return {score,state};
}
function patch(stats,desired,pointer){
 const {score,state}=apply(stats,desired,pointer);
 return {'stats.totalScore':score,...(state?{'stats.realmDungeonGateV1':state}:{})};
}
function status(stats={},pointer={}){
 const gate=nextGate(stats,pointer),cleared=dungeonClearCount(pointer);
 return {cleared,reserve:n(stats.realmDungeonGateV1?.reserve),next:gate?{realm:gate.realm,score:gate.score,required:gate.clears,remaining:Math.max(0,gate.clears-cleared),locked:n(stats.totalScore)>=gate.score-1}:null};
}
module.exports={apply,patch,status,needsRead};
