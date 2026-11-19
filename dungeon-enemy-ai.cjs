'use strict';

// Stage 9: deterministic co-op NPC movement, committed with the battle tick.
// No damage, aggro attacks, drops, player state changes or rewards yet.
const {walkable}=require('./dungeon-map-generator.cjs');
const {dueTick,advanceClock,isRunning}=require('./dungeon-battle-clock.cjs');
const ENEMY_AI_VERSION=1;
const MAX_CATCHUP_TICKS=24;
const DIRECTIONS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
const KINDS=Object.freeze([
  {kind:'wolf',name:'巡山妖狼',cadence:2,aggroRange:8,color:'#e5b37b'},
  {kind:'wisp',name:'迷霧靈狐',cadence:3,aggroRange:10,color:'#8ddcc7'},
  {kind:'golem',name:'岩甲巨蜥',cadence:3,aggroRange:6,color:'#cead8a'}
]);
const key=p=>p.x+','+p.y;
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function routeFor(map,zone){
  if(zone.startsWith('branch-')){
    const branch=map.branches.find(b=>b.id===zone);
    return branch?.route?.slice(-17)||[];
  }
  const index=zone==='main-east'?Math.floor(map.mainRoute.length*.32):
    Math.floor(map.mainRoute.length*.68);
  return map.mainRoute.slice(Math.max(0,index-7),
    Math.min(map.mainRoute.length,index+8));
}
function enemyDefinitions(map){
  const specs=map.branches.map((branch,index)=>({
    zone:branch.id,definition:KINDS[index%KINDS.length],position:branch.end
  }));
  for(const [i,zone]of ['main-east','main-west'].entries()){
    const path=routeFor(map,zone);
    specs.push({zone,definition:KINDS[(i+1)%KINDS.length],
      position:path[Math.floor(path.length/2)]});
  }
  return specs;
}
function initialEnemies(map){
  const occupied=new Set(),out=[];
  for(const [index,spec]of enemyDefinitions(map).entries()){
    const path=routeFor(map,spec.zone);
    const preferred=path.findIndex(p=>same(p,spec.position));
    let pathIndex=preferred<0?path.length-1:preferred;
    // Avoid same-cell NPC spawns. Never choose player pads.
    while(pathIndex>=0&&(occupied.has(key(path[pathIndex]))||
      map.spawnPads.some(p=>same(p,path[pathIndex]))))pathIndex--;
    if(pathIndex<0)continue;
    const position={...path[pathIndex]};
    if(!walkable(map,position))throw new Error('靈獸初始位置不能通行');
    occupied.add(key(position));
    const type=spec.definition;
    out.push({id:'beast-'+(index+1),name:type.name,kind:type.kind,
      zone:spec.zone,position,spawn:{...position},patrolIndex:pathIndex,
      patrolDirection:pathIndex===path.length-1?-1:1,
      cadence:type.cadence,aggroRange:type.aggroRange,
      intent:'patrol',targetUid:null,lastActionTick:0});
  }
  return out;
}
// Bounded breadth-first pathfinder. Uses the same 4-neighbor collision map
// as player movement, no diagonal shortcuts or ghost movement through walls.
function shortestStep(map,from,to,maxSteps=map.width*map.height){
  if(!walkable(map,from)||!walkable(map,to))return null;
  if(same(from,to))return {step:null,length:0};
  const start=from.y*map.width+from.x,finish=to.y*map.width+to.x;
  const seen=new Set([start]),queue=[{id:start,first:null,length:0}];
  for(let i=0;i<queue.length;i++){
    const current=queue[i];if(current.length>=maxSteps)continue;
    const x=current.id%map.width,y=Math.floor(current.id/map.width);
    for(const [dx,dy]of DIRECTIONS){
      const next={x:x+dx,y:y+dy};
      if(!walkable(map,next))continue;
      const id=next.y*map.width+next.x;
      if(seen.has(id))continue;
      const first=current.first||next,length=current.length+1;
      if(id===finish)return {step:first,length};
      seen.add(id);queue.push({id,first,length});
    }
  }
  return null;
}
function legalPlayers(members,map){
  return Object.entries(members||{}).filter(([,m])=>walkable(map,m?.position))
    .sort(([a],[b])=>a.localeCompare(b));
}
function nextEnemy(map,enemy,members,tick,occupied){
  if(!enemy||!walkable(map,enemy.position))return enemy;
  if(tick%enemy.cadence!==0)return enemy;
  const playerTiles=legalPlayers(members,map);
  const targets=playerTiles.map(([uid,m])=>{
    if(distance(enemy.position,m.position)>enemy.aggroRange)return null;
    const found=shortestStep(map,enemy.position,m.position,enemy.aggroRange);
    return found?{uid,position:m.position,...found}:null;
  }).filter(Boolean).sort((a,b)=>a.length-b.length||a.uid.localeCompare(b.uid));
  const chosen=targets[0];
  let step=null,intent='patrol',targetUid=null;
  let patrolIndex=enemy.patrolIndex,patrolDirection=enemy.patrolDirection;
  const path=routeFor(map,enemy.zone);
  if(chosen){
    intent=chosen.length<=1?'alert':'pursuit';targetUid=chosen.uid;
    if(chosen.length>1)step=chosen.step;
  }else if(path.length){
    // A pursuer walks back to its patrol corridor instead of snapping back.
    const current=path[clampIndex(patrolIndex,path.length)];
    if(!same(current,enemy.position)){
      const returning=shortestStep(map,enemy.position,current);
      step=returning?.step||null;
      intent='return';
    }else{
      if(patrolIndex+patrolDirection<0||
         patrolIndex+patrolDirection>=path.length)patrolDirection*=-1;
      patrolIndex=clampIndex(patrolIndex+patrolDirection,path.length);
      step=path[patrolIndex];
    }
  }
  if(step&&(occupied.has(key(step))||playerTiles.some(([,p])=>same(p.position,step)))){
    step=null;
    // A blocked patrol step must not advance its waypoint index: otherwise
    // the next legal tick could attempt a nonadjacent leap.
    if(!chosen){patrolIndex=enemy.patrolIndex;patrolDirection=enemy.patrolDirection;}
    if(chosen)intent='alert';
  }
  if(step&&!walkable(map,step))step=null;
  if(step&&distance(enemy.position,step)!==1)
    throw new Error('靈獸嘗試非法跨格移動');
  return {...enemy,position:step?{...step}:{...enemy.position},
    patrolIndex,patrolDirection,intent,targetUid,lastActionTick:tick};
}
function clampIndex(i,n){return Math.max(0,Math.min(n-1,Number.isInteger(i)?i:0));}
function simulate(map,enemies,members,startTick,endTick){
  let next=enemies.map(enemy=>({...enemy,position:{...enemy.position}}));
  for(let tick=startTick;tick<=endTick;tick++){
    const occupied=new Set(next.map(e=>key(e.position)));
    next=next.map(enemy=>{
      occupied.delete(key(enemy.position));
      const updated=nextEnemy(map,enemy,members,tick,occupied);
      occupied.add(key(updated.position));
      return updated;
    });
  }
  return next;
}
function advanceWorld(room,map,now){
  if(!isRunning(room))return null;
  const applied=Number.isSafeInteger(room.battleAppliedTick)&&room.battleAppliedTick>=0?
    room.battleAppliedTick:0;
  const due=Math.max(applied,dueTick(room,now));
  const initialized=room.enemyAiVersion===ENEMY_AI_VERSION&&Array.isArray(room.enemies);
  if(initialized&&due<=applied)return null;
  if(room.enemyAiVersion!==undefined&&room.enemyAiVersion!==null&&
     room.enemyAiVersion!==ENEMY_AI_VERSION)
    throw Object.assign(new Error('副本靈獸 AI 版本尚未支援'),{status:409});
  const base=initialized?room.enemies:initialEnemies(map);
  // When no one was connected, skip the historical idle gap, then simulate
  // only the most recent bounded window. No retroactive attacks or rewards.
  const start=Math.max(applied+1,due-MAX_CATCHUP_TICKS+1);
  const enemies=due>applied?simulate(map,base,room.members,start,due):base;
  return {enemies,enemyAiVersion:ENEMY_AI_VERSION,
    ...(due>applied?{battleAppliedTick:due,battleAppliedAtMs:now}:{})};
}
module.exports={ENEMY_AI_VERSION,MAX_CATCHUP_TICKS,KINDS,DIRECTIONS,
  initialEnemies,routeFor,shortestStep,nextEnemy,simulate,advanceWorld};
