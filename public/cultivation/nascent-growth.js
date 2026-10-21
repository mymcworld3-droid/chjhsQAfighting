// 元嬰獨立分支與碎精：瀏覽器及伺服器共用，舊神識僅供一次性遷移。
(function (root) {
  'use strict';
  const talents = typeof module === 'object' && module.exports ? require('./soul-talents.js') : root.QASoulTalents;
  const access = typeof module === 'object' && module.exports ? require('./training-access-rules.js') : null;
  const accessScore = player => (access || root.QATrainingAccessRules)?.score(player) ?? count(player?.stats?.totalScore);
  const THRESHOLD = 68, CAP = 10, ITEM_ID = 'nascent-soul-essence';
  const ITEM = Object.freeze({id:ITEM_ID,name:'元嬰碎精',icon:'嬰',realm:'元嬰',category:'元嬰養成',
    description:'溫養元嬰各分支及化神本命神通的碎精。元嬰境界團本答對每題 +1、每日閉關全對 +3。不可交易或用於煉器。',nascentMaterial:true,buyGold:0,sellGold:0});
  const BRANCHES = Object.freeze([
    {id:'cultivation',name:'修為',icon:'fa-book-open',maxBonus:5,unit:'修為',description:'升滿後問道、鬥法及團本答對、閉關全對與洞天通關的元嬰修為加成為 +5。'},
    {id:'attack',name:'攻擊',icon:'fa-khanda',maxBonus:35,unit:'攻擊',description:'升滿後增加 35 攻擊。'},
    {id:'vitality',name:'生命',icon:'fa-heart',maxBonus:250,unit:'生命',description:'升滿後增加 250 生命上限。'},
    {id:'core',name:'金丹屬性',icon:'fa-circle-nodes',maxBonus:100,unit:'%',description:'逐級強化已調御金丹對應的元嬰丹性能力，升滿後達到完整效果。'}
  ].map(Object.freeze));
  const SPECIAL_BRANCHES = [{id:'coreChance',name:'金丹機率',icon:'fa-dice',maxBonus:7.5,unit:'%',description:'逐級增加爆擊或連擊機率，依金丹品級升滿增加 5–7.5%。'},
    {id:'coreDamage',name:'金丹傷害',icon:'fa-burst',maxBonus:50,unit:'%',description:'逐級增加爆擊或連擊傷害。爆擊升滿增加 25 個百分點，連擊升滿增加 15 個百分點。'}].map(Object.freeze);
  // 一般百分比為攻擊力係數；太初獨立顯示實際傷害吸血率，真傷使用固定傷害。
  const CORE_FACTORS = Object.freeze({ocean:2,pojing:3.8,xingchen:1.5,thunder:1,reverse:1.8});
  const CORE_ICONS = Object.freeze({ocean:'fa-water',taichu:'fa-heart-circle-plus',pojing:'fa-skull',
    xingchen:'fa-star',wugou:'fa-shield-halved',thunder:'fa-bolt',reverse:'fa-fire'});
  const roundBonus = value => Math.round(value * 10) / 10;
  function coreValue(core, level) {
    const rules = talents || root.QASoulTalents;
    const rank = Math.min(CAP,count(level));
    const talent = rules?.snapshot(core?.type,core?.grade,{leftTop:rank,leftFarBottom:rank,leftFinal:rank});
    if(talent) talent.powerScale=core?.type==='wugou'?1:.5;
    if(core?.type === 'taichu') return roundBonus((rules?.leechRate(talent) || 0)*100);
    if(core?.type === 'wugou') return rules?.trueDamage(talent) || 0;
    return roundBonus((rules?.strength(talent) || 0) * (CORE_FACTORS[core?.type] || 0) * 100);
  }
  function branches(core) {
    const base = BRANCHES.slice(0,3);
    if(['ningxin','sword'].includes(core?.type)) {
      const combo = core.type === 'sword';
      const quality = (9-Math.min(9,Math.max(1,count(core.grade)||9)))/8;
      return [...base,
        {...SPECIAL_BRANCHES[0],name:combo?'連擊率':'爆擊率',maxBonus:5+2.5*quality},
        {...SPECIAL_BRANCHES[1],name:combo?'連擊傷害':'爆擊傷害',maxBonus:combo?15:25}];
    }
    const rules = talents || root.QASoulTalents;
    return [...base,{...BRANCHES[3],name:rules?.TYPES[core?.type]?.trait || '丹性',
      icon:CORE_ICONS[core?.type] || BRANCHES[3].icon,maxBonus:coreValue(core,CAP),unit:core?.type==='wugou'?'':'%'}];
  }
  function branchValue(core, id, level) {
    if(id === 'core') return coreValue(core,level);
    const branch = branches(core).find(item=>item.id===id);
    return branch ? roundBonus(branch.maxBonus * Math.min(CAP,count(level)) / CAP) : 0;
  }
  const count = value => Number.isFinite(Number(value)) ? Math.max(0,Math.floor(Number(value))) : 0;
  function normalize(raw) {
    const branches={};
    for(const item of [...BRANCHES,...SPECIAL_BRANCHES]) branches[item.id]=Math.min(CAP,count(raw?.version===1 ? raw.branches?.[item.id] : 0));
    return {version:1,branches};
  }
  function prepare(player={}) {
    const inventory={...(player.materialSystem?.inventory||{})};
    const migrated=player.nascentSoulGrowth?.version===1;
    const converted=migrated?0:count(player.stats?.nascentSoulSpirit);
    inventory[ITEM_ID]=count(inventory[ITEM_ID])+converted;
    return {growth:normalize(player.nascentSoulGrowth),inventory,converted,fragments:inventory[ITEM_ID]};
  }
  function patch(state) {
    return {nascentSoulGrowth:state.growth,nascentSoulTree:{version:5,paths:{}},
      'stats.nascentSoulSpirit':0,'materialSystem.inventory':state.inventory};
  }
  function apply(player,state) {
    player.nascentSoulGrowth=state.growth;player.nascentSoulTree={version:5,paths:{}};
    player.stats||={};player.stats.nascentSoulSpirit=0;
    player.materialSystem||={};player.materialSystem.inventory={...state.inventory};
    return player;
  }
  function spent(raw) {
    return Object.values(normalize(raw).branches).reduce((sum,n)=>sum+n*(n+1)/2,0);
  }
  function status(player,id) {
    const state=prepare(player),branch=branches(player.cultivationTraining?.equippedCore).find(item=>item.id===id),level=state.growth.branches[id]||0,cost=level+1;
    const reason=!player.cultivationTraining?.equippedCore?.type?'請先調御金丹':!branch?'未知元嬰分支':accessScore(player)<THRESHOLD?'元嬰境界不足':level>=CAP?'已圓滿':state.fragments<cost?'元嬰碎精不足':'';
    return {...state,ok:!reason,reason,branch,level,cost:level>=CAP?0:cost};
  }
  function upgrade(player,id) {
    const result=status(player,id);
    if(!result.ok)return result;
    result.growth.branches[id]+=1;result.inventory[ITEM_ID]-=result.cost;result.fragments-=result.cost;
    return result;
  }
  function reset(player) {
    const state=prepare(player);const returned=spent(state.growth);
    state.growth=normalize(null);state.inventory[ITEM_ID]+=returned;state.fragments+=returned;
    return {...state,returned};
  }
  function bonuses(player,core) {
    if(accessScore(player)<THRESHOLD||player?.cultivationTraining?.coreEnabled===false||!core?.type)return null;
    const levels=normalize(player.nascentSoulGrowth).branches,n=levels.core;
    const talent=(talents || root.QASoulTalents)?.snapshot(core.type,core.grade,{leftTop:n,leftFarBottom:n,leftFinal:n})||null;
    if(talent){talent.comboMode=true;talent.powerScale=core?.type==='wugou'?1:.5;}
    const quality=(9-Math.min(9,Math.max(1,count(core.grade)||9)))/8;
    const chance=levels.coreChance/10*(.05+.025*quality);
    return {type:core.type,attackFlat:Math.round(levels.attack*3.5),maxHpFlat:levels.vitality*25,
      bonusDamage:0,reductionFlat:0,coreHeal:0,talent,
      comboChance:core.type==='sword'?chance:0,comboDamageBonus:core.type==='sword'?levels.coreDamage*.015:0,
      critChance:core.type==='ningxin'?chance:0,critDamageBonus:core.type==='ningxin'?levels.coreDamage*.025:0};
  }
  function cultivation(player,source) {
    if(!['solo','daily','cave','raid','battle'].includes(source)||!bonuses(player,player?.cultivationTraining?.equippedCore))return 0;
    return Math.round(normalize(player.nascentSoulGrowth).branches.cultivation/2);
  }
  function award(player,amount) {
    const state=prepare(player);state.inventory[ITEM_ID]+=count(amount);state.fragments+=count(amount);return state;
  }
  const api=Object.freeze({THRESHOLD,CAP,ITEM_ID,ITEM,BRANCHES,branches,branchValue,count,normalize,prepare,patch,apply,spent,status,upgrade,reset,bonuses,cultivation,award});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QANascentGrowth=api;
})(globalThis);
