// Presentation-only bridge to the SAME manual skill renderer used by 問道試煉.
// Nothing in this file applies damage, changes positions or authorizes casts.
const validPoint=p=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y);
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const copyPoint=p=>({x:p.x,y:p.y});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const finiteNumber=n=>Number.isFinite(n)?n:0;
const MOVE_IDS=Object.freeze({
  'flight-slash':'wind-slash','flight-break':'wind-thousand',
  'sky-pierce':'wind-slash','dragon-strike':'rock-fist',
  'tiger-fist':'rock-fist'
});
export const dungeonVisualMove=id=>MOVE_IDS[id]||id;
const arrayRays=(cells,target,directions)=>{
  const set=new Set(cells.filter(validPoint).map(p=>p.x+','+p.y));
  return directions.map(([dx,dy])=>{
    const out=[];
    for(let i=1;i<=5;i++){
      const p={x:target.x+dx*i,y:target.y+dy*i};
      if(!set.has(p.x+','+p.y))break;
      out.push(p);
    }
    return out;
  }).filter(ray=>ray.length);
};
// Preserve the exact two crossed cut lines of the trial's sky-cloud animation.
// A wall truncates the cut at the first absent tile, never draws through it.
const skyCuts=(cells,target)=>{
  const set=new Set(cells.filter(validPoint).map(p=>p.x+','+p.y));
  const arm=(dx,dy)=>{
    const out=[];
    for(let i=1;i<=5;i++){
      const p={x:target.x+dx*i,y:target.y+dy*i};
      if(!set.has(p.x+','+p.y))break;
      out.push(p);
    }
    return out;
  };
  const cut1=arm(-1,-1).reverse().concat([target],arm(1,1));
  const cut2=arm(-1,1).reverse().concat([target],arm(1,-1));
  return [cut1,cut2].filter(cut=>cut.length>=2);
};
const skyRays=(cells,target)=>arrayRays(cells,target,
  [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
const actor=(uid,p,stats={})=>({uid,x:p.x,y:p.y,
  hp:finiteNumber(stats.battleHealth),maxHp:stats.battleMaxHealth||100,
  shield:0,bot:!!stats.kind});
const actorsFor=room=>{
  const party=Object.values(room?.members||{}).filter(m=>validPoint(m?.position))
    .map(m=>actor(m.uid,m.position,m));
  const enemies=(room?.enemies||[]).filter(e=>validPoint(e?.position))
    .map(e=>actor(e.id,e.position,{...e,kind:e.kind||'enemy'}));
  return [...party,...enemies];
};
const durationFor=id=>{
  const move=dungeonVisualMove(id);
  return move==='dragon-guard'?460:
    move==='sky-cloud'||move==='sky-sever'?500:
    move==='tiger-throw'?520:420;
};
function buildSkill(uid,result,previous,next){
  const source=previous?.members?.[uid],newSource=next?.members?.[uid];
  const origin=validPoint(result.origin)?result.origin:source?.position;
  const target=result.target;
  if(!validPoint(origin)||!validPoint(target))return null;
  const skill=source?.dungeonSkills?.find(s=>s.id===result.skillId)||
    newSource?.dungeonSkills?.find(s=>s.id===result.skillId);
  if(!skill)return null;
  const move=dungeonVisualMove(result.skillId);
  const cells=(result.effectCells||[]).filter(validPoint).slice(0,72)
    .map(copyPoint);
  const hits=Array.isArray(result.hits)?result.hits.slice(0,30):[];
  const hitIds=new Set(hits.map(h=>h.enemyId));
  const before=actorsFor(previous);
  const priorEnemies=new Map((previous?.enemies||[]).map(e=>[e.id,e]));
  const moves=[];
  if(validPoint(result.position)&&!same(origin,result.position)){
    moves.push({uid,path:[copyPoint(origin),copyPoint(result.position)],
      timing:skill.kind==='fist-chain'?'chain-advance':'dash'});
  }
  // Prefer explicit server-confirmed displacement, including enemies
  // defeated by the same cast (they may not exist in the next snapshot).
  const confirmed=Array.isArray(result.visualMoves)?result.visualMoves:[];
  const drawnMoves=new Set();
  for(const motion of confirmed.slice(0,12)){
    if(!hitIds.has(motion.enemyId)||!validPoint(motion.from)||
        !validPoint(motion.to)||same(motion.from,motion.to))continue;
    moves.push({uid:motion.enemyId,path:[copyPoint(motion.from),
      copyPoint(motion.to)],
      timing:skill.kind==='fist-throw'?'manual-throw':'push'});
    drawnMoves.add(motion.enemyId);
  }
  // Older rooms have no visualMoves. Use a bounded prior/next snapshot
  // fallback, never allow animations to mutate or guess game damage.
  if(!confirmed.length)for(const enemy of next?.enemies||[]){
    const prior=priorEnemies.get(enemy.id);
    if(!hitIds.has(enemy.id)||drawnMoves.has(enemy.id)||
        !validPoint(prior?.position)||!validPoint(enemy?.position)||
        same(prior.position,enemy.position))continue;
    moves.push({uid:enemy.id,path:[copyPoint(prior.position),
      copyPoint(enemy.position)],
      timing:skill.kind==='fist-throw'?'manual-throw':'push'});
  }
  const numbers=hits.filter(hit=>Number.isFinite(hit.damage)&&hit.damage>0)
    .map(hit=>({uid:hit.enemyId,damage:hit.damage,
      absorbed:hit.shieldDamage||0,combo:hit.combo===true}));
  const scene={kind:'cast',style:skill.kind,actor:uid,
    skill:result.skillId,origin:copyPoint(origin),target:copyPoint(target),
    cells,moves,numbers,hits,before,focusEmpowered:result.focusEmpowered===true,
    focusActivated:result.focusActivated===true,
    parallelImpact:numbers.length>0,impactStart:skill.kind==='fist-chain'?.15:.45,
    duration:durationFor(result.skillId),
    visualVersion:1};
  if(move==='sky-cloud')scene.cuts=skyCuts(cells,target);
  if(move==='sky-sever')scene.rays=skyRays(cells,target);
  return scene;
}
function buildStrike(uid,result,previous){
  const origin=result.origin||previous?.members?.[uid]?.position;
  const oldEnemy=previous?.enemies?.find(e=>e.id===result.enemyId);
  const target=result.target||oldEnemy?.position;
  if(!validPoint(origin)||!validPoint(target))return null;
  return {kind:'basic',actor:uid,origin:copyPoint(origin),
    target:copyPoint(target),hits:[{enemyId:result.enemyId,
      damage:result.damage,combo:result.combo,shieldDamage:result.shieldDamage}],
    before:actorsFor(previous),duration:360,visualVersion:1};
}
// Compare committed room revisions. A room's lastSkill/lastStrike is a
// single last-result record, not a request to replay on every SSE refresh.
export function dungeonAnimationEvents(previous,next){
  if(!previous||!next||previous.id!==next.id||
      previous.dungeonArena!==next.dungeonArena||
      next.status!=='assembled')return [];
  const events=[];
  for(const [uid,member] of Object.entries(next.members||{})){
    const old=previous.members?.[uid];
    if(!old)continue;
    const lastSkill=member.lastSkill,priorSkill=old.lastSkill;
    if(lastSkill?.visualVersion===1&&Number.isSafeInteger(lastSkill.seq)&&
        lastSkill.seq>(Number(priorSkill?.seq)||0)){
      const scene=buildSkill(uid,lastSkill,previous,next);
      if(scene)events.push({key:uid+':skill:'+lastSkill.seq,scene});
    }
    const strike=member.lastStrike,priorStrike=old.lastStrike;
    if(Number.isSafeInteger(strike?.seq)&&
        strike.seq>(Number(priorStrike?.seq)||0)){
      const scene=buildStrike(uid,strike,previous);
      if(scene)events.push({key:uid+':strike:'+strike.seq,scene});
    }
  }
  return events.slice(0,12);
}
// Authoritative hits might be multi-hit; show one number per affected enemy.
export function drawDungeonHitNumbers(ctx,scene,p,view){
  if(p<.30||p>=1)return;
  const impacts=(scene.hits||[]).filter(h=>h&&Number.isFinite(h.damage)&&h.damage>0);
  const merged=new Map();
  for(const h of impacts){
    const prior=merged.get(h.enemyId)||{damage:0,combo:false,shield:false};
    prior.damage+=h.damage;prior.combo ||=h.combo===true;
    prior.shield ||= (h.shieldDamage||0)>0;
    merged.set(h.enemyId,prior);
  }
  const beat=clamp((p-.30)/.70,0,1);
  const alpha=(1-beat)**.55;
  for(const [uid,item] of merged){
    const victim=scene.before?.find(a=>a.uid===uid);
    if(!victim)continue;
    const x=view.ox+(victim.x+.5)*view.cell;
    const y=view.oy+(victim.y+.5)*view.cell-view.cell*(.58+beat*.7);
    ctx.save();ctx.globalAlpha=alpha;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='700 '+clamp(view.cell*.28,11,18)+'px system-ui,sans-serif';
    const label='-'+Math.round(item.damage);
    ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeStyle='#16201c';
    ctx.strokeText(label,x,y);
    ctx.fillStyle=item.combo?'#ffe79b':item.shield?'#afdaf1':'#ffae83';
    ctx.fillText(label,x,y);
    ctx.restore();
  }
}
export function drawDungeonBasicStrike(ctx,scene,p,view,above){
  if(scene.kind!=='basic')return false;
  const from={x:view.ox+(scene.origin.x+.5)*view.cell,
    y:view.oy+(scene.origin.y+.5)*view.cell};
  const to={x:view.ox+(scene.target.x+.5)*view.cell,
    y:view.oy+(scene.target.y+.5)*view.cell};
  const q=clamp((p-.08)/.62,0,1),pulse=Math.sin(Math.PI*clamp(p));
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  if(!above){
    ctx.strokeStyle='#f2bd7e';ctx.lineWidth=Math.max(1,view.cell*.08);
    ctx.globalAlpha=.22*pulse;ctx.beginPath();
    ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
  }else{
    ctx.shadowColor='#eebe80';ctx.shadowBlur=view.cell*.22;
    for(const [width,alpha] of [[.21,.18],[.07,.85]]){
      ctx.strokeStyle=width<.10?'#fff4cf':'#f2aa63';
      ctx.lineWidth=Math.max(2,view.cell*width);
      ctx.globalAlpha=(1-q)*alpha;
      ctx.beginPath();ctx.moveTo(from.x+(to.x-from.x)*Math.max(0,q-.45),
        from.y+(to.y-from.y)*Math.max(0,q-.45));
      ctx.lineTo(from.x+(to.x-from.x)*q,from.y+(to.y-from.y)*q);ctx.stroke();
    }
    if(p>.32){
      const beat=clamp((p-.32)/.5,0,1);
      ctx.shadowBlur=0;ctx.globalAlpha=(1-beat)*.9;
      ctx.strokeStyle='#ffe4ab';ctx.lineWidth=Math.max(2,view.cell*.06);
      ctx.beginPath();ctx.arc(to.x,to.y,view.cell*(.16+beat*.52),
        0,Math.PI*2);ctx.stroke();
    }
  }
  ctx.restore();return true;
}
// The same manual VFX engine as the trial, in both original layers.
export function paintDungeonScene(ctx,scene,p,view,above,skillEffects){
  if(scene.kind==='basic')return drawDungeonBasicStrike(ctx,scene,p,view,above);
  if(!skillEffects?.draw)return false;
  const result=skillEffects.draw(ctx,scene,p,view,above);
  if(above&&skillEffects.drawMotion&&scene.moves?.length){
    const advances=scene.moves.filter(m=>m.timing==='dash'||m.timing==='chain-advance');
    if(advances.length)skillEffects.drawMotion(ctx,{
      kind:'move',style:'dash',visualSkill:scene.skill,moves:advances
    },p,view);
    const throws=scene.moves.filter(m=>m.timing==='manual-throw');
    if(throws.length)skillEffects.drawMotion(ctx,{
      kind:'move',style:'throw',visualSkill:scene.skill,moves:throws
    },p,view);
  }
  return result;
}
