// Presentation-only enemy tells, committed strike impacts and player hit poses.
// The server owns attack tiles, damage, health and the battle clock. This module
// never predicts an impact from a telegraph or mutates a room snapshot.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const validPoint=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
const copy=p=>({x:p.x,y:p.y});
const normalKinds=new Set(['wolf','wisp','golem','guardian']);
const attackKinds=new Set(['bite','ray','fan']);
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const appliedTick=room=>room?.battleClock?.appliedTick??room?.battleAppliedTick;
const fresh=(tick,room)=>Number.isSafeInteger(tick)&&tick>=0&&
  Number.isSafeInteger(appliedTick(room))&&
  tick<=appliedTick(room)&&appliedTick(room)-tick<=2;

export function dungeonEnemyReactionEvents(before,after){
  if(!before||!after||before.id!==after.id||
    before.status!=='assembled'||after.status!=='assembled'||
    before.dungeonArena!==after.dungeonArena)return [];
  const oldEnemies=new Map((before.enemies||[]).map(e=>[e.id,e]));
  const result=[];
  for(const enemy of after.enemies||[]){
    if(!normalKinds.has(enemy?.kind)||!validPoint(enemy.position))continue;
    const prior=oldEnemies.get(enemy.id),strike=enemy.lastAttack;
    if(!prior||!strike||!fresh(strike.tick,after)||
      !attackKinds.has(strike.kind)||!Array.isArray(strike.cells)||
      strike.tick===prior.lastAttack?.tick)continue;
    const cells=strike.cells.filter(validPoint).slice(0,12).map(copy);
    if(!cells.length)continue;
    const hits=[...new Set((strike.hits||[]).filter(uid=>
      typeof uid==='string'&&Object.hasOwn(after.members||{},uid)))];
    result.push({key:'enemy-strike:'+enemy.id+':'+strike.tick,
      kind:'strike',sourceId:enemy.id,attackKind:strike.kind,
      origin:copy(enemy.position),cells,hits,tick:strike.tick,
      duration:510});
  }
  for(const [uid,member] of Object.entries(after.members||{})){
    const prior=before.members?.[uid],hit=member?.lastDamage;
    if(!prior||!hit||!validPoint(member.position)||
      !fresh(hit.tick,after)||!Number.isFinite(hit.amount)||
      hit.amount<=0||typeof hit.sourceId!=='string'||
      (prior.lastDamage?.tick===hit.tick&&
       prior.lastDamage?.sourceId===hit.sourceId))continue;
    const source=(after.enemies||[]).find(e=>e.id===hit.sourceId);
    result.push({key:'enemy-hurt:'+uid+':'+hit.sourceId+':'+hit.tick,
      kind:'hurt',uid,sourceId:hit.sourceId,
      origin:validPoint(source?.position)?copy(source.position):null,
      position:copy(member.position),amount:hit.amount,
      tick:hit.tick,duration:540});
  }
  return result;
}

export function dungeonWindupPose(enemy,tick,now=0,reducedMotion=false){
  const attack=enemy?.attack;
  if(!normalKinds.has(enemy?.kind)||!validPoint(enemy.position)||
    !attackKinds.has(attack?.kind)||(attack.from&&
      !same(attack.from,enemy.position))||
    !Number.isFinite(attack?.startedAtTick)||
    !Number.isFinite(attack?.resolvesAtTick)||
    attack.resolvesAtTick<=attack.startedAtTick||
    !Array.isArray(attack.cells)||!attack.cells.length)return null;
  const delta=Math.max(0,Number(tick)-attack.startedAtTick);
  const phase=clamp(delta/(attack.resolvesAtTick-attack.startedAtTick));
  const target=attack.cells.find(validPoint);
  if(!target)return null;
  const dx=target.x-enemy.position.x,dy=target.y-enemy.position.y;
  const length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;
  const energy=.28+.72*phase;
  const pulse=reducedMotion?0:Math.sin(now*.014)*.10*energy;
  return {kind:attack.kind,energy,phase,pulse,ux,uy,
    dx:reducedMotion?0:-ux*(.035+.075*phase),
    dy:reducedMotion?0:-uy*(.035+.075*phase),
    target:copy(target)};
}

export function dungeonHitPose(uid,scenes,reducedMotion=false){
  if(!uid||!Array.isArray(scenes))return null;
  const hit=scenes.findLast(scene=>scene.kind==='hurt'&&scene.uid===uid);
  if(!hit)return null;
  const p=clamp(hit.progress),weight=(1-p)**2;
  const vector=hit.origin?{
    x:hit.position.x-hit.origin.x,y:hit.position.y-hit.origin.y
  }:{x:1,y:0};
  const length=Math.hypot(vector.x,vector.y)||1;
  const rebound=reducedMotion?0:.13*weight*Math.sin(Math.PI*clamp(p*2.1));
  return {dx:vector.x/length*rebound,dy:vector.y/length*rebound,
    intensity:reducedMotion?.28:weight,progress:p};
}

export function drawDungeonBeastWindup(ctx,enemy,view,tick,now=0,reduced=false){
  const pose=dungeonWindupPose(enemy,tick,now,reduced);
  if(!pose||!validPoint(enemy.position))return;
  const c=view.cell,x=view.ox+(enemy.position.x+.5)*c,
    y=view.oy+(enemy.position.y+.5)*c-
      (Number(enemy.visualLift)||0)*c;
  const r=clamp(c*.39,5,19);
  const color=pose.kind==='ray'?'#88f5de':
    pose.kind==='fan'?'#ffc98d':'#ff9c82';
  ctx.save();ctx.globalAlpha=.36+.42*pose.energy;
  ctx.strokeStyle=color;ctx.lineWidth=clamp(c*.065,1.2,3);
  ctx.beginPath();ctx.arc(x,y,r*(1.24+.11*pose.phase+pose.pulse),
    -Math.PI*.84,Math.PI*.73);ctx.stroke();
  // The gesture points at an already announced server cell, never a new
  // predicted target or an additional unsafe tile.
  ctx.globalAlpha=.24+.4*pose.energy;
  const headX=x+pose.ux*r*1.6,headY=y+pose.uy*r*1.6;
  ctx.beginPath();ctx.moveTo(x+pose.ux*r*.75,y+pose.uy*r*.75);
  ctx.lineTo(headX,headY);ctx.stroke();
  ctx.beginPath();ctx.arc(headX,headY,clamp(c*.055,1,3),0,Math.PI*2);
  ctx.fillStyle=color;ctx.fill();
  ctx.restore();
}

export function drawDungeonEnemyImpacts(ctx,scenes,view,members=[],
  reducedMotion=false){
  if(!Array.isArray(scenes)||!scenes.length)return;
  const c=view.cell,at=p=>({
    x:view.ox+(p.x+.5)*c,y:view.oy+(p.y+.5)*c
  });
  const players=new Map(members.map(m=>[m.uid,m]));
  for(const scene of scenes){
    const progress=clamp(scene.progress);
    if(scene.kind==='strike'&&validPoint(scene.origin)){
      const alpha=reducedMotion?.55:Math.pow(1-progress,1.35);
      if(alpha<.02)continue;
      const source=at(scene.origin);
      const color=scene.attackKind==='ray'?'#a1fbe8':
        scene.attackKind==='fan'?'#ffd08c':'#ffb29e';
      ctx.save();ctx.strokeStyle=color;
      ctx.lineWidth=clamp(c*(scene.attackKind==='fan'?.085:.067),1.3,3.8);
      ctx.globalAlpha=.68*alpha;
      const reach=clamp(c*(.28+progress*.55),3,34);
      ctx.beginPath();ctx.arc(source.x,source.y,reach,
        0,Math.PI*2);ctx.stroke();
      for(const tile of scene.cells||[]){
        if(!validPoint(tile))continue;
        const target=at(tile);
        // Lines and arcs are translucent and narrow: no opaque impact mask
        // is drawn over player or beast sprites.
        if(scene.attackKind==='ray'){
          ctx.beginPath();ctx.moveTo(source.x,source.y);
          ctx.lineTo(target.x,target.y);ctx.stroke();
        }
        ctx.beginPath();ctx.arc(target.x,target.y,
          clamp(c*(.12+progress*.34),2,20),0,Math.PI*2);ctx.stroke();
        if(scene.attackKind==='fan'){
          ctx.beginPath();ctx.arc(target.x,target.y,
            clamp(c*(.24+progress*.2),3,24),-.8,.8);ctx.stroke();
        }
      }
      ctx.restore();
    }else if(scene.kind==='hurt'){
      const member=players.get(scene.uid);
      const where=validPoint(member?.position)?member.position:scene.position;
      if(!validPoint(where))continue;
      const target=at(where),weight=reducedMotion?.7:1-progress;
      if(weight<=.01)continue;
      ctx.save();ctx.globalAlpha=.84*weight;
      ctx.strokeStyle='#ffb19c';ctx.lineWidth=clamp(c*.072,1.3,3);
      ctx.beginPath();ctx.arc(target.x,target.y,
        clamp(c*(.31+progress*.30),4,24),0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#ffe1c8';ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.font='bold '+Math.round(clamp(c*.29,11,17))+'px system-ui,sans-serif';
      const rise=reducedMotion?0:progress*c*.33;
      ctx.fillText('-'+Math.round(scene.amount),target.x,
        target.y-c*.60-rise);
      ctx.restore();
    }
  }
}
