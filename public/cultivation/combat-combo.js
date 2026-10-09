// 傷害事件的連擊：追擊與反擊不參與；每個額外命中可再次判定。
(function(root){
  'use strict';
  const finite=v=>Number.isFinite(Number(v))?Number(v):0;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,finite(v)));
  function hash(seed){let h=2166136261;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return(h>>>0)/4294967296;}
  function stats(player,effects=[]) {
    const sum=type=>effects.filter(x=>x?.type===type).reduce((n,x)=>n+Math.max(0,finite(x.value)),0);
    // 法寶連擊率仍遵守原來 10% 的供給上限，元嬰丹性可額外提供機率。
    return {chance:clamp(clamp(sum('equip_combo_chance'),0,.10)+finite(player?.comboChance)+finite(player?.nascentSoul?.comboChance),0,.75),
      multiplier:clamp(.30+sum('equip_combo_damage_percent')+finite(player?.comboDamageBonus)+finite(player?.nascentSoul?.comboDamageBonus),0,4)};
  }
  function chain({damage,chance=0,multiplier=.30,seed='',kind='attack',remainingHp=0,roll,onHit}={}) {
    const hits=[];let hp=clamp(remainingHp,0,1e9);
    if(!['attack','combo'].includes(kind)||finite(damage)<=0||hp<=0)return hits;
    const p=clamp(chance,0,.75),raw=Math.max(0,Math.round(finite(damage)*clamp(multiplier,0,4)));
    if(!p||!raw)return hits;
    // hp 每段至少下降 1，有限生命與逐段獨立抽樣使鏈條可終止。
    for(let index=0;hp>0;index++) {
      if((roll?roll(index):hash(seed+':combo:'+index))>=p)break;
      const dealt=onHit?Math.max(0,Math.round(finite(onHit(raw,index)))):raw;
      if(!dealt)break;
      hits.push(dealt);hp=Math.max(0,hp-dealt);
    }
    return hits;
  }
  const api=Object.freeze({stats,chain,hash});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QACombatCombo=api;
})(globalThis);
