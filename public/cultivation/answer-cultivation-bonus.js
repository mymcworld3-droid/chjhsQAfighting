// Account-wide answer cultivation bonuses; private integer hundredths, whole-point rewards.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAAnswerCultivationBonus=api;})(globalThis,()=>{
  'use strict';
  const COUNT=10,DURATION=3,PER_WEAPON=30;
  const int=(v,max)=>Number.isFinite(Number(v))?Math.max(0,Math.min(max,Math.floor(Number(v)))):0;
  function normalize(raw){
    const remaining=int(raw?.remaining,DURATION);
    return {version:1,carry:int(raw?.carry,99),progress:remaining?0:int(raw?.progress,COUNT-1),remaining};
  }
  function maxedWeapons(raw,manuals){
    if(!raw||!manuals?.normalize||!manuals?.levelForExp)return 0;
    return Object.values(manuals.normalize(raw).books).filter(b=>manuals.levelForExp(b.exp)>=20).length;
  }
  function award(raw,base,correct,weaponCount){
    const state=normalize(raw),count=int(weaponCount,100),original=int(base,1000000000);
    const active=correct&&state.remaining>0;
    let triggered=false,extra=0;
    if(correct){
      const units=state.carry+original*(count*PER_WEAPON+(active?100:0));
      extra=Math.floor(units/100);state.carry=units%100;
      if(active)state.remaining--;
      else if(++state.progress===COUNT){state.progress=0;state.remaining=DURATION;triggered=true;}
    }
    return {state,gain:correct?original+extra:0,extra,weaponPercent:count*PER_WEAPON,active,triggered};
  }
  function message(r){
    if(!r)return '';
    const parts=[];
    if(r.weaponPercent)parts.push('武器精通 +'+r.weaponPercent+'%');
    if(r.active)parts.push('頓悟 +100%'+(r.state.remaining?' · 剩餘 '+r.state.remaining+' 題':' · 頓悟結束'));
    else if(r.triggered)parts.push('頓悟開啟 · 接下來 3 題答對額外 +100% 修為');
    else parts.push('悟道值 '+r.state.progress+' / 10');
    if(r.extra)parts.push('額外修為 +'+r.extra);
    return parts.join('；');
  }
  return Object.freeze({COUNT,DURATION,PER_WEAPON,normalize,maxedWeapons,award,message});
});
