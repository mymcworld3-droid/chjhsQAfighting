/* Fourth-stage sealing objective guidance.
 * Derive attackability from the SAME skill geometry and validation as combat;
 * never mutate battle state, estimate damage or submit actions.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalSealTargeting=api;
})(globalThis,()=>{
  'use strict';
  const noDirectHit=new Set(['meteor','restore','counter','fist-focus']);
  const key=p=>p.x+','+p.y;
  function active(state,rules){
    return state?.mode==='pve'&&state?.trial?.layoutVersion===4&&
      state?.objective?.type==='sealing'&&!!rules?.sealInfos;
  }
  function currentSkill(actor,mode,rules){
    if(!actor||!rules)return null;
    return mode?.startsWith('manual:')?
      rules.manualSkillFor(actor,mode.slice(7)):mode==='attack'?rules.basicFor(actor):null;
  }
  function allowedDirections(state,actor,skill,rules){
    const aims=rules.aimCells(state,actor,skill).slice();
    if(skill.kind==='ring'&&
      !aims.some(p=>key(p)===key(actor)))aims.push({x:actor.x,y:actor.y});
    return aims;
  }
  function reaches(state,actor,skill,target,rules){
    if(!skill||noDirectHit.has(skill.kind)||
      skill.kind==='blink'&&!skill.burst||
      skill.kind==='flying-sword'&&!actor.flyingSword)return null;
    // Geometry only, not a permission to cast. Each candidate is checked using
    // the actual skillCells/techniquePreview routine. Directional skills may
    // strike a seal while the tap targets a nearby direction cell.
    for(const aim of allowedDirections(state,actor,skill,rules)){
      let cells;
      try{cells=skill.kind==='fist-chain'?
        rules.techniquePreview(state,actor,skill,aim).cells:
        rules.skillCells(state,actor,skill,aim);}
      catch(_){continue;}
      if(!(cells||[]).some(p=>key(p)===key(target)))continue;
      // These checks are purely geometric. validateSkill also checks stamina
      // and attack limits, so they are reported separately below.
      return {x:aim.x,y:aim.y};
    }
    return null;
  }
  function unavailableReason(state,actor,skill,seal,rules){
    if(!skill)return '請先切換至普通攻擊或功法技能';
    if(noDirectHit.has(skill.kind)||skill.kind==='blink'&&!skill.burst)
      return '此技能不會直接命中陣眼，請切換攻擊招式';
    if(skill.kind==='flying-sword'&&!actor.flyingSword)
      return '請先召喚飛劍，之後才能用飛劍攻擊';
    if(rules.blocked(state,seal))return '陣眼所在位置不可指定';
    if(!rules.sight(state,actor,seal))return '石障擋住了視線，請換位置';
    return '此招式目前無法命中陣眼，請調整位置或攻擊方向';
  }
  function derive(state,uid,mode,rules){
    if(!active(state,rules))return {seals:[],skill:null};
    const actor=state.actors?.find(a=>a.uid===uid&&a.hp>0);
    const skill=currentSkill(actor,mode,rules);
    const yourTurn=!!actor&&state.status==='active'&&
      state.turnUid===uid&&(!state.quizRound||state.phase==='action');
    const sealInfos=rules.sealInfos(state);
    const seals=sealInfos.map(seal=>{
      if(seal.broken||!seal.active)return {...seal,status:'broken',hitAim:null,reason:'陣眼已破除'};
      if(!actor)return {...seal,status:'wait',hitAim:null,reason:'目前無法操控角色'};
      if(mode==='move')return {...seal,status:'choose-attack',hitAim:null,reason:'請先切換到攻擊模式'};
      const hitAim=reaches(state,actor,skill,seal,rules);
      if(!hitAim)return {...seal,status:'out-of-reach',hitAim:null,
        reason:unavailableReason(state,actor,skill,seal,rules)};
      if(!yourTurn)return {...seal,status:'wait',hitAim,reason:'等待你的行動回合'};
      if(actor.actions>=rules.LIMITS.actions)return {...seal,status:'action-limit',hitAim,reason:'本回合行動次數已滿'};
      if(actor.attacks>=rules.attackLimit(actor))return {...seal,status:'attack-limit',hitAim,reason:'本回合出手次數已滿'};
      if(actor.stamina<rules.techniqueCost(actor,skill))return {...seal,status:'stamina',hitAim,
        reason:'體力不足，需 '+rules.techniqueCost(actor,skill)+' 點體力'};
      try{rules.validateSkill(state,actor,skill,hitAim);}
      catch(e){return {...seal,status:'blocked',hitAim,reason:String(e?.message||'暫時無法攻擊')}};
      return {...seal,status:'ready',hitAim,reason:'可命中 · 需命中 '+seal.hp+' 次破除'};
    });
    return {seals,skill:skill?{name:skill.name,kind:skill.kind,cost:rules.techniqueCost(actor,skill)}:null};
  }
  function at(plan,pos){return plan?.seals?.find(s=>s.x===pos?.x&&s.y===pos?.y)||null;}
  function summary(seal,mode){
    if(!seal)return '';
    const base=seal.name+' · 耐久 '+seal.hp+'/'+seal.maxHp;
    if(seal.broken)return base+' · 已破除';
    return base+' · '+(mode==='move'?'可攻擊，請先切換攻擊模式':seal.reason);
  }
  return Object.freeze({active,currentSkill,reaches,derive,at,summary});
});
