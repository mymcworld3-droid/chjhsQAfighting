'use strict';

const EQUIP_SLOTS = Object.freeze(['本命法寶','護身法寶','佩飾法寶','輔助法寶']);
const REALM_ORDER = Object.freeze({凡人:0,煉氣:1,築基:2,金丹:3,元嬰:4,化神:5,煉虛:6,合體:7,大乘:8,渡劫:9,真仙:10});
const CORE_LOWEST_POWER = 4000;
const CORE_GRADE_STEP = 2000;
const NASCENT_SOUL_THRESHOLD = 68;
const GOLDEN_CORE_THRESHOLD = 28;

const DEFAULT_ARTIFACTS = Object.freeze([
  {id:'mountain-armor',name:'鎮嶽玄甲',realm:'金丹',equipSlot:'護身法寶',effects:[
    {type:'equip_attack_flat',value:80},{type:'equip_hp_flat',value:400}
  ]},
  {id:'void-sword',name:'太虛劍',realm:'元嬰',equipSlot:'本命法寶',effects:[
    {type:'equip_attack_flat',value:180}
  ]},
  {id:'longevity-jade',name:'長生玉佩',realm:'元嬰',equipSlot:'佩飾法寶',effects:[
    {type:'equip_hp_flat',value:900}
  ]}
]);

const RUNTIME_EFFECTS = new Set([
  'equip_damage_percent','equip_damage_reduction_flat','equip_damage_reduction_percent',
  'equip_crit_chance','equip_crit_damage_percent','equip_combo_chance','equip_lifesteal_percent',
  'equip_reflect_percent','equip_shield_flat','equip_true_damage_flat','equip_low_hp_damage_percent',
  'equip_low_hp_reduction_percent','equip_first_hit_reduction_percent','equip_damage_cap_percent',
  'equip_on_correct_shield_flat','equip_cheat_death','equip_copy_enemy_artifact'
]);

const EFFECT_WEIGHTS = Object.freeze({
  equip_attack_flat:1.5,equip_attack_percent:600,equip_hp_flat:.3,equip_hp_percent:400,
  equip_damage_percent:900,equip_damage_reduction_flat:1,equip_damage_reduction_percent:650,
  equip_crit_chance:700,equip_crit_damage_percent:300,equip_combo_chance:1500,
  equip_lifesteal_percent:400,equip_reflect_percent:400,equip_shield_flat:.3,
  equip_true_damage_flat:2,equip_low_hp_damage_percent:350,equip_low_hp_reduction_percent:250,
  equip_first_hit_reduction_percent:250,equip_damage_cap_percent:-500,
  equip_on_correct_shield_flat:.3,equip_cheat_death:500,equip_copy_enemy_artifact:400
});
const EFFECT_LIMITS = Object.freeze({
  equip_attack_flat:100000,equip_attack_percent:5,equip_hp_flat:100000,equip_hp_percent:5,
  equip_damage_percent:3,equip_damage_reduction_flat:100000,equip_damage_reduction_percent:.9,
  equip_crit_chance:.75,equip_crit_damage_percent:3,equip_combo_chance:.1,
  equip_lifesteal_percent:.5,equip_reflect_percent:1,equip_shield_flat:100000,
  equip_true_damage_flat:100000,equip_low_hp_damage_percent:2,equip_low_hp_reduction_percent:.9,
  equip_first_hit_reduction_percent:.9,equip_on_correct_shield_flat:100000
});

const CORE_NAMES = Object.freeze({
  ocean:'大海無垠丹',taichu:'太初回元丹',ningxin:'凝心靜音丹',pojing:'破境衝仙丹',
  xingchen:'星辰吞月丹',wugou:'無垢清心丹',thunder:'萬劫雷霆丹',reverse:'陰陽反轉丹',sword:'破鋒劍心丹'
});
const CORE_FINALE = Object.freeze({
  ocean:{attack:18,heal:11},taichu:{attack:12,heal:20},ningxin:{attack:13,heal:18},
  pojing:{attack:22,heal:9},xingchen:{attack:19,heal:12},wugou:{attack:11,heal:21},
  thunder:{attack:23,heal:10},reverse:{attack:16,heal:16},sword:{attack:24,heal:9}
});
const NEXT_REALM_THRESHOLDS = Object.freeze([28,68,188,428,788,1268,1868,2588]);

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function positive(value){return Math.max(0,finite(value));}
function clamp(value,min,max){return Math.min(max,Math.max(min,finite(value,min)));}
function clampGrade(value){return Math.min(9,Math.max(1,Math.floor(finite(value,9)||9)));}
function level(value){return Math.min(10,Math.max(0,Math.floor(finite(value))));}
function stableHash(text){let h=2166136261;for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function roll01(seed,kind){return stableHash(String(seed)+':'+String(kind))/4294967296;}
function chanceByGrade(grade,base,step,cap=100){return Math.min(cap,base+(9-clampGrade(grade))*step);}
function safeName(value,max=40){return String(value||'').trim().slice(0,max);}
function safePortrait(value){
  const url=String(value||'').trim().slice(0,2048);
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^(?:assets\/|images\/|img\/)[a-z0-9/_\-.%]+$/i.test(url)) return url;
  return '';
}

function coreSnapshot(data){
  const score=positive(data?.stats?.totalScore), training=data?.cultivationTraining||{};
  const raw=training.equippedCore || (training.equipped===true?training.core:null);
  if(score<GOLDEN_CORE_THRESHOLD||training.coreEnabled===false||!raw?.type)return null;
  return {type:String(raw.type),grade:clampGrade(raw.grade),name:safeName(raw.name||CORE_NAMES[raw.type]||'本命金丹',40)};
}
function soulSnapshot(data,core){
  if(!core||positive(data?.stats?.totalScore)<NASCENT_SOUL_THRESHOLD)return null;
  const nodes=data?.nascentSoulTree?.paths?.[core.type]?.nodes||{};
  const finale=CORE_FINALE[core.type]||CORE_FINALE.taichu;
  const quality=9-core.grade;
  return {
    type:core.type,
    attackFlat:level(nodes.leftMain)*12+level(nodes.leftFarTop)*7,
    maxHpFlat:level(nodes.rightMain)*70+level(nodes.rightFarTop)*55,
    bonusDamage:level(nodes.leftTop)*8+level(nodes.leftFarBottom)*6+
      level(nodes.leftFinal)*(finale.attack+quality*2),
    reductionFlat:level(nodes.rightTop)*5,
    coreHeal:level(nodes.rightFinal)*(finale.heal+quality)
  };
}
function artifactCatalog(data){
  const items=Array.isArray(data?.items)?data.items.filter(x=>x&&typeof x==='object'&&x.id):[];
  if(!items.length)return DEFAULT_ARTIFACTS;
  if(Math.max(0,Math.floor(finite(data?.artifactCatalogSchemaVersion)))>=2)return items;
  // Match the client catalog backfill path for legacy remote configs.
  const merged=new Map(DEFAULT_ARTIFACTS.map(item=>[item.id,item]));
  for(const item of items){
    const id=String(item.id||'').trim();if(!id)continue;
    merged.set(id,{...(merged.get(id)||{}),...item,id});
  }
  return [...merged.values()];
}
function equippedArtifacts(player,catalog){
  const system=player?.artifactSystem||{}, inventory=system.inventory||{}, equipped=system.equipped||{};
  const byId=new Map(catalog.map(item=>[String(item.id||''),item]));
  const out=[];
  for(const slot of EQUIP_SLOTS){
    const id=String(equipped?.[slot]||'');
    if(!id||positive(inventory?.[id])<1)continue;
    const item=byId.get(id);
    if(!item)continue;
    const assigned=EQUIP_SLOTS.includes(item.equipSlot)?item.equipSlot:'輔助法寶';
    if(assigned!==slot)continue;
    out.push({slot,item});
  }
  return out;
}
function equippedEffects(equipped){
  return equipped.flatMap(({slot,item})=>(Array.isArray(item.effects)?item.effects:[])
    .filter(effect=>effect&&String(effect.type||'').startsWith('equip_'))
    .map((effect,effectIndex)=>({...effect,slot,item,effectIndex})));
}
function sumEffect(effects,type){
  return effects.filter(e=>String(e.type||'')===type).reduce((sum,e)=>sum+positive(e.value),0);
}
function equipmentMultiplier(effects,type,cap=5){
  return effects.filter(e=>String(e.type||'')===type)
    .reduce((m,e)=>m*(1+clamp(e.value,0,cap)),1);
}
function timedAttackMultiplier(player,at=Date.now()){
  const buffs=player?.artifactSystem?.buffs||{};
  return Object.values(buffs).reduce((m,buff)=>{
    if(buff?.type!=='timed_attack_multiplier'||finite(buff.expiresAt)<=at)return m;
    return m*Math.max(0,finite(buff.multiplier,1));
  },1);
}
function artifactPower(item){
  const effects=(Array.isArray(item?.effects)?item.effects:[]).filter(e=>Object.hasOwn(EFFECT_WEIGHTS,e?.type));
  if(!effects.length)return 0;
  const realm=Math.max(0,Math.floor(finite(REALM_ORDER[String(item.realm||'')])));
  const realmPower=45*(realm+1)**2;
  const effectsPower=effects.reduce((sum,e)=>{
    const type=e.type;
    if(type==='equip_damage_cap_percent')return sum+Math.round((1-clamp(e.value,.05,1))*500);
    if(type==='equip_cheat_death'||type==='equip_copy_enemy_artifact')return sum+EFFECT_WEIGHTS[type];
    return sum+Math.round(Math.min(positive(e.value),EFFECT_LIMITS[type]??100000)*EFFECT_WEIGHTS[type]);
  },0);
  return Math.max(0,Math.round(realmPower+effectsPower));
}
function combatPower(stats,core,equipped){
  const base=Math.round(positive(stats.attack)*2+Math.max(1,finite(stats.maxHp,1000))*.2);
  const corePower=core?CORE_LOWEST_POWER+(9-core.grade)*CORE_GRADE_STEP:0;
  const equipment=equipped.reduce((sum,row)=>sum+artifactPower(row.item),0);
  return Math.max(0,Math.round(base+corePower+equipment));
}
function battleSnapshot(effects){
  const list=effects.filter(e=>RUNTIME_EFFECTS.has(String(e.type||''))).map(e=>({
    type:String(e.type||''),value:finite(e.value),artifactId:String(e.item?.id||''),
    artifactName:String(e.item?.name||''),effectIndex:Math.max(0,Math.floor(finite(e.effectIndex)))
  }));
  return {version:1,effects:list,openingShield:Math.max(0,Math.round(sumEffect(list,'equip_shield_flat')))};
}

function trustedRaidPlayerSnapshot(player,uid,catalogDoc={}){
  if(!player||typeof player!=='object')throw new Error('玩家資料不存在');
  const baseAttack=Math.max(0,finite(player?.stats?.attack,200));
  const baseMaxHp=Math.max(1,finite(player?.stats?.maxHp,1000));
  const core=coreSnapshot(player), soul=soulSnapshot(player,core);
  const equipped=equippedArtifacts(player,artifactCatalog(catalogDoc));
  const effects=equippedEffects(equipped);
  const soulAttack=Math.max(0,Math.round(finite(soul?.attackFlat)));
  const soulMaxHp=Math.max(0,Math.round(finite(soul?.maxHpFlat)));
  // Match the browser wrapper exactly: nascent-soul projection first, then equipment
  // flat/percent modifiers, then active timed attack multipliers.
  const attackMultiplier=equipmentMultiplier(effects,'equip_attack_percent')*timedAttackMultiplier(player);
  const hpMultiplier=equipmentMultiplier(effects,'equip_hp_percent');
  const baseCombat={
    attack:Math.max(1,Math.round((baseAttack+sumEffect(effects,'equip_attack_flat'))*attackMultiplier)),
    maxHp:Math.max(1,Math.round((baseMaxHp+sumEffect(effects,'equip_hp_flat'))*hpMultiplier))
  };
  const combat={
    attack:Math.max(1,Math.round((baseAttack+soulAttack+sumEffect(effects,'equip_attack_flat'))*attackMultiplier)),
    maxHp:Math.max(1,Math.round((baseMaxHp+soulMaxHp+sumEffect(effects,'equip_hp_flat'))*hpMultiplier))
  };
  const artifactBattle=battleSnapshot(effects);
  const portrait=safePortrait(player?.equipped?.avatar) ||
    (player?.storyProgressV1?.gender==='female'?'assets/story/characters/player-female-determined.png':'assets/story/characters/player-male-determined.png');
  return {
    uid:String(uid),name:safeName(player.displayName||player?.profile?.displayName||'無名修士',40),
    portrait,totalScore:positive(player?.stats?.totalScore),rankLevel:positive(player?.stats?.rankLevel),
    // Combat power intentionally scores raw+soul base stats and equipment separately,
    // matching public/cultivation/combat-power.js without double-counting equipment stats.
    combatPower:combatPower({attack:baseAttack+soulAttack,maxHp:baseMaxHp+soulMaxHp},core,equipped),
    atk:combat.attack,baseAtk:baseCombat.attack,hp:combat.maxHp,maxHp:combat.maxHp,baseMaxHp:baseCombat.maxHp,
    goldenCore:core,nascentSoul:soul,coreShield:!!core&&player?.stats?.goldenCoreShield===true,coreCorrectStreak:0,
    artifactBattle,artifactShield:artifactBattle.openingShield,artifactFirstHitUsed:false,artifactCheatDeathUsed:false
  };
}
async function loadTrustedRaidPlayer(db,uid){
  const [userSnap,catalogSnap]=await Promise.all([
    db.collection('users').doc(String(uid)).get(),
    db.collection('gameConfig').doc('artifactCatalogV1').get().catch(()=>null)
  ]);
  if(!userSnap.exists)throw Object.assign(new Error('玩家資料不存在'),{status:404});
  return trustedRaidPlayerSnapshot(userSnap.data()||{},uid,catalogSnap?.exists?(catalogSnap.data()||{}):{});
}
function memberSnapshotFromTrusted(player,host=false){
  return {...player,ready:false,alive:true,online:true,host,damage:0,correct:0,attempts:0,
    lastActionId:0,lastBossActionSeen:0,answeredQuestionIds:[],joinedAtMs:Date.now(),heartbeatAtMs:Date.now()};
}
function createTeamBoss(members=[]){
  const team=(Array.isArray(members)?members:[]).filter(Boolean).slice(0,4),count=Math.max(1,team.length);
  const totalAttack=team.reduce((sum,m)=>sum+Math.max(1,Math.round(finite(m?.atk,200))),0);
  const averageHp=team.reduce((sum,m)=>sum+Math.max(1,Math.round(finite(m?.maxHp,1000))),0)/count;
  const maxHp=Math.max(1800,Math.round(totalAttack*(6.5+.5*count)));
  return {id:'shen-qingshuang',hp:maxHp,maxHp,baseAttack:Math.max(70,Math.round(averageHp*.105)),phase:1};
}
function bossPhase(hp,maxHp){const r=clamp(finite(hp)/Math.max(1,finite(maxHp,1)),0,1);return r>.70?1:r>.30?2:3;}
function bossIntent(room){
  const turn=Math.max(1,Math.floor(finite(room?.bossActionCount))+1),phase=bossPhase(room?.bossHp,room?.bossMaxHp);
  const attack=Math.max(1,Math.round(finite(room?.bossBaseAttack,100)));
  if(phase===3)return {phase,name:turn%2===0?'清霜一念':'寒星連斬',cue:'劍意已不再留手，寒氣逼近心脈。',
    damage:Math.round(attack*(turn%2===0?1.45:1.30)),kind:'danger'};
  if(phase===2){const burst=turn%3===0;return {phase,name:burst?'寒霜劍雨':'流霜點劍',
    cue:burst?'漫天劍影正在聚攏，本回合攻勢較強。':'大師姐換了劍路，攻勢開始加快。',
    damage:Math.round(attack*(burst?1.28:1.12)),kind:burst?'burst':'normal'};}
  return {phase,name:turn%4===0?'霜痕':'試劍',cue:turn%4===0?'劍鋒凝霜，比前幾式更重。':'大師姐正在觀察你的應對。',
    damage:Math.round(attack*(turn%4===0?1.12:.92)),kind:'normal'};
}
function nearBreakthrough(score,grade){
  const current=positive(score),next=NEXT_REALM_THRESHOLDS.find(v=>v>current);if(!next)return false;
  const previous=NEXT_REALM_THRESHOLDS.filter(v=>v<=current).at(-1)||28,span=Math.max(1,next-previous);
  return current>=next-span*((20+(9-clampGrade(grade))*5)/100);
}
function coreSupport(member,correct,seed){
  const previous=Math.max(0,Math.floor(finite(member?.coreCorrectStreak))),streak=correct?previous+1:0,core=member?.goldenCore;
  const out={streak,shield:!!core&&member?.coreShield===true,bonusDamage:0,heal:0};
  if(!core)return out;const grade=clampGrade(core.grade);
  if(core.type==='ningxin'&&correct&&previous>=Math.max(1,Math.ceil(grade/3)))out.shield=true;
  if(core.type==='wugou'&&!correct&&!out.shield&&roll01(seed,'wugou')<chanceByGrade(grade,20,10,100)/100)out.shield=true;
  if(core.type==='taichu'&&correct&&streak%Math.max(2,grade+1)===0)out.heal=100;
  if(core.type==='pojing'&&correct&&nearBreakthrough(member.totalScore,grade))out.bonusDamage=100;
  if(core.type==='xingchen'&&correct&&previous>=Math.max(1,grade))out.bonusDamage=80;
  if(core.type==='reverse'&&correct&&streak%Math.max(2,grade+1)===0)out.bonusDamage=120;
  return out;
}
function coreAttack(member,seed){
  const core=member?.goldenCore;if(!core)return 0;const grade=clampGrade(core.grade);
  if(core.type==='ocean'&&roll01(seed,'ocean')<chanceByGrade(grade,10,5,50)/100)return 100;
  if(core.type==='sword'&&roll01(seed,'sword')<chanceByGrade(grade,10,5,50)/100)return 200;
  return 0;
}
function coreCounter(member,received,seed){
  const core=member?.goldenCore;if(!core||core.type!=='thunder'||received<=0)return 0;
  const chance=chanceByGrade(core.grade,10,10,90)/100;
  return roll01(seed,'thunder')<chance?received:0;
}
function runtimeEffects(member){return Array.isArray(member?.artifactBattle?.effects)?member.artifactBattle.effects:[];}
function hpRatio(member){return clamp(finite(member?.hp)/Math.max(1,finite(member?.maxHp,1)),0,1);}
function resolveArtifactAttack(member,baseDamage,seed){
  const effects=runtimeEffects(member);let damagePercent=sumEffect(effects,'equip_damage_percent');
  if(hpRatio(member)<=.30)damagePercent+=sumEffect(effects,'equip_low_hp_damage_percent');
  const normalBase=Math.max(0,baseDamage*(1+damagePercent));
  const crit=roll01(seed,'critical')<clamp(sumEffect(effects,'equip_crit_chance'),0,.75);
  const combo=roll01(seed,'combo')<clamp(sumEffect(effects,'equip_combo_chance'),0,.10);
  const critBonus=sumEffect(effects,'equip_crit_damage_percent');
  let normal=normalBase;if(crit)normal*=1.5+critBonus;if(combo)normal+=normalBase;
  const trueDamage=Math.round(sumEffect(effects,'equip_true_damage_flat'));
  return {damage:Math.max(0,Math.round(normal)+trueDamage),
    lifesteal:clamp(sumEffect(effects,'equip_lifesteal_percent'),0,.5),
    shieldGain:Math.max(0,Math.round(sumEffect(effects,'equip_on_correct_shield_flat')))};
}
function resolvePlayerAction(member,{roomId,actionId,correct}={}){
  const next={...member,artifactBattle:{...(member.artifactBattle||{}),effects:[...runtimeEffects(member)]}};
  const seed=String(roomId)+':'+String(actionId)+':'+String(next.uid),support=coreSupport(next,correct,seed+':support');
  next.coreCorrectStreak=support.streak;next.coreShield=support.shield;
  let healed=support.heal+(correct?Math.max(0,Math.round(finite(next?.nascentSoul?.coreHeal))):0);
  next.hp=Math.min(next.maxHp,next.hp+healed);
  let damage=0;
  if(correct){
    const base=Math.max(1,Math.round(finite(next.atk,200)))+support.bonusDamage+
      coreAttack(next,seed+':core')+Math.max(0,Math.min(1000,Math.round(finite(next?.nascentSoul?.bonusDamage))));
    const artifact=resolveArtifactAttack(next,base,seed+':artifact');
    damage=artifact.damage;
    const lifesteal=Math.max(0,Math.round(damage*artifact.lifesteal));healed+=lifesteal;
    next.hp=Math.min(next.maxHp,next.hp+lifesteal);
    next.artifactShield=Math.max(0,Math.round(finite(next.artifactShield)))+artifact.shieldGain;
  }
  return {member:next,damage,healed,correct:correct===true};
}
function resolveArtifactDefense(member,incoming){
  const effects=runtimeEffects(member);let reduction=sumEffect(effects,'equip_damage_reduction_percent');
  if(hpRatio(member)<=.30)reduction+=sumEffect(effects,'equip_low_hp_reduction_percent');
  if(incoming>0&&!member.artifactFirstHitUsed&&sumEffect(effects,'equip_first_hit_reduction_percent')>0){
    reduction+=sumEffect(effects,'equip_first_hit_reduction_percent');member.artifactFirstHitUsed=true;
  }
  reduction=clamp(reduction,0,.9);
  let damage=Math.max(0,incoming*(1-reduction)-sumEffect(effects,'equip_damage_reduction_flat'));
  const caps=effects.filter(e=>e.type==='equip_damage_cap_percent').map(e=>clamp(e.value,.05,1));
  if(caps.length)damage=Math.min(damage,Math.max(1,Math.round(member.maxHp*Math.min(...caps))));
  const absorbed=Math.min(Math.max(0,finite(member.artifactShield)),damage);
  member.artifactShield=Math.max(0,Math.round(finite(member.artifactShield)-absorbed));damage-=absorbed;
  let hpDamage=Math.max(0,Math.round(damage));
  if(effects.some(e=>e.type==='equip_cheat_death')&&!member.artifactCheatDeathUsed&&member.hp>1&&hpDamage>=member.hp){
    hpDamage=member.hp-1;member.artifactCheatDeathUsed=true;
  }
  return {hpDamage,reflectDamage:Math.max(0,Math.round(hpDamage*clamp(sumEffect(effects,'equip_reflect_percent'),0,1)))};
}
function resolveBossDefense(member,{roomId,bossAction}={}){
  const next={...member,artifactBattle:{...(member.artifactBattle||{}),effects:[...runtimeEffects(member)]}};
  const incoming=Math.max(0,Math.round(finite(bossAction?.damage))),seed=String(roomId)+':boss:'+String(bossAction?.id)+':'+String(next.uid);
  let damage=0,reflected=0,guarded=false;
  if(next.coreShield&&incoming>0){next.coreShield=false;guarded=true;}
  else if(incoming>0){
    const defense=resolveArtifactDefense(next,incoming);
    damage=Math.max(0,defense.hpDamage-Math.max(0,Math.min(1000,Math.round(finite(next?.nascentSoul?.reductionFlat)))));
    reflected=damage>0?defense.reflectDamage+coreCounter(next,damage,seed+':counter'):0;
    next.hp=Math.max(0,next.hp-damage);
  }
  return {member:next,damage,reflectedDamage:Math.max(0,Math.round(reflected)),guarded};
}

module.exports={
  EQUIP_SLOTS,RUNTIME_EFFECTS,stableHash,artifactPower,combatPower,trustedRaidPlayerSnapshot,loadTrustedRaidPlayer,
  memberSnapshotFromTrusted,createTeamBoss,bossPhase,bossIntent,resolvePlayerAction,resolveBossDefense
};
