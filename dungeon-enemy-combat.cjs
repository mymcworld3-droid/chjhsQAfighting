'use strict';

// Stage-10 co-op battle: server-only telegraphs, dodgeable hit resolution,
// isolated player health, and bounded offline catch-up. No rewards/respawn.
const {walkable}=require('./dungeon-map-generator.cjs');
const HEALTH_MAX=100;
const WINDUP_TICKS=2;
const SAFE_CATCHUP_TICKS=3;
const ATTACK_RULES=Object.freeze({
  wolf:Object.freeze({label:'撕咬突襲',pattern:'bite',damage:8,range:1}),
  wisp:Object.freeze({label:'靈焰直射',pattern:'ray',damage:6,range:2}),
  golem:Object.freeze({label:'震地扇擊',pattern:'fan',damage:12,range:3}),
  guardian:Object.freeze({label:'鎮鑰裂地震波',pattern:'fan',damage:14,range:3})
});
const DIRS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const key=p=>p.x+','+p.y;
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const maxHealth=member=>Number.isSafeInteger(member?.battleMaxHealth)&&
  member.battleMaxHealth>0?member.battleMaxHealth:HEALTH_MAX;
const clampHealth=member=>{
  const max=maxHealth(member);
  const n=Number.isSafeInteger(member?.battleHealth)?
    member.battleHealth:max;
  return Math.max(0,Math.min(max,n));
};
const scaledDamage=(base,member)=>
  Math.max(1,Math.round(Math.max(0,base)*maxHealth(member)/HEALTH_MAX));
const isAlive=member=>member?.downed!==true&&clampHealth(member)>0;
const attackRule=enemy=>ATTACK_RULES[enemy?.kind]||null;
function directionToward(from,to){
  const dx=to.x-from.x,dy=to.y-from.y;
  // Prefer the larger axis, then horizontal for deterministic ties.
  return Math.abs(dx)>=Math.abs(dy)?
    [Math.sign(dx),0]:[0,Math.sign(dy)];
}
function warningCells(map,enemy,target){
  const rule=attackRule(enemy);
  if(!rule||!walkable(map,enemy?.position)||!walkable(map,target))return [];
  const origin=enemy.position;
  if(same(origin,target))return [];
  if(rule.pattern==='bite')return dist(origin,target)===1?[{...target}]:[];
  const [dx,dy]=directionToward(origin,target);
  const first={x:origin.x+dx,y:origin.y+dy};
  if(!walkable(map,first))return [];
  const candidates=[first],second={x:first.x+dx,y:first.y+dy};
  if(walkable(map,second))candidates.push(second);
  if(rule.pattern==='fan'&&walkable(map,second)){
    const left={x:second.x-dy,y:second.y+dx};
    const right={x:second.x+dy,y:second.y-dx};
    if(walkable(map,left))candidates.push(left);
    if(walkable(map,right))candidates.push(right);
  }
  // Do not telegraph an attack that cannot hit the selected target.
  if(!candidates.some(p=>same(p,target)))return [];
  return candidates;
}
function planAttack(map,enemy,members,tick){
  if(!attackRule(enemy)||!Number.isSafeInteger(tick)||tick<1)return null;
  const choices=Object.entries(members||{}).filter(([,m])=>
    isAlive(m)&&walkable(map,m.position))
    .map(([uid,member])=>({uid,member,distance:dist(enemy.position,member.position)}))
    .sort((a,b)=>a.distance-b.distance||a.uid.localeCompare(b.uid));
  for(const {uid,member}of choices){
    const cells=warningCells(map,enemy,member.position);
    if(!cells.length)continue;
    const rule=attackRule(enemy);
    return {kind:rule.pattern,label:rule.label,damage:rule.damage,
      from:{...enemy.position},cells,startedAtTick:tick,
      resolvesAtTick:tick+WINDUP_TICKS,targetUid:uid};
  }
  return null;
}
function resolveAttack(enemy,members,tick){
  const attack=enemy?.attack;
  if(!attack||tick<attack.resolvesAtTick)return {members,hits:[]};
  const hits=[];
  let next=members;
  for(const [uid,member]of Object.entries(members||{})){
    if(!isAlive(member)||!attack.cells.some(cell=>same(cell,member.position)))continue;
    const damage=scaledDamage(attack.damage,member);
    const health=Math.max(0,clampHealth(member)-damage);
    if(next===members)next={...members};
    next[uid]={...member,battleHealth:health,downed:health===0,
      lastDamage:{sourceId:enemy.id,amount:damage,tick}};
    hits.push(uid);
  }
  return {members:next,hits};
}
function pendingPublic(attack){
  if(!attack)return null;
  return {kind:attack.kind,label:attack.label,damage:attack.damage,
    cells:attack.cells.map(p=>({...p})),
    startedAtTick:attack.startedAtTick,resolvesAtTick:attack.resolvesAtTick};
}
function isWarned(room,uid){
  const member=room?.members?.[uid];
  return Boolean(member&&room?.enemies?.some(enemy=>
    enemy.attack?.cells?.some(p=>same(p,member.position))));
}
module.exports={HEALTH_MAX,maxHealth,scaledDamage,WINDUP_TICKS,SAFE_CATCHUP_TICKS,ATTACK_RULES,
  DIRS,isAlive,clampHealth,attackRule,warningCells,planAttack,resolveAttack,
  pendingPublic,isWarned};
