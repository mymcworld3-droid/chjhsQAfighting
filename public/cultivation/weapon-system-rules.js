/* Fixed weapon identities and deterministic progression; inventory is server-owned. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeapons=api;})(globalThis,()=>{
  'use strict';
  const VERSION=1,MAX_LEVEL=10,ATTACK_PER_LEVEL=.025,FRAGMENTS_PER_CHEST=600;
  const num=value=>Number.isFinite(Number(value))?Math.min(1000000000,Math.max(0,Math.floor(Number(value)))):0;
  const TYPES=Object.freeze([
    {id:'bow',name:'青竹弓',label:'弓',tag:'遠射',cost:2,range:4,minRange:2,kind:'hit',power:.85,color:'#91bba1',description:'射擊二至四格內的一名敵人，造成 85% 攻擊傷害；相鄰敵人無法射擊。'},
    {id:'spear',name:'雲紋槍',label:'槍',tag:'穿列',cost:2,range:3,kind:'line',power:.9,color:'#b1c3cf',description:'選擇一個方向，穿刺直線三格，每名敵人受到 90% 攻擊傷害。'},
    {id:'sword',name:'青鋒劍',label:'劍',tag:'均衡',cost:2,range:2,kind:'line',power:1,color:'#dfd3a3',description:'選擇一個方向，斬擊直線兩格，每名敵人受到 100% 攻擊傷害。'},
    {id:'saber',name:'斷嶽刀',label:'刀',tag:'橫掃',cost:3,range:1,kind:'cleave',power:1.15,color:'#d2a18e',description:'選擇一個方向，橫掃前方三格，每名敵人受到 115% 攻擊傷害。'},
    {id:'hammer',name:'玄鐵錘',label:'錘',tag:'破盾',cost:3,range:1,kind:'hit',power:1.5,shieldMultiplier:1.5,color:'#b8a9cb',description:'重擊相鄰一名敵人，造成 150% 攻擊傷害；對護盾的損耗提高 50%。'}
  ].map(Object.freeze));
  const get=id=>TYPES.find(t=>t.id===id)||null;
  function initial(){return {version:VERSION,revision:0,equipped:'',starterClaimed:false,chests:0,trialRewardedStage:0,weapons:{},legacyConverted:false};}
  function normalize(raw){
    const s={...initial(),revision:num(raw?.revision),equipped:String(raw?.equipped||''),starterClaimed:raw?.starterClaimed===true,
      chests:num(raw?.chests),trialRewardedStage:num(raw?.trialRewardedStage),legacyConverted:raw?.legacyConverted===true};
    for(const t of TYPES){const row=raw?.weapons?.[t.id],copies=num(row?.copies);if(copies)s.weapons[t.id]={copies,level:Math.min(MAX_LEVEL,Math.max(1,num(row.level)))};}
    if(!get(s.equipped)||!Object.hasOwn(s.weapons,s.equipped))s.equipped='';return s;
  }
  const mergeCost=level=>1+Math.floor((Math.max(1,num(level))-1)/3);
  const goldCost=level=>300*Math.max(1,num(level))**2;
  function snapshot(raw){const s=normalize(raw),row=s.weapons[s.equipped];return row?{version:VERSION,type:s.equipped,level:row.level}:null;}
  function attackMultiplier(weapon){return get(weapon?.type)?1+(Math.min(MAX_LEVEL,Math.max(1,num(weapon.level)))-1)*ATTACK_PER_LEVEL:1;}
  function attackSkill(weapon){const t=get(weapon?.type);return t?{...t,id:'weapon-'+t.id,name:t.name+' · '+t.tag,cooldown:0,weapon:true}:null;}
  function add(s,type,count=1){if(!get(type))throw Object.assign(Error('兵器類型無效'),{status:400});s.weapons[type]||={level:1,copies:0};s.weapons[type].copies=num(s.weapons[type].copies+count);if(!s.equipped)s.equipped=type;return s;}
  function grantTrial(raw,best){const s=normalize(raw),stage=num(best),from=s.trialRewardedStage;if(stage<=from)return {state:s,earned:0};
    const earned=stage-from+Math.floor(stage/5)-Math.floor(from/5);s.chests=num(s.chests+earned);s.trialRewardedStage=stage;s.revision++;return {state:s,earned};}
  return Object.freeze({VERSION,MAX_LEVEL,ATTACK_PER_LEVEL,FRAGMENTS_PER_CHEST,TYPES,num,get,initial,normalize,mergeCost,goldCost,snapshot,attackMultiplier,attackSkill,add,grantTrial});
});
