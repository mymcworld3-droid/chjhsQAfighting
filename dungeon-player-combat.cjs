'use strict';
// Stage 11A: server-only cooperative melee. Skills and drops are later stages.
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const {staminaFor,staminaAfterCost}=require('./dungeon-stamina-rules.cjs');
const STAMINA_COST=2,DAMAGE=30,MAX_STRIKE_SEQ=100000;
// 築基期 (stage 5) encounter budget: regular trial beasts begin near 500 HP.
// Faster ranged beasts are slightly frailer; armored enemies trade speed for HP.
const ENEMY_HEALTH=Object.freeze({
  wolf:500,wisp:440,golem:650,guardian:1200,boss:Boss.HP
});
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const maxHealth=kind=>ENEMY_HEALTH[kind]||ENEMY_HEALTH.wolf;
const recordedMax=enemy=>Number.isSafeInteger(enemy?.battleMaxHealth)&&
  enemy.battleMaxHealth>0?enemy.battleMaxHealth:maxHealth(enemy?.kind);
// C-room snapshots contain trusted trial attack, rather than the old
// temporary 30-point dungeon attack. Preserve fallback for legacy sessions.
const playerStrikeDamage=member=>
  Number.isSafeInteger(member?.battleAttack)&&member.battleAttack>0?
    member.battleAttack:DAMAGE;
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
  const index=room.enemies?.findIndex(e=>e.id===enemyId)??-1;
  if(index<0)throw fail('靈獸已被擊敗或不在戰場上',409);
  const enemy=room.enemies[index];
  if(!walkable(map,enemy.position)||Boss.reach(member.position,enemy)!==1)
    throw fail('請先移動至靈獸相鄰一格再攻擊',409);
  const stamina=staminaFor(member);
  if(stamina<STAMINA_COST)throw fail('探索體力不足，無法攻擊',409);
  const health=Number.isSafeInteger(enemy.battleHealth)?
    Math.max(0,Math.min(recordedMax(enemy),enemy.battleHealth)):
    recordedMax(enemy);
  if(health===0)throw fail('靈獸已被擊敗',409);
  const tick=Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0;
  const updated={...enemy},damageAmount=playerStrikeDamage(member);
  const teamwork=enemy.kind==='boss'?
    Boss.damage(updated,uid,damageAmount,tick,Boss.comboReady(enemy,uid,tick)):null;
  const remaining=teamwork?updated.battleHealth:Math.max(0,health-damageAmount);
  const defeated=remaining===0;
  if(!teamwork){
    updated.battleHealth=remaining;
    updated.battleMaxHealth=recordedMax(enemy);
  }
  const hit={seq,enemyId,origin:{...member.position},target:{...enemy.position},damage:teamwork?.damage??Math.min(health,damageAmount),
    remainingHealth:remaining,defeated,tick,
    ...(teamwork?{shieldDamage:teamwork.shieldDamage,combo:teamwork.combo,
      shieldBroken:teamwork.shieldBroken}:{})};
  const enemies=defeated?room.enemies.filter(e=>e.id!==enemyId):
    room.enemies.map(e=>e.id===enemyId?updated:e);
  const members={...room.members,[uid]:{...member,
    explorationStamina:staminaAfterCost(member,STAMINA_COST),strikeSeq:seq,lastStrike:hit}};
  return {duplicate:false,members,enemies,hit};
}
module.exports={STAMINA_COST,DAMAGE,MAX_STRIKE_SEQ,ENEMY_HEALTH,maxHealth,recordedMax,playerStrikeDamage,strikeEnemy};
