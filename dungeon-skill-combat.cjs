'use strict';
// Stage 11B: deterministic dungeon-only martial arts, independent of tactical
// turns. The server owns loadouts, geometry, stamina, damage and NPC positions.
const Manuals=require('./public/cultivation/manual-rules.js');
const SwordPath=require('./public/cultivation/flying-sword-path.js');
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const {maxHealth,recordedMax,MAX_STRIKE_SEQ}=require('./dungeon-player-combat.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const {staminaFor,staminaAfterCost}=require('./dungeon-stamina-rules.cjs');
const Resolution=require('./public/cultivation/dungeon-skill-resolution.js');
const {isFocusEmpowered,focusCost,ray,rayTo,visible,beamArray}=Resolution;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const skillOf=(id,record,score)=>{
  const s=Manuals.BY_SKILL[id];
  if(!s||!Manuals.unlocked(record,id))return null;
  return Manuals.skillAtLevel(s,record.skillLevels?.[id],Manuals.refinementFor(record.books?.[s.manualId]));
};
const describeDungeonSkill=skill=>{
  if(skill.kind==='fist-focus')
    return '立即凝聚六層蓄勢。接下來六次成功施放的體修攻擊，體力消耗減半並向上取整；每次耗一層。副本中沒有回合或冷卻時間限制。';
  if(skill.kind==='flying-sword')
    return String(skill.description||'')+'副本中沒有回合或冷卻時間限制。';
  return String(skill.description||'');
};
const loadout=(record,score,index,member=null)=>{
  const s=Manuals.normalize(record);
  if(!Number.isInteger(index)||index<0||index>=3)throw fail('技能配置編號無效',400);
  const item=s.loadouts[index];
  const weaponMode=Array.isArray(s.weaponIds);
  const ids=(weaponMode?s.equipped:item.skillIds).filter(id=>skillOf(id,s,score));
  return {dungeonLoadoutIndex:weaponMode?0:index,
    dungeonLoadoutNames:weaponMode?[]:s.loadouts.map(v=>v.name),
    dungeonWeaponIds:weaponMode?[...s.weaponIds]:[],
    dungeonSkillIds:ids,dungeonSkills:ids.map(id=>{
      const skill=skillOf(id,s,score);
      const preview=Manuals.singleHitDamage(attackPower(s,member),skill);
      return {id,weaponId:skill.manualId,name:skill.name,kind:skill.kind,school:skill.school,
        cost:skill.cost,range:skill.range,level:skill.level,
        refinement:Manuals.refinementFor(s.books[skill.manualId]),
        singleHitDamage:preview.damage||preview.potential||0,
        ...(preview.center!==undefined?{centerHitDamage:preview.center}:{}),
        description:describeDungeonSkill(skill)};
    })};
};
function attackPower(record,member=null){
  // A dungeon is a 築基 trial: the server's trusted combat attack should
  // match the real trial, not the obsolete fixed 30-point dungeon scale.
  // Manuscript bonuses are re-read from A before each cast; any legacy
  // member without a trusted snapshot keeps its original fallback.
  const trusted=Number.isSafeInteger(member?.battleAttack)&&
    member.battleAttack>0?member.battleAttack:30;
  return trusted+Math.min(200,Manuals.manualAttackBonus(record));
}
function initialCombatLoadout(member,raw){
  const record=Manuals.normalize(raw),score=member.accessScore||0;
  return {...loadout(record,score,record.activeLoadout,member),
    dungeonAttack:attackPower(record,member),flyingSword:null,focusCharges:0,
    skillSeq:0,lastSkill:null};
}
function switchLoadout(room,uid,raw,index){
  if(Array.isArray(raw?.weaponIds))
    throw fail('多人副本戰鬥中不可切換、裝備或卸下武器',409);
  const member=room.members?.[uid];
  if(room.status!=='assembled'||!member)throw fail('目前無法切換副本功法',409);
  const setting=loadout(Manuals.normalize(raw),member.accessScore||0,index,member);
  if(member.dungeonLoadoutIndex===index&&
    JSON.stringify(member.dungeonSkillIds||[])===JSON.stringify(setting.dungeonSkillIds))
    return {duplicate:true,members:room.members};
  return {duplicate:false,members:{...room.members,
    [uid]:{...member,...setting,dungeonAttack:attackPower(raw,member)}}};
}
function castSkill(room,uid,map,raw,{skillId,target,seq,moveSword=false}={}){
  if(typeof skillId!=='string'||!Manuals.BY_SKILL[skillId])
    throw fail('功法技能無效',400);
  if(!target||!Number.isSafeInteger(target.x)||!Number.isSafeInteger(target.y)||
      !Number.isSafeInteger(seq)||seq<1||seq>MAX_STRIKE_SEQ)
    throw fail('技能目標或操作序號無效',400);
  if(room.status!=='assembled')throw fail('隊伍尚未開始探索',409);
  const member=room.members?.[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  const prior=Number.isSafeInteger(member.skillSeq)?member.skillSeq:0;
  if(seq===prior&&member.lastSkill?.skillId===skillId&&
      member.lastSkill.moveSword===Boolean(moveSword)&&
      same(member.lastSkill.target,target))
    return {duplicate:true,members:room.members,enemies:room.enemies};
  if(seq!==prior+1)throw fail('技能操作已不同步，請重新取得戰場資料',409);
  if(!isAlive(member)||!walkable(map,member.position))throw fail('角色倒地或位置無效',409);
  if(moveSword&&(skillId!=='flight-summon'||!member.flyingSword))
    throw fail('沒有可控制的飛劍',409);
  if(!moveSword&&(!Array.isArray(member.dungeonSkillIds)||
      !member.dungeonSkillIds.includes(skillId)))throw fail('此技能尚未裝備於目前配置',403);
  const normalized=Manuals.normalize(raw);
  const sk=skillOf(skillId,normalized,member.accessScore||0);
  if(!sk)throw fail('武器技能尚未解鎖',403);
  return Resolution.resolveCast(room,uid,map,sk,{
    target,seq,moveSword,base:attackPower(normalized,member)
  });
}
module.exports={attackPower,initialCombatLoadout,loadout,switchLoadout,
  isFocusEmpowered,focusCost,ray,rayTo,visible,beamArray,castSkill};
