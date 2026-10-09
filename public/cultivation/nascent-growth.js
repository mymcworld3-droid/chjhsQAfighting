// 元嬰獨立分支與碎精：瀏覽器及伺服器共用，舊神識僅供一次性遷移。
(function (root) {
  'use strict';
  const talents = typeof module === 'object' && module.exports ? require('./soul-talents.js') : root.QASoulTalents;
  const THRESHOLD = 68, CAP = 10, ITEM_ID = 'nascent-soul-essence';
  const ITEM = Object.freeze({id:ITEM_ID,name:'元嬰碎精',icon:'嬰',realm:'元嬰',category:'元嬰養成',
    description:'溫養元嬰各分支的碎精。元嬰境界團本答對每題 +1、每日閉關全對 +3。不可交易或用於煉器。',nascentMaterial:true,buyGold:0,sellGold:0});
  const BRANCHES = Object.freeze([
    {id:'cultivation',name:'修為',icon:'fa-book-open',maxBonus:10,unit:'修為',description:'升滿後問道答對、閉關全對與洞天通關的元嬰修為加成為 +10。'},
    {id:'attack',name:'攻擊',icon:'fa-khanda',maxBonus:70,unit:'攻擊',description:'升滿後增加 70 攻擊。'},
    {id:'vitality',name:'生命',icon:'fa-heart',maxBonus:500,unit:'生命',description:'升滿後增加 500 生命上限。'},
    {id:'core',name:'金丹屬性',icon:'fa-circle-nodes',maxBonus:100,unit:'%',description:'逐級強化已調御金丹對應的元嬰丹性能力，升滿後達到完整效果。'}
  ].map(Object.freeze));
  const SPECIAL_BRANCHES = [{id:'coreChance',name:'金丹機率',icon:'fa-dice',maxBonus:15,unit:'%',description:'逐級增加爆擊或連擊機率，依金丹品級升滿增加 10–15%。'},
    {id:'coreDamage',name:'金丹傷害',icon:'fa-burst',maxBonus:100,unit:'%',description:'逐級增加爆擊或連擊傷害。爆擊升滿增加 50 個百分點，連擊升滿增加 30 個百分點。'}].map(Object.freeze);
  function branches(core) { return ['ningxin','sword'].includes(core?.type) ? [...BRANCHES.slice(0,3),...SPECIAL_BRANCHES] : BRANCHES; }
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
    const reason=!player.cultivationTraining?.equippedCore?.type?'請先調御金丹':!branch?'未知元嬰分支':count(player?.stats?.totalScore)<THRESHOLD?'元嬰境界不足':level>=CAP?'已圓滿':state.fragments<cost?'元嬰碎精不足':'';
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
    if(count(player?.stats?.totalScore)<THRESHOLD||player?.cultivationTraining?.coreEnabled===false||!core?.type)return null;
    const levels=normalize(player.nascentSoulGrowth).branches,n=levels.core;
    const talent=(talents || root.QASoulTalents)?.snapshot(core.type,core.grade,{leftTop:n,leftFarBottom:n,leftFinal:n})||null;
    if(talent)talent.comboMode=true;
    const quality=(9-Math.min(9,Math.max(1,count(core.grade)||9)))/8;
    const chance=levels.coreChance/10*(.10+.05*quality);
    return {type:core.type,attackFlat:levels.attack*7,maxHpFlat:levels.vitality*50,
      bonusDamage:0,reductionFlat:0,coreHeal:0,talent,
      comboChance:core.type==='sword'?chance:0,comboDamageBonus:core.type==='sword'?levels.coreDamage*.03:0,
      critChance:core.type==='ningxin'?chance:0,critDamageBonus:core.type==='ningxin'?levels.coreDamage*.05:0};
  }
  function cultivation(player,source) {
    if(!['solo','daily','cave','raid'].includes(source)||!bonuses(player,player?.cultivationTraining?.equippedCore))return 0;
    return normalize(player.nascentSoulGrowth).branches.cultivation;
  }
  function award(player,amount) {
    const state=prepare(player);state.inventory[ITEM_ID]+=count(amount);state.fragments+=count(amount);return state;
  }
  const api=Object.freeze({THRESHOLD,CAP,ITEM_ID,ITEM,BRANCHES,branches,count,normalize,prepare,patch,apply,spent,status,upgrade,reset,bonuses,cultivation,award});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QANascentGrowth=api;
})(globalThis);
