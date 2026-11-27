'use strict';
// Offline policy, not a second combat engine. Every executed action/answer uses
// the production rules. Forecast utility is a bounded, public-information heuristic.
const R=require('../../public/cultivation/tactical-rules.js');
const NOW=2000000000000;
const Manuals=require('../../public/cultivation/manual-rules.js');
const Weave=require('../../public/cultivation/weave-weapon-rules.js'),Prism=require('../../public/cultivation/prism-weapon-rules.js'),Objects=require('../../public/cultivation/weapon-special-objects.js');
const prerequisites={'weave-thread':'weave-mark','weave-domain':'weave-mark','mirror-swap':'mirror-summon','time-double':'time-slash','time-union':'time-slash','gravity-crash':'gravity-core'};
// Compare the eighteen currently equipped manual techniques, not retired
// golden-core actions. The plain attack remains an explicit baseline.
const variants=Object.freeze([
  {id:'none.basic',core:'none',branch:'basic',coreName:'未裝備功法',branchName:'普通攻擊',
    skill:'普通攻擊',manualSkillId:null},
  ...Manuals.BOOKS.flatMap(book=>book.skills.map(skill=>({
    id:book.id+'.'+skill.id,core:book.id,branch:skill.id,coreName:book.name,
    branchName:skill.name,skill:skill.name,manualSkillId:skill.id
  })))
]);
const emptyHistory=s=>({...s,events:[],receipts:[],rewarded:[]});
const opponents=(s,a)=>s.actors.filter(b=>R.alive(b)&&b.team!==a.team);
const activeSeals=s=>s.trial?.layoutVersion===4&&s.objective?.type==='sealing'?(s.objective.points||[]).filter(p=>!p.activated):[];
const me=(s,uid)=>s.actors.find(a=>a.uid===uid);
const point=a=>({x:a.x,y:a.y});
function random(seed){return R.seeded(String(seed));}
function warnings(s,a){
  return [...opponents(s,a).filter(b=>b.bot).flatMap(b=>b.intent?.cells||[]),...s.effects.filter(e=>e.team!==a.team).flatMap(e=>e.cells)];
}
function incoming(s,a){
  let amount=0;
  for(const b of opponents(s,a)){
    if(b.bot){if(b.intent?.cells?.some(p=>R.key(p)===R.key(a)))amount+=b.atk*(b.intent.power||1);}
    else{
      const gap=R.dist(a,b),visible=R.sight(s,b,a);
      amount+=b.atk*2*(gap<=2&&visible?1:gap<=5?.65:.25);
    }
  }
  for(const e of s.effects)if(e.team!==a.team&&e.cells.some(p=>R.key(p)===R.key(a)))amount+=e.power;
  return amount;
}
function hazardDamage(s,a){
  return opponents(s,a).filter(b=>b.bot&&b.intent?.cells?.some(p=>R.key(p)===R.key(a))).reduce((n,b)=>n+b.atk*(b.intent.power||1),0)+
    s.effects.filter(e=>e.team!==a.team&&e.cells.some(p=>R.key(p)===R.key(a))).reduce((n,e)=>n+e.power,0);
}
function hpWeight(a){return 1+Math.max(0,.55-a.hp/a.maxHp)*1.5;}
function harm(source,target,sk){
  let power=sk.power;if(sk.execute&&target.hp/target.maxHp<=.4)power=2.2;
  if(sk.missing)power+=1.15*(1-source.hp/source.maxHp);
  let amount=Math.round(source.atk*power);
  if(!sk.pierce)amount=Math.round(amount*(1-(target.guard||0)));
  const absorbed=sk.pierce?0:Math.min(target.shield,amount),damage=Math.min(target.hp,amount-absorbed);
  return damage+.7*absorbed+(damage>=target.hp?source.atk*.75:0)+Math.min(source.maxHp-source.hp,Math.round(damage*(sk.leech||0)))*hpWeight(source);
}
function options(s,a,budget=a.stamina){
  const results=[],enemies=opponents(s,a),manualIds=a.manualSkills?.length?a.manualSkills:[null];
  if(a.attacks>=R.attackLimit(a)||a.actions>=R.LIMITS.actions)return results;
  for(const manualId of manualIds){
  const selected=manualId?R.manualSkillFor(a,manualId):R.BASIC;if(!selected)continue;
  const cost=R.techniqueCost(a,selected);
  const maxTargets=8;
  // Aim with the same geometry supplied to real players. Prioritize cells
  // near enemies while retaining all four cardinal directions for line attacks.
  const positions=selected.kind==='weave-thread'?Weave.plans(Prism.boardForTrial(s),a,selected,s.weaponObjects,a.uid).pairs.map(pair=>({...pair.second,first:pair.first})):selected.range===0?[point(a)]:R.aimCells(s,a,selected);
  const best=positions.map(p=>({p,proximity:Math.min(...[...enemies,...activeSeals(s)].map(b=>R.dist(b,p)))}))
    .sort((x,y)=>x.proximity-y.proximity||x.p.y-y.p.y||x.p.x-y.p.x)
    .slice(0,maxTargets);
  for(const {p} of best){
    if(cost>budget)break;
    const command=manualId?{type:'manual',skillId:manualId,x:p.x,y:p.y,...(p.first?{first:p.first}:{})}:
      {type:'attack',x:p.x,y:p.y};
    let next;
    try{next=R.apply(emptyHistory(s),a.uid,command,NOW);}
    catch(_){continue;} // No policy action may violate actual combat rules.
    const after=me(next,a.uid);
    let value=0;
    for(const b of enemies){
      const current=me(next,b.uid);if(!current)continue;
      const hpLoss=Math.max(0,b.hp-current.hp);
      const shieldLoss=Math.max(0,(b.shield||0)-(current.shield||0));
      const pushed=R.dist(b,current)>0;
      value+=hpLoss+shieldLoss*.6+(pushed?b.atk*.3:0);
      if(hpLoss&&current.hp===0)value+=a.atk*.8;
    }
    for(const seal of activeSeals(s)){const updated=next.objective?.points?.find(p=>R.key(p)===R.key(seal));if(updated)value+=Math.max(0,seal.hp-updated.hp)/R.SEAL_HIT_DAMAGE*a.atk*1.2;}
    value+=Math.max(0,after.hp-a.hp)*hpWeight(a);
    value+=Math.max(0,(after.shield||0)-(a.shield||0))*.65;
    if(selected.kind==='flying-sword'&&!a.flyingSword&&after.flyingSword)value+=a.atk*.9;
    if(selected.kind==='fist-focus'&&(Number(after.fistFocusUntil)||0)>(Number(a.fistFocusUntil)||0))value+=a.atk;
    const setup=Object.values(prerequisites).includes(manualId);
    if(setup){const prev=Objects.owned(s.weaponObjects,a.uid).length,afterCount=Objects.owned(next.weaponObjects,a.uid).length;if(afterCount>prev)value+=a.atk*.9;}
    if(value>1)results.push({command,value,cost,id:manualId||'attack'});
  }
  }
  const danger=incoming(s,a);
  if(a.attacks<R.attackLimit(a)&&(a.guard||0)<.4&&danger>0)
    results.push({command:{type:'guard'},value:danger*(.4-(a.guard||0))*hpWeight(a),cost:0,id:'guard'});
  return results.sort((x,y)=>y.value-x.value||x.cost-y.cost||x.id.localeCompare(y.id)||
    ((x.command.y||0)-(y.command.y||0))||((x.command.x||0)-(y.command.x||0)));
}
function potential(s,a,accuracy){
  const budget=a.stamina+(R.LIMITS.questions-a.questions)*(1+3*accuracy),choices=options(s,a,Math.min(10,budget));
  let score=0;
  for(const first of choices){
    let extra=0;
    if(a.attacks<1)for(const second of choices){
      if(first.cost+second.cost>budget||first.id===second.id&&first.id!=='attack')continue;
      // Repeated ordinary hits are legal; do not count the same nearly-dead
      // target as two full kills. Real follow-ups are evaluated after applying.
      extra=Math.max(extra,second.value*(first.id==='attack'&&second.id==='attack'?.8:.85));
    }
    score=Math.max(score,first.value+extra);
  }
  return score;
}
function approach(s,a){
  const seals=activeSeals(s),targets=seals.length?seals:opponents(s,a);return targets.length?Math.min(...targets.map(b=>R.dist(a,b))):0;
}
function moveChoice(s,a,accuracy,{escape=false,visited=new Set()}={}){
  const dangers=new Set(warnings(s,a).map(R.key)),base=potential(s,a,accuracy)-hazardDamage(s,a)*hpWeight(a)-approach(s,a)*a.atk*.06;
  let best=null,bestScore=base;
  // Sample nearby legal destinations rather than scoring every square by
  // replaying every attack. This bounds offline simulations on large maps.
  const destinations=R.moveCells(s,a).sort((x,y)=>
    (dangers.has(R.key(x))?1:0)-(dangers.has(R.key(y))?1:0)||
    approach({...s,actors:s.actors.map(b=>b.uid===a.uid?{...a,...x}:b)},{...a,...x})-
    approach({...s,actors:s.actors.map(b=>b.uid===a.uid?{...a,...y}:b)},{...a,...y})||
    x.cost-y.cost||x.y-y.y||x.x-y.x).slice(0,8);
  for(const p of destinations){
    if(visited.has(R.key(p))||escape&&dangers.has(R.key(p)))continue;
    const actor={...a,x:p.x,y:p.y,stamina:a.stamina-p.cost,slow:0},preview={...s,actors:s.actors.map(b=>b.uid===a.uid?actor:b)};
    const score=(escape?0:potential(preview,actor,accuracy))-hazardDamage(preview,actor)*hpWeight(actor)-approach(preview,actor)*a.atk*.06-p.cost*a.atk*.11;
    if(escape){
      const priority=-p.cost*100-approach(preview,actor);
      if(!best||priority>bestScore){best={type:'move',x:p.x,y:p.y};bestScore=priority;}
    }else if(score>bestScore+a.atk*.03){best={type:'move',x:p.x,y:p.y};bestScore=score;}
  }
  return best;
}
function choose(s,uid,accuracy,visited,moves){
  const a=me(s,uid),dangerous=warnings(s,a).some(p=>R.key(p)===R.key(a));
  const choices=options(s,a),hasHit=choices.some(c=>['attack','manual'].includes(c.command.type)&&c.value>a.atk*.2&&c.id!=='dragon-roar');
  // Move once to obtain an offensive angle; a later move is reserved for a
  // telegraphed escape. This prevents per-turn path oscillation.
  if(moves===0&&(!hasHit||dangerous)){
    const movement=moveChoice(s,a,accuracy,{visited});if(movement)return movement;
  }
  let best=null,bestScore=0;
  for(const option of choices.slice(0,5)){
    const next=R.apply(emptyHistory(s),uid,option.command,NOW),b=me(next,uid);
    const follow=next.status==='active'?potential(next,b,accuracy):a.atk*5;
    let score=option.value+follow*.8-Math.max(0,a.hp-b.hp)*hpWeight(a)-Math.max(0,a.shield-b.shield)*.7;
    if(next.status==='finished'&&next.winner!==a.team)score=-a.maxHp*10;
    if(dangerous&&warnings(next,b).some(p=>R.key(p)===R.key(b))&&b.stamina<1)score-=incoming(next,b)*hpWeight(b);
    if(score>bestScore){bestScore=score;best=option.command;}
  }
  if(best)return best;
  if(dangerous&&moves<2){const safe=moveChoice(s,a,accuracy,{escape:true,visited});if(safe)return safe;}
  if(moves===0){const movement=moveChoice(s,a,accuracy,{visited});if(movement)return movement;}
  return {type:'end'};
}
function playTurn(state,uid,{accuracy=.7,seed='0',audit=null,metrics=null}={}){
  let s=state,moves=0;const visited=new Set([R.key(me(s,uid))]);
  const answers=random(seed+':'+uid+':'+me(s,uid).turns),outcomes=[answers()<accuracy,answers()<accuracy];
  const execute=command=>{
    const before=s;s=R.apply(emptyHistory(s),uid,command,NOW);
    if(metrics)metrics[uid][command.type==='manual'?'skill':command.type]++;
    if(audit)audit({type:'action',uid,command,before,after:s});
    if(command.type==='move'){moves++;visited.add(R.key(me(s,uid)));}
  };
  for(let step=0;step<14&&s.status==='active'&&s.turnUid===uid;step++){
    const a=me(s,uid);
    if(a.questions<2&&a.stamina<=6){
      const before=s,correct=outcomes[a.questions];s=R.answer(emptyHistory(s),uid,correct,NOW);if(audit)audit({type:'answer',uid,correct,before,after:s});continue;
    }
    let command=a.actions>=R.LIMITS.actions?{type:'end'}:choose(s,uid,accuracy,visited,moves);
    if(command.type==='end'&&a.questions<2&&a.stamina<10){
      const before=s,correct=outcomes[a.questions];s=R.answer(emptyHistory(s),uid,correct,NOW);if(audit)audit({type:'answer',uid,correct,before,after:s});continue;
    }
    execute(command);if(command.type==='end')return s;
  }
  if(s.status==='active'&&s.turnUid===uid)execute({type:'end'});return s;
}
function fighter(v,uid,{atk=200,maxHp=1000}={}){return {
  uid,name:v.id,atk,maxHp,trainingAccessScore:68,
  manualSkills:v.manualSkillId?[v.manualSkillId,...(prerequisites[v.manualSkillId]?[prerequisites[v.manualSkillId]]:[])]:[]
};}
function duel(a,b,{map='courtyard',accuracy=.7,seed='0',stats={},audit=null}={}){
  let s=R.create({id:'offline-duel',mode:'pvp',simultaneous:false,map,players:[fighter(a,'seat0',stats),fighter(b,'seat1',stats)],now:NOW});
  const metrics=Object.fromEntries(['seat0','seat1'].map(uid=>[uid,{skill:0,attack:0,guard:0,move:0,end:0}]));
  while(s.status==='active')s=playTurn(s,s.turnUid,{accuracy,seed,audit,metrics});
  return {winner:s.winner,reason:s.finishReason,turns:s.turn,hp:s.actors.map(a=>a.hp),answers:s.actors.map(a=>a.answered),metrics};
}
function trial(v,{stage=1,accuracy=.7,seed='0',stats={},audit=null}={}){
  let s=R.create({id:'offline-trial',mode:'pve',players:[fighter(v,'seat0',stats)],trial:{seed,stage},now:NOW});
  const map=s.map;
  while(s.status==='active')s=playTurn(s,'seat0',{accuracy,seed,audit});
  return {winner:s.winner,reason:s.finishReason,turns:s.turn,hp:s.actors[0].hp,map,enemySpecies:s.actors.filter(a=>a.bot).map(a=>a.species)};
}
module.exports={R,NOW,variants,random,options,playTurn,duel,trial,fighter};
