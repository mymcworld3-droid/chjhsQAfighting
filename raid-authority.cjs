'use strict';
const soulTalents = require('./public/cultivation/soul-talents.js');

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
const NEXT_REALM_THRESHOLDS = Object.freeze([28,68,188,428,788,1268,1868,2588]);
const BATTLE_SUBJECTS = Object.freeze(['國文','英文','數學','公民','歷史','地理','物理','化學','生物']);

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function positive(value){return Math.max(0,finite(value));}
function clamp(value,min,max){return Math.min(max,Math.max(min,finite(value,min)));}
function clampGrade(value){return Math.min(9,Math.max(1,Math.floor(finite(value,9)||9)));}
function level(value){return Math.min(10,Math.max(0,Math.floor(finite(value))));}
function stableHash(text){let h=2166136261;for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function deterministicPercent(seed){return stableHash(seed)%100;}
function roll01(seed,kind){return stableHash(String(seed)+':'+String(kind))/4294967296;}
function chanceByGrade(grade,base,step,cap=100){return Math.min(cap,base+(9-clampGrade(grade))*step);}
function safeName(value,max=40){return String(value||'').trim().slice(0,max);}
function safePortrait(value){
  const url=String(value||'').trim().slice(0,2048);
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^(?:assets\/|images\/|img\/)[a-z0-9/_\-.%]+$/i.test(url)) return url;
  return '';
}

function normalizeSubject(input){
  const value=String(input??'').trim().replace(/\s+/g,'');
  const aliases={數學A:'數學',數學B:'數學',理化:'物理',國語:'國文',英語:'英文',Chinese:'國文',English:'英文',Math:'數學',Biology:'生物'};
  const subject=aliases[value]||value;
  return BATTLE_SUBJECTS.includes(subject)?subject:'';
}
function subjectsFrom(value){
  const raw=Array.isArray(value)?value:String(value??'').split(/[,，、;；\n]/);
  return [...new Set(raw.map(normalizeSubject).filter(Boolean))];
}
function educationGrade(value){
  const text=String(value??''),m=text.match(/(?:第)?([一二三四五六七八九十]|1[0-2]|[1-9])(?:年級|年)/);
  const names={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  const year=m?(names[m[1]]||Number(m[1])):1;
  if(/國小|小學/.test(text))return Math.min(6,year);
  if(/高中|高職/.test(text))return Math.min(12,9+year);
  if(/大學|研究所/.test(text))return 13;
  if(/國中|初中/.test(text))return Math.min(9,6+year);
  if(/^(?:[7-9]|[一二三])年級$/.test(text))return Math.min(9,6+year);
  return 7;
}
function gradeLabel(grade){
  if(grade>=13)return '大學';
  const n=['一','二','三','四','五','六'];
  if(grade<=6)return '國小'+(n[grade-1]||'一')+'年級';
  if(grade<=9)return '國中'+n[grade-7]+'年級';
  return '高中'+n[grade-10]+'年級';
}
function unitGrade(path){
  const suffix=String(path||'').split('/').slice(1).join('/');
  const middle=suffix.match(/([七八九7-9])(?:上|下|年級)/);
  if(middle)return ({七:7,八:8,九:9})[middle[1]]||Number(middle[1]);
  const high=suffix.match(/(?:高中|高職)(?:第)?([一二三1-3])(?:年級|年|上|下)?/);
  if(high)return 9+(({一:1,二:2,三:3})[high[1]]||Number(high[1]));
  if(/高中|高職|學測|分科/.test(suffix))return 10;
  return null;
}
function trustedKnowledgeScope(data={}){
  const profile=data.profile||{},settings=data.gameSettings||{},grade=educationGrade(profile.educationLevel||data.educationLevel);
  const focused=settings.sourceMode==='focused'&&Array.isArray(settings.focusedUnits)&&settings.focusedUnits.length>0;
  const units=focused?settings.focusedUnits.map(raw=>{
    if(!raw||typeof raw!=='object')return null;
    const path=String(raw.path||'').replace(/\\/g,'/').slice(0,160);
    const subject=normalizeSubject(path.split('/').filter(Boolean)[0]||raw.subject);if(!subject)return null;
    const detail=String(raw.detail||'').trim().slice(0,100);
    const topics=(Array.isArray(raw.sub_topics)?raw.sub_topics:[]).map(v=>String(v).trim().slice(0,80)).filter(Boolean).slice(0,8);
    const topic=[detail,topics.length?'核心考點：'+topics.join('、'):''].filter(Boolean).join('（')+(detail&&topics.length?'）':'');
    return {subject,topic,grade:unitGrade(path),key:subject+':'+path.toLowerCase()+':'+detail.toLowerCase()};
  }).filter(Boolean).slice(0,24):[];
  const weak=subjectsFrom(profile.weakSubjects);
  const allowed=grade<=6?['國文','英文','數學']:BATTLE_SUBJECTS;
  let validUnits=units.filter(u=>allowed.includes(u.subject)&&(!u.grade||u.grade<=grade));
  let subjects=validUnits.length?[...new Set(validUnits.map(u=>u.subject))]:weak.filter(s=>allowed.includes(s));
  if(!subjects.length)subjects=allowed.filter(s=>BATTLE_SUBJECTS.includes(s));
  return {version:1,grade,level:gradeLabel(grade),subjects:[...new Set(subjects)],units:validUnits,
    difficulty:['easy','medium','hard'].includes(String(settings.difficulty))?String(settings.difficulty):'medium',
    policy:validUnits.length?'focused-units':'trusted-subjects'};
}
function pickTrustedRaidKnowledge(scope,actionId){
  const index=Math.max(0,Math.floor(finite(actionId,1))-1),units=Array.isArray(scope?.units)?scope.units:[],
    subjects=Array.isArray(scope?.subjects)&&scope.subjects.length?scope.subjects:BATTLE_SUBJECTS;
  const unit=units.length?units[index%units.length]:null;
  return {subject:unit?.subject||subjects[index%subjects.length]||'數學',specificTopic:unit?.topic||'',
    level:String(scope?.level||'國中一年級'),difficulty:String(scope?.difficulty||'medium')};
}

function coreSnapshot(data){
  const score=positive(data?.stats?.totalScore), training=data?.cultivationTraining||{};
  const raw=training.equippedCore || (training.equipped===true?training.core:null);
  if(score<GOLDEN_CORE_THRESHOLD||training.coreEnabled===false||!raw?.type)return null;
  return {type:String(raw.type),grade:clampGrade(raw.grade),name:safeName(raw.name||CORE_NAMES[raw.type]||'本命金丹',40)};
}
function soulNodeLevels(tree,type){
  const raw=tree?.paths?.[type]?.nodes||{};
  const version=Math.floor(finite(tree?.version));
  if(version>=2){
    const clean={};
    for(const id of ['leftFinal','leftFarTop','leftTop','leftMain','leftBottom','leftFarBottom',
      'rightMain','rightTop','rightFarTop','rightFinal','rightFarBottom','rightBottom']){
      const n=level(raw[id]);if(n)clean[id]=n;
    }
    return clean;
  }
  // Legacy v1 node names used attack/vitality/focus plus seed/form/realm gates.
  const migrated={
    leftMain:Math.min(10,level(raw.attack)*2),
    rightMain:Math.min(10,level(raw.vitality)*2),
    leftBottom:Math.min(10,level(raw.focus)*2),
    leftTop:raw.seed?1:0,
    rightTop:raw.form?1:0,
    rightBottom:raw.realm?1:0
  };
  if((migrated.leftTop||migrated.leftBottom)&&migrated.leftMain<5)migrated.leftMain=5;
  if((migrated.rightTop||migrated.rightBottom)&&migrated.rightMain<5)migrated.rightMain=5;
  return migrated;
}
function soulSnapshot(data,core){
  if(!core||positive(data?.stats?.totalScore)<NASCENT_SOUL_THRESHOLD)return null;
  const nodes=soulNodeLevels(data?.nascentSoulTree,core.type);
  const quality=9-core.grade;
  return {
    type:core.type,
    attackFlat:level(nodes.leftMain)*12+level(nodes.leftFarTop)*7,
    maxHpFlat:level(nodes.rightMain)*70+level(nodes.rightFarTop)*55,
    bonusDamage:level(nodes.leftTop)*8+level(nodes.leftFarBottom)*6,
    talent:soulTalents.snapshot(core.type,core.grade,nodes),
    reductionFlat:level(nodes.rightTop)*5,
    coreHeal:level(nodes.rightFinal)*(12+quality)
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
    artifactBattle,artifactShield:artifactBattle.openingShield,artifactFirstHitUsed:false,artifactCheatDeathUsed:false,
    knowledgeScope:trustedKnowledgeScope(player)
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
// 固定三人基準試煉；隊伍人數、裝備與境界只改變玩家自身能力。
const RAID_BOSS_DIFFICULTY = Object.freeze({ maxHp:4800, baseAttack:70 });
// 清霜試煉的合作窗口：兩名不同隊員答對可削弱下一式，三名不同隊員再觸發一次合擊。
// 單人仍可硬打，但無法取得隊伍破陣減傷與三才合擊，符合「三人正常通關、單人需高養成」定位。
const RAID_TEAMWORK = Object.freeze({
  guardContributors: 2,
  guardDamageMultiplier: 0.55,
  burstContributors: 3,
  burstDamage: 240
});
function createRaidBoss(){
  return {id:'shen-qingshuang',hp:RAID_BOSS_DIFFICULTY.maxHp,
    maxHp:RAID_BOSS_DIFFICULTY.maxHp,baseAttack:RAID_BOSS_DIFFICULTY.baseAttack,phase:1};
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
  const soulShieldReady=soulTalents.strength(member?.nascentSoul?.talent)>0?streak%Math.max(3,Math.ceil(grade/3)+1)===0:previous>=Math.max(1,Math.ceil(grade/3));
  if(core.type==='ningxin'&&correct&&soulShieldReady)out.shield=true;
  if(core.type==='wugou'&&!correct&&!out.shield&&
      deterministicPercent(seed+':wugou')<chanceByGrade(grade,20,10,100))out.shield=true;
  if(core.type==='taichu'&&correct&&streak%Math.max(2,grade+1)===0)out.heal=100;
  if(core.type==='pojing'&&correct&&nearBreakthrough(member.totalScore,grade))out.bonusDamage=100;
  if(core.type==='xingchen'&&correct&&previous>=Math.max(1,grade))out.bonusDamage=80;
  if(core.type==='reverse'&&correct&&streak%Math.max(2,grade+1)===0)out.bonusDamage=120;
  return out;
}
function coreAttack(member,seed){
  const core=member?.goldenCore;if(!core)return 0;const grade=clampGrade(core.grade);
  if(core.type==='ocean'&&deterministicPercent(seed+':ocean')<chanceByGrade(grade,10,5,50))return 100;
  if(core.type==='sword'&&deterministicPercent(seed+':sword')<chanceByGrade(grade,10,5,50))return 200;
  return 0;
}
function coreCounter(member,received,seed){
  const core=member?.goldenCore;if(!core||core.type!=='thunder'||received<=0)return 0;
  const chance=chanceByGrade(core.grade,10,10,90);
  return deterministicPercent(seed+':thunder')<chance?Math.round(received*(member?.nascentSoul?.talent?.final || member?.nascentSoul?.talent?.top || member?.nascentSoul?.talent?.far ? .25 : 1)):0;
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
function resolvePlayerAction(member,{roomId,actionId,correct,bossHp=1,bossMaxHp=1}={}){
  const next={...member,artifactBattle:{...(member.artifactBattle||{}),effects:[...runtimeEffects(member)]}};
  const seed=String(roomId)+':player:'+String(actionId)+':'+String(next.uid),support=coreSupport(next,correct,seed+':support');
  next.coreCorrectStreak=support.streak;next.coreShield=support.shield;
  let healed=support.heal+(correct?Math.max(0,Math.round(finite(next?.nascentSoul?.coreHeal))):0);
  next.hp=Math.min(next.maxHp,next.hp+healed);
  let damage=0;
  if(correct){
    const base=Math.max(1,Math.round(finite(next.atk,200)))+support.bonusDamage+
      coreAttack(next,seed+':core-attack')+Math.max(0,Math.min(1000,Math.round(finite(next?.nascentSoul?.bonusDamage))));
    const artifact=resolveArtifactAttack(next,base,seed+':artifact');
    const talent=soulTalents.attack(next,{hp:bossHp,maxHp:bossMaxHp},{seed,streak:support.streak});
    damage=artifact.damage+talent.normal+talent.trueDamage+talent.followup;
    const soulHeal=soulTalents.healing(next,Math.min(Math.max(0,bossHp),damage),talent.leech);
    healed+=soulHeal;next.hp=Math.min(next.maxHp,next.hp+soulHeal);
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
    reflected=damage>0?defense.reflectDamage+coreCounter(next,damage,seed+':counter')+soulTalents.reflection(next,Math.min(next.hp,damage)):0;
    next.hp=Math.max(0,next.hp-damage);
  }
  return {member:next,damage,reflectedDamage:Math.max(0,Math.round(reflected)),guarded};
}

module.exports={
  EQUIP_SLOTS,RUNTIME_EFFECTS,stableHash,artifactPower,combatPower,trustedKnowledgeScope,pickTrustedRaidKnowledge,
  trustedRaidPlayerSnapshot,loadTrustedRaidPlayer,memberSnapshotFromTrusted,createRaidBoss,RAID_BOSS_DIFFICULTY,RAID_TEAMWORK,bossPhase,bossIntent,
  resolvePlayerAction,resolveBossDefense
};
