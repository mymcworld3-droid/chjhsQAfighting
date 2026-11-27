/* Display-only tactical strength estimate. Never changes combat damage or matching. */
(function(root,factory){
  const Catalog=typeof module==='object'&&module.exports
    ?require('./manual-rules.js'):root.QAManuals;
  const api=factory(Catalog);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalPower=api;
})(globalThis,(Catalog)=>{
  'use strict';
  const MAX_ATTACK=1000000,MAX_HP=10000000;
  const finite=(v,fallback=0)=>{
    const n=Number(v);return Number.isFinite(n)?n:fallback;
  };
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const safe=(v,fallback,max)=>clamp(finite(v,fallback),0,max);
  // Static, bounded utility coefficients. These reflect optional positioning
  // and control, not fictitious extra damage or guaranteed multi-target hits.
  const UTILITIES=Object.freeze({
    'dash-cleave':.12,'sword-array':.14,'flying-sword':.10,
    'fist-sweep':.10,'fist-chain':.15,'fist-throw':.22,
    'prism-reflect':.06,'prism-scatter':.10,'bell-shock':.12,'bell-echo':.18,
    'weave-thread':.08,'weave-domain':.13,'mirror-swap':.18,'time-union':.07,'gravity-core':.20,'gravity-crash':.12
  });
  const WEIGHTS=Object.freeze([1,.4,.2]);
  function estimateMove(attack,skill){
    let cost=clamp(finite(skill.cost,2),2,10);
    let total=skill.kind==='fist-chain'?finite(skill.power)*Math.min(3,finite(skill.steps,4)):
      skill.kind==='sword-array'?finite(skill.centerPower,skill.power):finite(skill.power);
    // Conservative expected single-target utility, not maximum tooltip
    // damage. Include setup cost for attacks dependent on special objects.
    switch(skill.kind){
      case 'prism-reflect':total=skill.powers.initial+.5*skill.powers.reflected;break;
      case 'prism-scatter':total=Math.min(skill.maxTargetPower,skill.powers.initial+.5*skill.powers.first+.25*skill.powers.second);break;
      case 'bell-echo':total=skill.power*2;break;
      case 'weave-thread':cost+=1;break;
      case 'weave-domain':total=skill.powers.two;cost+=2;break;
      case 'mirror-strike':total=skill.power*1.15;break;
      case 'mirror-swap':total=skill.power*1.5;cost+=1;break;
      case 'time-double':total=skill.power*1.5;cost+=1;break;
      case 'time-union':total=skill.power*2;cost+=4;break;
      case 'gravity-core':total=skill.power*3;break;
      case 'gravity-crash':total=skill.powers.middle;cost+=4;break;
    }
    const damage=clamp(total,0,6)*2/cost;
    const reach=clamp(skill.unlimited?4:finite(skill.range),0,4)*.025;
    const utility=(UTILITIES[skill.kind]||0)
      +(skill.tShape?.04:0)+(skill.pushToEdge?.12:0)
      +(Number(skill.push)>0?.08:0);
    // Focus consumes the current turn to improve the following two; score
    // the option, not three immediate attacks or an imaginary damage spike.
    const focus=skill.kind==='fist-focus'?.45+.05*(7-cost):0;
    return Math.round(attack*clamp(damage+reach+utility+focus,0,6));
  }
  function calculate({stats={},manualState=null,realmScore=0}={}){
    const attack=clamp(finite(stats.attack,200),1,MAX_ATTACK);
    const maxHp=clamp(finite(stats.maxHp,1000),1,MAX_HP);
    const base=Math.round(attack*2+maxHp*.2);
    const complete=manualState!==null&&manualState!==undefined;
    const normalized=Catalog.normalize(complete?manualState:{});
    const selected=[],moves=new Set();
    for(const id of normalized.equipped){
      const skill=Catalog.BY_SKILL[id],book=skill&&normalized.books[skill.manualId];
      if(!skill||!book||moves.has(skill.moveId)
        ||Catalog.levelForExp(book.exp)<skill.levelRequired)continue;
      moves.add(skill.moveId);
      const modified=Catalog.skillAtLevel(skill,normalized.skillLevels[id],Catalog.refinementFor(book));
      selected.push({id:skill.id,moveId:skill.moveId,name:skill.name,
        bookId:skill.manualId,level:modified.level,cost:modified.cost,
        raw:estimateMove(attack,modified)});
    }
    selected.sort((a,b)=>b.raw-a.raw||a.id.localeCompare(b.id));
    const items=selected.slice(0,3).map((item,index)=>{
      const weight=WEIGHTS[index];
      return {...item,weight,power:Math.round(item.raw*weight)};
    });
    const skills=items.reduce((sum,item)=>sum+item.power,0);
    return {mode:'tactical',complete,total:base+skills,base,skills,
      attack,maxHp,items,core:0,equipment:0};
  }
  return Object.freeze({calculate,estimateMove,WEIGHTS});
});
