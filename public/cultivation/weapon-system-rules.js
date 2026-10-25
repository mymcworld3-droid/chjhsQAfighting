/* Fixed weapon identities and deterministic progression; inventory is server-owned. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAWeapons=api;})(globalThis,()=>{
  'use strict';
  const VERSION=2,ATTACK_PER_REALM=.025,FRAGMENTS_PER_CHEST=600;
  const REALMS=Object.freeze([
    ['煉氣',1],['築基',6],['金丹',28],['元嬰',68],['化神',188],['煉虛',428],['合體',788],['渡劫',1268],['半仙',1868],['真仙',1868]
  ].map(([name,need],index)=>Object.freeze({index,name,need,requiresImmortal:index===9})));
  const num=value=>Number.isFinite(Number(value))?Math.min(1000000000,Math.max(0,Math.floor(Number(value)))):0;
  const TYPES=Object.freeze([
    {id:'bow',name:'青竹弓',label:'弓',tag:'遠射',cost:2,range:5,metric:'square',rangeText:'方形五格',kind:'hit',power:.85,color:'#91bba1',description:'射擊周身方形五格內的一名敵人，包含斜向與相鄰格，造成 85% 攻擊傷害。'},
    {id:'spear',name:'雲紋槍',label:'槍',tag:'穿列',cost:2,range:4,rangeText:'前方四格',kind:'line',power:.9,color:'#b1c3cf',description:'選擇一個方向，穿刺前方直線四格，每名敵人受到 90% 攻擊傷害。'},
    {id:'sword',name:'青鋒劍',label:'劍',tag:'均衡',cost:2,range:3,depth:3,width:3,rangeText:'前方 3 × 3 格',kind:'cleave',power:1,color:'#dfd3a3',description:'選擇一個方向，斬擊前方三排、每排三格，共九格；每名敵人受到 100% 攻擊傷害。'},
    {id:'saber',name:'斷嶽刀',label:'刀',tag:'橫掃',cost:3,range:2,depth:2,width:5,rangeText:'前方兩排、寬五格',kind:'cleave',power:1.15,color:'#d2a18e',description:'選擇一個方向，橫掃前方兩排、每排五格，共十格；每名敵人受到 115% 攻擊傷害。'},
    {id:'hammer',name:'玄鐵錘',label:'錘',tag:'破盾',cost:3,range:1,metric:'square',rangeText:'周圍一圈八格',kind:'ring',power:1.5,shieldMultiplier:1.5,color:'#b8a9cb',description:'震擊周圍一圈八格，不包含自身；每名敵人受到 150% 攻擊傷害，對護盾的損耗提高 50%。'}
  ].map(Object.freeze));
  const get=id=>TYPES.find(t=>t.id===id)||null;
  function realmIndex(row){return Math.min(REALMS.length-1,Math.max(0,Number.isInteger(row?.realm)?row.realm:num(row?.level||1)-1));}
  const realmFor=row=>REALMS[realmIndex(row)];
  function initial(){return {version:VERSION,revision:0,equipped:'',starterClaimed:false,chests:0,trialRewardedStage:0,weapons:{},legacyConverted:false};}
  function normalize(raw){
    const s={...initial(),revision:num(raw?.revision),equipped:String(raw?.equipped||''),starterClaimed:raw?.starterClaimed===true,
      chests:num(raw?.chests),trialRewardedStage:num(raw?.trialRewardedStage),legacyConverted:raw?.legacyConverted===true};
    for(const t of TYPES){const row=raw?.weapons?.[t.id],copies=num(row?.copies);if(copies)s.weapons[t.id]={copies,realm:realmIndex(row)};}
    if(!get(s.equipped)||!Object.hasOwn(s.weapons,s.equipped))s.equipped='';return s;
  }
  const mergeCost=realm=>1+Math.floor(Math.min(REALMS.length-1,num(realm))/3);
  const goldCost=realm=>300*(Math.min(REALMS.length-1,num(realm))+1)**2;
  function promotion(row,score,immortal=false){const current=realmFor(row),next=REALMS[current.index+1]||null;return {current,next,copies:mergeCost(current.index),gold:goldCost(current.index),eligible:!!next&&num(score)>=next.need&&(!next.requiresImmortal||immortal===true)};}
  function snapshot(raw){const s=normalize(raw),row=s.weapons[s.equipped];return row?{version:VERSION,type:s.equipped,realm:row.realm}:null;}
  function attackMultiplier(weapon){return get(weapon?.type)?1+realmIndex(weapon)*ATTACK_PER_REALM:1;}
  function attackSkill(weapon){const t=get(weapon?.type);return t?{...t,id:'weapon-'+t.id,name:t.name+' · '+t.tag,cooldown:0,weapon:true}:null;}
  function add(s,type,count=1){if(!get(type))throw Object.assign(Error('兵器類型無效'),{status:400});s.weapons[type]||={realm:0,copies:0};s.weapons[type].copies=num(s.weapons[type].copies+count);if(!s.equipped)s.equipped=type;return s;}
  function grantTrial(raw,best){const s=normalize(raw),stage=num(best),from=s.trialRewardedStage;if(stage<=from)return {state:s,earned:0};
    const earned=stage-from+Math.floor(stage/5)-Math.floor(from/5);s.chests=num(s.chests+earned);s.trialRewardedStage=stage;s.revision++;return {state:s,earned};}
  return Object.freeze({VERSION,REALMS,ATTACK_PER_REALM,FRAGMENTS_PER_CHEST,TYPES,num,get,initial,normalize,realmIndex,realmFor,promotion,mergeCost,goldCost,snapshot,attackMultiplier,attackSkill,add,grantTrial});
});
