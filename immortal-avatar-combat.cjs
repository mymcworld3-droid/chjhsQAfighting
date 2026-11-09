'use strict';
// Execute the same trusted, pure combat modules used by duels. No client code or
// submitted statistics enter this context; snapshots come from saved player data.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Access=require('./public/cultivation/training-access-rules.js');
const Growth=require('./public/cultivation/nascent-growth.js');
const Innate=require('./public/cultivation/innate-ability.js');
const Pool=require('./public/cultivation/soulbound-pool.js');
const context=vm.createContext({console,QACombatCombo:require('./public/cultivation/combat-combo.js'),
  QASoulTalents:require('./public/cultivation/soul-talents.js'),QANascentGrowth:Growth,
  QAInnateAbility:Innate,QASoulboundPool:Pool});
context.window=context;
for(const file of ['artifact-catalog.js','artifact-battle-effects.js','battle-engine-v2.js']){
  const source=fs.readFileSync(path.join(__dirname,'public/cultivation',file),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/export (const|function) /g,'$1 ');
  vm.runInContext(source,context,{filename:file,timeout:2000});
}
const json=value=>JSON.parse(JSON.stringify(value));
const count=(value,fallback=0)=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value))):fallback;
const CORE_NAMES={ocean:'滄海丹',taichu:'太初丹',ningxin:'凝心丹',thunder:'雷霆丹',wugou:'無垢丹',reverse:'陰陽反轉丹',sword:'九天劍氣丹'};
function catalog(config={}){
  const remote=Array.isArray(config.items)?config.items:[];
  const defaults=remote.length&&Number(config.artifactCatalogSchemaVersion)>=2?[]:context.getDefaultArtifactCatalog();
  return new Map([...defaults,...remote,...Pool.ITEMS].map(raw=>{
    const item=context.normalizeArtifactDefinition(raw);return [item.id,item];
  }));
}
function snapshot(uid,user,config={}){
  const saved=user.cultivationTraining||{},raw=saved.equippedCore;
  const core=saved.coreEnabled!==false&&raw&&CORE_NAMES[raw.type]?
    {type:raw.type,grade:Math.min(9,Math.max(1,count(raw.grade,9))),name:CORE_NAMES[raw.type]}:null;
  const soul=Growth.bonuses(user,core),items=catalog(config),effects=[],equipment=[];
  let attackFlat=0,hpFlat=0,attackMultiplier=1,hpMultiplier=1;
  for(const [slot,id] of Object.entries(user.artifactSystem?.equipped||{})){
    const item=items.get(id);
    if(!item||item.equipSlot!==slot||!['本命法寶','護身法寶','佩飾法寶','輔助法寶'].includes(slot)||count(user.artifactSystem?.inventory?.[id])<1)continue;
    equipment.push(item.name);
    (item.effects||[]).forEach((effect,effectIndex)=>{
      const value=Number(effect.value)||0;
      if(effect.type==='equip_attack_flat')attackFlat+=value;
      if(effect.type==='equip_hp_flat')hpFlat+=value;
      if(effect.type==='equip_attack_percent')attackMultiplier*=1+Math.max(-.95,value);
      if(effect.type==='equip_hp_percent')hpMultiplier*=1+Math.max(-.95,value);
      if(effect.type.startsWith('equip_'))effects.push({type:effect.type,value,artifactId:id,
        artifactName:item.name,soulbound:slot==='本命法寶',effectIndex});
    });
  }
  const baseAtk=count(user.stats?.attack,200),baseMaxHp=Math.max(1,count(user.stats?.maxHp,1000));
  const atk=Math.max(1,Math.round((baseAtk+Math.min(2000,soul?.attackFlat||0)+attackFlat)*attackMultiplier));
  const maxHp=Math.max(1,Math.round((baseMaxHp+Math.min(10000,soul?.maxHpFlat||0)+hpFlat)*hpMultiplier));
  const shield=effects.filter(e=>e.type==='equip_shield_flat').reduce((n,e)=>n+e.value,0);
  return json({uid,name:String(user.displayName||user.name||'無名仙客').slice(0,60),
    totalScore:count(user.stats?.totalScore),trainingAccessScore:Access.score(user),
    baseAtk,baseMaxHp,atk,hp:maxHp,maxHp,goldenCore:core,nascentSoul:soul||null,
    innateAbility:Innate.snapshot(user),innateAbilityState:null,coreShield:false,
    coreCorrectStreak:0,soulStarCorrectWindow:0,artifactBattle:{version:1,effects,openingShield:shield},
    artifactShield:shield,artifactFirstHitUsed:false,artifactCheatDeathUsed:false,equipment,
    power:Math.round(atk*5+maxHp+shield)});
}
const STYLES=Object.freeze({assault:'強攻',sustain:'續戰',counter:'反擊'});
function intent(style,round){
  const cycles={assault:['strike','strike','burst'],sustain:['guard','recover','strike'],counter:['guard','burst','strike']};
  const kind=(cycles[style]||cycles.assault)[(round-1)%3];
  return {kind,name:{strike:'進攻',burst:'重擊',guard:'守勢反擊',recover:'調息回復'}[kind],
    hint:{strike:'化身將正常出手',burst:'化身將先手重擊，守勢可減傷',guard:'化身將減少受到的傷害，適合蓄力',recover:'化身將回復生命，適合強攻'}[kind]};
}
function settle(state,correct,tactic){
  const round=state.round+1,move=intent(state.style,round);
  const host=json(state.challenger),guest=json(state.defender),notes=[];
  let charge=count(state.charge),factor=1;
  if(correct){
    if(tactic==='charge'){
      charge=Math.min(2,charge+1);factor=.35;
      notes.push('凝聚靈力：本回合造成 35% 攻擊，下次強攻每層提升 65%（最多兩層）。');
    }else if(tactic==='guard'){factor=.7;notes.push('守勢：攻擊為 70%，本回合化身攻擊降為 45%。');}
    else {factor=1.2+charge*.65;charge=0;notes.push('強攻：釋放攻擊與累積靈力。');}
  }else notes.push('答錯失去本次出手機會，化身仍會行動。');
  host.atk=Math.max(1,Math.round(host.atk*factor));
  guest.atk=Math.round(guest.atk*(move.kind==='burst'?1.55:move.kind==='guard'?.65:move.kind==='recover'?.5:1));
  if(tactic==='guard'&&correct)guest.atk=Math.max(1,Math.round(guest.atk*.45));
  if(move.kind==='guard')host.atk=Math.max(1,Math.round(host.atk*.55));
  if(move.kind==='recover'){
    const heal=Math.min(guest.maxHp-guest.hp,Math.round(guest.maxHp*.07));guest.hp+=heal;
    if(heal)notes.push('化身調息回復 '+heal+' 生命。');
  }
  const guestFirst=move.kind==='burst';
  host.answer={correct,atMs:guestFirst?2:1};guest.answer={correct:true,atMs:guestFirst?1:2};
  const result=context.settleBattleRound({roomId:state.runId,round,host,guest,maxRounds:24,
    resolveEquipmentHit:context.resolveArtifactBattleHit,
    resolveGuardedFollowup:context.resolveArtifactGuardedFollowup,
    resolveGuardAbsorption:context.resolveArtifactGuardAbsorption,
    resolveTalentDefense:context.resolveArtifactBattleDefense});
  function apply(player,prefix){
    return {...player,hp:result[prefix+'Hp'],coreShield:result[prefix+'CoreShield'],
      coreCorrectStreak:result[prefix+'CoreStreak'],soulStarCorrectWindow:result[prefix+'StarCorrectWindow'],
      innateAbilityState:result[prefix+'InnateAbilityState'],...result[prefix+'ArtifactState']};
  }
  const challenger=apply(state.challenger,'host'),defender=apply(state.defender,'guest');
  const won=defender.hp<=0&&challenger.hp>0;
  const finished=won||challenger.hp<=0||round>=24;
  return json({round,charge,challenger,defender,won,finished,
    reason:won?'defeated':challenger.hp<=0?'fallen':round>=24?'limit':'',
    notes,logs:result.logs,activations:result.activations});
}
// Tower initiative is fixed: the player's answer gates the first strike;
// a surviving guard always takes the second turn, without tactical modifiers.
function trialPair(build,defender){
  return json(context.applyNascentSoulDuelRule(json(build),json(defender)));
}
function settleTrial(state,correct){
  const round=state.round+1,host=json(state.challenger),guest=json(state.defender);
  host.answer={correct,atMs:1};guest.answer={correct:true,atMs:1000};
  const result=context.settleBattleRound({roomId:state.runId,round,host,guest,maxRounds:24,
    resolveEquipmentHit:context.resolveArtifactBattleHit,resolveGuardedFollowup:context.resolveArtifactGuardedFollowup,
    resolveGuardAbsorption:context.resolveArtifactGuardAbsorption,resolveTalentDefense:context.resolveArtifactBattleDefense});
  const apply=(player,prefix)=>({...player,hp:result[prefix+'Hp'],coreShield:result[prefix+'CoreShield'],
    coreCorrectStreak:result[prefix+'CoreStreak'],soulStarCorrectWindow:result[prefix+'StarCorrectWindow'],
    innateAbilityState:result[prefix+'InnateAbilityState'],...result[prefix+'ArtifactState']});
  const challenger=apply(host,'host'),defender=apply(guest,'guest');
  delete challenger.answer;delete defender.answer;
  const won=defender.hp<=0&&challenger.hp>0;
  return json({round,challenger,defender,won,finished:won||challenger.hp<=0||round>=24,
    notes:[correct?'答對，率先出手；守衛存活時固定後手攻擊。':'答錯，本回合無法出手；守衛仍會攻擊。'],
    logs:result.logs,steps:result.steps,activations:result.activations,
    startHostHp:result.startHostHp,startGuestHp:result.startGuestHp});
}
module.exports={snapshot,catalog,intent,settle,trialPair,settleTrial,STYLES};
