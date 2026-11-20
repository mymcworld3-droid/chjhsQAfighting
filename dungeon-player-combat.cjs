'use strict';
// Server-authoritative basic strike: exactly the trial's 2-tile cardinal line.
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const {staminaFor,staminaAfterCost}=require('./dungeon-stamina-rules.cjs');
const STAMINA_COST=2,DAMAGE=30,RANGE=2,MAX_STRIKE_SEQ=100000;
// 築基期 (stage 5) encounter budget: regular trial beasts begin near 500 HP.
// Faster ranged beasts are slightly frailer; armored enemies trade speed for HP.
const ENEMY_HEALTH=Object.freeze({
  wolf:500,wisp:440,golem:650,guardian:1200,boss:Boss.HP
});
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const DIRECTIONS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
const maxHealth=kind=>ENEMY_HEALTH[kind]||ENEMY_HEALTH.wolf;
const recordedMax=enemy=>Number.isSafeInteger(enemy?.battleMaxHealth)&&
  enemy.battleMaxHealth>0?enemy.battleMaxHealth:maxHealth(enemy?.kind);
// C-room snapshots contain trusted trial attack, rather than the old
// temporary 30-point dungeon attack. Preserve fallback for legacy sessions.
const playerStrikeDamage=member=>
  // Initial/switch-loadout values come from verified A-side manuscript state.
  // The trial includes this bonus even when no technique is equipped.
  Number.isSafeInteger(member?.dungeonAttack)&&member.dungeonAttack>0?
    member.dungeonAttack:
    Number.isSafeInteger(member?.battleAttack)&&member.battleAttack>0?
      member.battleAttack:DAMAGE;
function strikeLine(map,origin,enemy){
  // Select the shortest legal cardinal ray that intersects the requested
  // creature, including all four cells of the 2x2 boss. Stone blocks rays.
  let best=null;
  for(const [dx,dy] of DIRECTIONS){
    const cells=[];
    for(let n=1;n<=RANGE;n++){
      const p={x:origin.x+dx*n,y:origin.y+dy*n};
      if(!walkable(map,p))break;
      cells.push(p);
      if(Boss.occupies(enemy,p)){
        if(!best||n<best.distance)best={cells:[],distance:n,dx,dy};
        break;
      }
    }
  }
  if(!best)return null;
  const cells=[];
  for(let n=1;n<=RANGE;n++){
    const p={x:origin.x+best.dx*n,y:origin.y+best.dy*n};
    if(!walkable(map,p))break;
    cells.push(p);
  }
  return cells;
}
function strikeEnemy(room,uid,map,{enemyId,seq}={}){
  if(typeof enemyId!=='string'||!(/^(beast-[1-9][0-9]{0,4}|guardian-1|boss-1)$/.test(enemyId)))
    throw fail('靈獸目標無效',400);
  if(!Number.isSafeInteger(seq)||seq<1||seq>MAX_STRIKE_SEQ)
    throw fail('攻擊序號無效',400);
  if(room?.status!=='assembled')throw fail('隊伍尚未開始探索',409);
  const member=room.members?.[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  const prior=Number.isSafeInteger(member.strikeSeq)?member.strikeSeq:0;
  if(seq===prior&&member.lastStrike?.enemyId===enemyId&&
      member.lastStrike?.seq===seq)
    return {duplicate:true,members:room.members,enemies:room.enemies};
  if(seq!==prior+1)throw fail('攻擊已不同步，請重新取得隊伍狀態',409);
  if(!isAlive(member))throw fail('修士已倒地，暫時無法攻擊',409);
  if(member.dungeonSkillIds?.length)
    throw fail('已裝備功法技能，普通攻擊已由技能取代',409);
  if(!walkable(map,member.position))throw fail('角色所在位置無效',409);
  const target=room.enemies?.find(e=>e.id===enemyId);
  if(!target)throw fail('靈獸已被擊敗或不在戰場上',409);
  const cells=strikeLine(map,member.position,target);
  if(!cells)throw fail('請選擇同一行或列的前方兩格靈獸，且不能隔著岩壁',409);
  const stamina=staminaFor(member);
  if(stamina<STAMINA_COST)throw fail('探索體力不足，無法攻擊',409);
  const damageAmount=playerStrikeDamage(member);
  const tick=Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0;
  const updated=[],hits=[];
  for(const enemy of room.enemies){
    if(!cells.some(p=>Boss.occupies(enemy,p))){
      updated.push(enemy);continue;
    }
    const health=Number.isSafeInteger(enemy.battleHealth)?
      Math.max(0,Math.min(recordedMax(enemy),enemy.battleHealth)):
      recordedMax(enemy);
    if(!health){updated.push(enemy);continue;}
    const copy={...enemy};
    const teamwork=enemy.kind==='boss'?
      Boss.damage(copy,uid,damageAmount,tick,Boss.comboReady(enemy,uid,tick)):null;
    const remaining=teamwork?copy.battleHealth:Math.max(0,health-damageAmount);
    if(!teamwork){
      copy.battleHealth=remaining;
      copy.battleMaxHealth=recordedMax(enemy);
    }
    const hit={enemyId:enemy.id,damage:teamwork?.damage??Math.min(health,damageAmount),
      remainingHealth:remaining,defeated:remaining===0,
      ...(teamwork?{shieldDamage:teamwork.shieldDamage,combo:teamwork.combo,
        shieldBroken:teamwork.shieldBroken}:{})};
    hits.push(hit);
    if(remaining>0)updated.push(copy);
  }
  const primary=hits.find(hit=>hit.enemyId===enemyId);
  if(!primary)throw fail('靈獸已被擊敗',409);
  const hit={seq,enemyId,origin:{...member.position},
    target:{...target.position},...primary,tick,
    hits,cells:cells.map(p=>({...p}))};
  const members={...room.members,[uid]:{...member,
    explorationStamina:staminaAfterCost(member,STAMINA_COST),
    strikeSeq:seq,lastStrike:hit}};
  return {duplicate:false,members,enemies:updated,hit};
}
module.exports={STAMINA_COST,DAMAGE,RANGE,MAX_STRIKE_SEQ,ENEMY_HEALTH,maxHealth,recordedMax,playerStrikeDamage,strikeLine,strikeEnemy};
