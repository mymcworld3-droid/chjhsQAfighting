// Shared browser / Node rules. Talents use one bounded budget and never amplify artifact procs.
(function (root) {
  'use strict';
  const TYPES = Object.freeze({
    ocean:{name:'滄潮',trait:'蓄潮爆發',desc:'敵方生命至少 70% 時，額外普通傷害為能力倍率的 2 倍；其餘為 0.6 倍。'},
    taichu:{name:'還神',trait:'吸血',desc:'答對且造成傷害後吸血，上限為 1.2 × 能力倍率 × 攻擊力，且不超過實際傷害與生命上限的 15%。'},
    ningxin:{name:'凝鋒',trait:'會心',desc:'答對時有 25% 機率追加 3 倍能力倍率的普通傷害；不再觸發法寶暴擊。修習後道心改為每連答至少 3 題凝聚一次。'},
    pojing:{name:'破境',trait:'斬殺',desc:'敵方生命不高於 50% 時，額外普通傷害為能力倍率的 3.8 倍；其餘為 0.4 倍。'},
    xingchen:{name:'星隕',trait:'連答蓄力',desc:'每連續答對 3 題追加 4 倍能力倍率的普通傷害，答錯會中斷蓄力。'},
    wugou:{name:'清光',trait:'真傷',desc:'答對追加固定真傷，穿過道心護體與普通減傷；法寶護盾與保命仍有效。金丹屬性分支升滿提供 60–72 真傷，依金丹品級提高。'},
    thunder:{name:'雷返',trait:'反傷',desc:'受到直接傷害後反傷，按能力倍率計算，最多能力倍率 × 攻擊力；反傷不再觸發反傷。修習後金丹雷劫反擊為實際受傷的 25%。'},
    reverse:{name:'逆命',trait:'低血增傷',desc:'自身生命不高於 50% 時，額外普通傷害為能力倍率的 1.8 倍；其餘為 0.25 倍。'},
    sword:{name:'追魂',trait:'連擊',desc:'答對追加一次 1.4 × 能力倍率 × 攻擊力的普通追擊；首擊被道心擋下仍可追擊，追擊不觸發法寶攻擊效果。'}
  });
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
  function snapshot(type,grade,nodes={}) {
    if(!TYPES[type])return null;
    return {version:1,type,grade:clamp(Math.floor(Number(grade)||9),1,9),
      top:clamp(nodes.leftTop,0,10),far:clamp(nodes.leftFarBottom,0,10),final:clamp(nodes.leftFinal,0,10)};
  }
  function strength(t) {
    if(t?.version!==1||!TYPES[t.type])return 0;
    const quality=(9-clamp(t.grade,1,9))/8;
    return (0.28+0.04*quality)*(0.3*clamp(t.top,0,10)+0.2*clamp(t.far,0,10)+0.5*clamp(t.final,0,10))/10;
  }
  function hash(seed){let n=2166136261;for(const ch of String(seed)){n^=ch.charCodeAt(0);n=Math.imul(n,16777619);}return(n>>>0)/4294967296;}
  function power(p){return clamp(p?.atk,0,600);}
  function attack(player,target,{seed='',streak=0}={}) {
    const t=player?.nascentSoul?.talent,s=strength(t),p=power(player),budget=s*p;
    const out={normal:0,trueDamage:0,followup:0,leech:0,name:TYPES[t?.type]?.name||''};
    if(!budget)return out;
    const own=clamp(player.hp/Math.max(1,player.maxHp),0,1),enemy=clamp(target?.hp/Math.max(1,target?.maxHp),0,1);
    if(t.type==='ocean')out.normal=budget*(enemy>=.7?2:.6);
    if(t.type==='taichu')out.leech=budget*1.2;
    if(t.type==='ningxin'&&!t.comboMode&&hash(seed+':soul-critical')<.25)out.normal=budget*3;
    if(t.type==='pojing')out.normal=budget*(enemy<=.5?3.8:.4);
    if(t.type==='xingchen'&&streak>0&&streak%3===0)out.normal=budget*4;
    if(t.type==='wugou')out.trueDamage=trueDamage(t);
    if(t.type==='reverse')out.normal=budget*(own<=.5?1.8:.25);
    if(t.type==='sword'&&!t.comboMode)out.followup=budget*1.4;
    for(const key of ['normal','trueDamage','followup','leech'])out[key]=Math.round(out[key]);
    return out;
  }
  function reflection(player,received) {
    const t=player?.nascentSoul?.talent;
    return t?.type==='thunder'?Math.round(Math.min(Math.max(0,received)*strength(t),power(player)*strength(t))):0;
  }
  function trueDamage(t) {
    if(t?.version!==1||t.type!=='wugou')return 0;
    // Balance through node supply (2/1/3 per rank), no clamp on settled true damage.
    return Math.round((2*clamp(t.top,0,10)+clamp(t.far,0,10)+3*clamp(t.final,0,10))*
      (1+.2*(9-clamp(t.grade,1,9))/8));
  }
  function healing(player,dealt,limit) {return Math.round(Math.min(Math.max(0,dealt),Math.max(0,limit),Math.max(1,Number(player.maxHp)||1)*.15));}
  const api=Object.freeze({TYPES,snapshot,strength,attack,reflection,healing,power,trueDamage});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QASoulTalents=api;
})(globalThis);
