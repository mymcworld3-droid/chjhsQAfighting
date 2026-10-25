'use strict';
// Offline policy, not a second combat engine. Every executed action/answer uses
// the production rules. Forecast utility is a bounded, public-information heuristic.
const R=require('../../public/cultivation/tactical-rules.js');
const NOW=2000000000000;
const variants=Object.entries(R.CORES).flatMap(([core,c])=>c.branches.map(b=>({id:core+'.'+b.id,core,branch:b.id,coreName:c.name,branchName:b.name,skill:b.skill.name})));
const emptyHistory=s=>({...s,events:[],receipts:[],rewarded:[]});
const opponents=(s,a)=>s.actors.filter(b=>R.alive(b)&&b.team!==a.team);
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
  const result=[],enemies=opponents(s,a),sk=R.branchFor(a).skill,slots=R.LIMITS.attacks-a.attacks;
  if(!slots)return result;
  const danger=incoming(s,a),weight=hpWeight(a);
  const add=(type,skill,p)=>{
    if(skill.cost>budget||(a.cooldowns[skill.id]||0)>a.turns||!R.inside(s,p)||R.blocked(s,p)||R.dist(a,p)>skill.range)return;
    if(skill.range>0&&!R.sight(s,a,p))return;
    let value=0;
    if(skill.kind==='restore'){
      value=Math.min(a.maxHp-a.hp,Math.round(a.maxHp*skill.power))*weight+
        Math.max(0,Math.round(a.maxHp*(skill.shield||0))-a.shield)*.68+(skill.cleanse&&a.slow?a.atk*.2:0);
    }else if(skill.kind==='counter')value=danger*Math.max(0,.4-(a.guard||0))*weight+(a.counter?0:.8*a.atk*Math.min(1,danger/(a.atk*2)));
    else if(skill.kind==='blink'){
      if(R.at(s,p))return;
      const affected=skill.burst?enemies.filter(b=>R.dist(b,p)<=1):[];
      value=affected.reduce((sum,b)=>sum+harm(a,b,{...skill,power:skill.burst}),0)+Math.max(0,Math.round(a.maxHp*(skill.shield||0))-a.shield)*.68;
      if(warnings(s,a).some(c=>R.key(c)===R.key(a))&&!warnings(s,a).some(c=>R.key(c)===R.key(p)))value+=danger*.7;
    }else{
      if(['hit','lunge','swap'].includes(skill.kind)&&!enemies.some(b=>R.key(b)===R.key(p)))return;
      if(skill.kind==='lunge'&&!R.neighbours(s,p).some(n=>{const route=R.path(s,a,n,a.uid);return route&&route.length-1<=skill.range;}))return;
      const cells=R.skillCells(s,a,skill,p);
      if(skill.kind==='meteor'){
        for(const b of enemies){
          const destination=b.bot&&b.intent?.kind==='advance'?R.monsterRoute(s,b,a).at(-1):b;
          if(cells.some(c=>R.key(c)===R.key(destination)))value+=harm(a,b,skill)*(b.bot?1:.3);
        }
        // A visible mark can force an opponent to spend a movement point, even
        // when a rational opponent leaves the footprint before impact.
        if(s.mode==='pvp'&&enemies.some(b=>cells.some(c=>R.key(c)===R.key(b))))value+=a.atk*.2;
      }else{
        const targets=skill.kind==='swap'?enemies.filter(b=>R.key(b)===R.key(p)):enemies.filter(b=>cells.some(c=>R.key(c)===R.key(b)));
        value=targets.reduce((sum,b)=>sum+harm(a,b,skill)+(skill.slow&&!b.slow?a.atk*.1:0),0);
        if(skill.push||skill.kind==='swap')for(const b of targets){
          if(b.bot&&b.intent?.cells?.some(c=>R.key(c)===R.key(a)))value+=b.atk*.5;
        }
      }
    }
    // No intentional empty hits or redundant heal/shield refreshes.
    if(value>1)result.push({command:{type,x:p.x,y:p.y},value,cost:skill.cost,id:skill.id});
  };
  for(const [x,y]of [[1,0],[-1,0],[0,1],[0,-1]])add('attack',R.BASIC,{x:a.x+x,y:a.y+y});
  if(sk.range===0)add('skill',sk,point(a));
  else if(['hit','lunge','swap'].includes(sk.kind))for(const b of enemies)add('skill',sk,point(b));
  else if(sk.kind==='line')for(const [x,y]of [[1,0],[-1,0],[0,1],[0,-1]])add('skill',sk,{x:a.x+x,y:a.y+y});
  else{
    const positions=R.aimCells(s,a,sk);
    for(const p of positions)add('skill',sk,p);
  }
  if((a.guard||0)<.4&&danger>0)result.push({command:{type:'guard'},value:danger*(.4-(a.guard||0))*weight,cost:0,id:'guard'});
  return result.sort((x,y)=>y.value-x.value||x.cost-y.cost||x.id.localeCompare(y.id)||((x.command.y||0)-(y.command.y||0))||((x.command.x||0)-(y.command.x||0)));
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
  const enemies=opponents(s,a);return Math.min(...enemies.map(b=>R.dist(a,b)));
}
function moveChoice(s,a,accuracy,{escape=false,visited=new Set()}={}){
  const dangers=new Set(warnings(s,a).map(R.key)),base=potential(s,a,accuracy)-hazardDamage(s,a)*hpWeight(a)-approach(s,a)*a.atk*.06;
  let best=null,bestScore=base;
  for(const p of R.moveCells(s,a)){
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
  const choices=options(s,a),hasHit=choices.some(c=>['attack','skill'].includes(c.command.type)&&!['restore','counter'].includes(c.id)&&
    (c.command.type==='attack'||!['restore','counter','blink'].includes(R.branchFor(a).skill.kind)));
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
    if(metrics)metrics[uid][command.type]++;
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
function fighter(v,uid,{atk=200,maxHp=1000}={}){return {uid,name:v.id,core:v.core,branch:v.branch,atk,maxHp};}
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
