/* Pure boss-hit rules shared by the server and read-only skill preview. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QADungeonBossHit=api;
})(globalThis,()=>{
  'use strict';
  const KIND='boss',HP=2800,SHIELD_MAX=180,COMBO_WINDOW_TICKS=5,STAGGER_TICKS=3,EXPOSED_TICKS=6;
  const fail=(message,status=409)=>Object.assign(new Error(message),{status});
  const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
  const int=(value,otherwise=0)=>Number.isSafeInteger(value)&&value>=0?value:otherwise;
function cells(enemy){
  if(enemy?.kind!==KIND)return enemy?.position?[enemy.position]:[];
  const p=enemy.position;
  if(!p||!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y))return [];
  return [{x:p.x,y:p.y},{x:p.x+1,y:p.y},
    {x:p.x,y:p.y+1},{x:p.x+1,y:p.y+1}];
}
const occupies=(enemy,p)=>cells(enemy).some(q=>same(q,p));
function comboReady(boss,uid,tick){
  return boss?.kind===KIND&&typeof uid==='string'&&uid.length>0&&
    typeof boss.lastContributorUid==='string'&&
    boss.lastContributorUid!==uid&&
    Number.isSafeInteger(boss.lastContributorTick)&&
    tick>=boss.lastContributorTick&&
    tick-boss.lastContributorTick<=COMBO_WINDOW_TICKS;
}
// Mutates ONLY the local enemy snapshot calculated inside the C transaction.
// One martial skill may hit the boss several times; the caller computes linked
// ONCE per skill, so its own repeated hits cannot manufacture teamwork.
function damage(boss,uid,amount,tick,linked=false){
  if(boss?.kind!==KIND||typeof uid!=='string'||!uid||
      !Number.isSafeInteger(tick)||tick<0||!Number.isFinite(amount))
    throw fail('首領傷害資料無效',409);
  const health=int(boss.battleHealth,HP);
  if(!health)return {damage:0,shieldDamage:0,combo:false,shieldBroken:false};
  const combo=linked===true;
  const attack=Math.max(1,Math.round(amount*(combo?1.2:1)));
  const shieldBefore=Math.min(SHIELD_MAX,int(boss.shield));
  const shieldDamage=Math.min(shieldBefore,attack);
  // Shield reduces HP damage, but never makes the boss invulnerable.
  const exposed=shieldBefore===0&&tick<=int(boss.exposedUntilTick,-1);
  const dealt=Math.min(health,Math.max(1,Math.round(attack*(
    shieldBefore>0?.7:exposed?1.25:1))));
  boss.battleHealth=health-dealt;
  boss.shield=shieldBefore-shieldDamage;
  const broken=shieldBefore>0&&boss.shield===0;
  if(broken){
    boss.exposedUntilTick=tick+EXPOSED_TICKS;
    // A shield break interrupts a wind-up once and opens a short counter window.
    boss.attack=null;boss.intent='staggered';boss.targetUid=null;
    boss.nextActionTick=Math.max(int(boss.nextActionTick),tick+STAGGER_TICKS);
  }
  boss.lastContributorUid=uid;boss.lastContributorTick=tick;
  boss.lastTeamHit={uid,tick,damage:dealt,shieldDamage,
    combo,shieldBroken:broken};
  return {...boss.lastTeamHit};
}

  return Object.freeze({cells,occupies,comboReady,damage,HP,SHIELD_MAX,COMBO_WINDOW_TICKS,STAGGER_TICKS,EXPOSED_TICKS});
});
