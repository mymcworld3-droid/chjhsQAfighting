// Dungeon boss VFX use only server-announced warning cells and authoritative HP.
// All data here is read-only; no animation affects a hit, dodge, or game clock.
const TAU=Math.PI*2;
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,Number(n)||0));
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export function dungeonBossVisualPlan(boss,visualTick=0){
  if(boss?.kind!=='boss'||!finite(boss.position)||
      !(Number(boss.battleHealth)>0))return null;
  const maxHp=Math.max(1,Number(boss.battleMaxHealth)||900);
  const hp=clamp(Number(boss.battleHealth),0,maxHp);
  const phase=Number.isInteger(boss.phase)?clamp(boss.phase,1,3):
    hp/maxHp>.7?1:hp/maxHp>.35?2:3;
  const origin=boss.position;
  const attack=boss.attack;
  // Do not depict a stale telegraph from a previously displaced boss.
  const valid=attack&&finite(attack.from)&&
    attack.from.x===origin.x&&attack.from.y===origin.y&&
    ['quake','charge','flame'].includes(attack.kind)&&
    Array.isArray(attack.cells)&&attack.cells.length>0;
  const beginning=Number(attack?.startedAtTick)||0,
    ending=Number(attack?.resolvesAtTick)||0;
  const time=ending>beginning?
    clamp((Number(visualTick)-beginning)/(ending-beginning),0,.97):0;
  return {
    boss:{x:origin.x,y:origin.y,hp,maxHp,
      footprint:{width:2,height:2},bossKind:'flame',
      phase:phase>=2?2:1},
    phase,shield:Math.max(0,Number(boss.shield)||0),
    exposed:Number(boss.exposedUntilTick)>=Number(visualTick),
    warning:valid?{
      kind:attack.kind,cells:attack.cells.filter(finite).slice(0,110)
        .map(p=>({x:p.x,y:p.y})),
      progress:time,startedAtTick:beginning,resolvesAtTick:ending
    }:null
  };
}
const cellOn=(map,p)=>Number.isInteger(p?.x)&&Number.isInteger(p?.y)&&
  p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height&&
  map.tiles?.[p.y*map.width+p.x]>0;
export function drawBossTelegraph(ctx,plan,map,view,time=0,reduced=false){
  const warning=plan?.warning;
  if(!warning?.cells?.length||!ctx||!view||!map)return;
  const {ox,oy,cell}=view;
  const cells=warning.cells.filter(p=>cellOn(map,p));
  if(!cells.length)return;
  const shift=reduced?0:((time||0)*.001)%1;
  const heat=warning.progress;
  ctx.save();
  // Exact server cell mask: no flame, quake or charge drawn outside danger.
  ctx.beginPath();
  for(const p of cells)ctx.rect(ox+p.x*cell+.7,oy+p.y*cell+.7,
    Math.max(1,cell-1.4),Math.max(1,cell-1.4));
  ctx.clip();
  ctx.globalAlpha=reduced?.26:.24+.21*heat;
  ctx.strokeStyle=warning.kind==='flame'?'#ffd098':
    warning.kind==='charge'?'#ffb77e':'#f9d9b0';
  ctx.lineWidth=Math.max(1,Math.min(4,cell*.072));
  if(warning.kind==='quake'){
    const x=ox+(plan.boss.x+1)*cell,y=oy+(plan.boss.y+1)*cell;
    // Ring radii are cosmetic; the clip above enforces server hit cells.
    for(let i=0;i<5;i++){
      const r=(1.05+i*.68+(reduced?0:shift*.36))*cell;
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.stroke();
    }
  }else if(warning.kind==='charge'){
    // Moving diagonal rails along the authorized boss charge corridor.
    const xs=cells.map(p=>p.x),ys=cells.map(p=>p.y);
    const x0=ox+Math.min(...xs)*cell,y0=oy+Math.min(...ys)*cell,
      w=(Math.max(...xs)-Math.min(...xs)+1)*cell,
      h=(Math.max(...ys)-Math.min(...ys)+1)*cell;
    const stride=Math.max(8,cell*.6);
    for(let d=-h;d<w+h;d+=stride){
      const x=x0+d+(reduced?0:shift*stride);
      ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x+h,y0+h);
      ctx.stroke();
    }
  }else{
    // Ember tongues rise within only the announced fan tiles.
    for(const p of cells){
      const x=ox+p.x*cell,y=oy+p.y*cell;
      const wave=reduced?0:Math.sin((time||0)*.009+p.x*1.7+p.y);
      ctx.beginPath();
      ctx.moveTo(x+cell*.22,y+cell*.86);
      ctx.quadraticCurveTo(x+cell*(.55+wave*.08),y+cell*.58,
        x+cell*.57,y+cell*.16);
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function drawBossAura(ctx,plan,view,time=0,reduced=false,
  impact=globalThis.QATacticalImpact){
  if(!plan?.boss||!ctx||!view)return;
  // Use the exact aura routine from 問道試煉 for boss presence.
  if(typeof impact?.drawBossPresence==='function')
    impact.drawBossPresence(ctx,plan.boss,view,time,reduced);
  if(plan.shield<=0&& !plan.exposed)return;
  const {ox,oy,cell}=view;
  const x=ox+(plan.boss.x+1)*cell,y=oy+(plan.boss.y+1)*cell;
  const breath=reduced?0:Math.sin(time*.004);
  ctx.save();
  ctx.strokeStyle=plan.shield>0?'#bbdce8':'#ffdc8e';
  ctx.lineWidth=Math.max(1.5,cell*.056);
  ctx.globalAlpha=plan.shield>0?.48+.12*breath:.43+.15*breath;
  ctx.beginPath();ctx.ellipse(x,y,cell*(1.09+breath*.025),
    cell*(.88+breath*.018),0,0,TAU);ctx.stroke();
  ctx.restore();
}
export function dungeonBossTransition(previous,next){
  const before=previous?.enemies?.find(e=>e.kind==='boss');
  if(!before)return null;
  const after=next?.enemies?.find(e=>e.kind==='boss');
  if(after&&after.id===before.id&&Number(after.phase)>Number(before.phase))
    return {kind:'phase',phase:after.phase,position:{...after.position}};
  if(!after&&next?.bossEncounter?.status==='defeated')
    return {kind:'defeat',phase:3,position:{...before.position}};
  return null;
}
export function drawBossTransition(ctx,event,view,progress,reduced=false){
  if(!ctx||!event||!finite(event.position)||!view)return;
  const q=clamp(progress),{ox,oy,cell}=view;
  const x=ox+(event.position.x+1)*cell,
    y=oy+(event.position.y+1)*cell;
  ctx.save();ctx.strokeStyle=event.kind==='defeat'?'#f3dcb0':'#ffab7b';
  ctx.globalAlpha=(1-q)*(event.kind==='defeat'?.65:.42);
  ctx.lineWidth=Math.max(1.2,cell*.06)*(1-.4*q);
  for(let i=0;i<(reduced?1:3);i++){
    const t=clamp((q-i*.18)/Math.max(.1,1-i*.18));
    if(!t&&i)continue;
    ctx.beginPath();ctx.arc(x,y,cell*(.6+t*(event.kind==='defeat'?3.4:2.4)),
      0,TAU);ctx.stroke();
  }
  ctx.restore();
}
