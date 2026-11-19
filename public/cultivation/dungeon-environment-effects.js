// Seeded, world-anchored dungeon ambience. Never marks void as traversable,
// changes map tiles, blocks the danger contour, or sends client-only effects.
const TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const valid=(map,x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&
  (map.tiles[y*map.width+x]||0)>0;
function noise(map,x,y){
  let h=2166136261;
  const value=String(map.layoutId||map.seed||map.arena||'dungeon')+
    ':'+x+','+y;
  for(let i=0;i<value.length;i++){
    h^=value.charCodeAt(i);h=Math.imul(h,16777619);
  }
  return (h>>>0)/4294967296;
}
export function dungeonEnvironmentPlan(map){
  if(!map||!Number.isInteger(map.width)||!Number.isInteger(map.height)||
      !Array.isArray(map.tiles)||map.tiles.length!==map.width*map.height)
    return null;
  const positions=[],max=90;
  // Fixed stride avoids per-frame random draws and limits work on huge maps.
  const stride=Math.max(2,Math.floor(Math.sqrt(map.width*map.height/55)));
  for(let y=0;y<map.height&&positions.length<max;y+=stride)
    for(let x=0;x<map.width&&positions.length<max;x+=stride){
      const h=noise(map,x,y);
      const px=Math.min(map.width-1,x+Math.floor(h*stride));
      const py=Math.min(map.height-1,
        y+Math.floor(((h*1.618033)%1)*stride));
      if(!valid(map,px,py))continue;
      positions.push({x:px,y:py,phase:h*TAU,
        strength:.35+.65*noise(map,py,px)});
    }
  return {biome:map.biome||'ruins',arena:map.arena,
    positions,portal:valid(map,map.portalSite?.x,map.portalSite?.y)?
      {...map.portalSite}:null};
}
export function drawDungeonEnvironment(ctx,plan,map,view,time=0,
  reduced=false,objectives=null){
  if(!plan||!ctx||!view||!map)return;
  const {ox,oy,cell}=view;
  const t=(Number(time)||0)*.001;
  const biome=plan.biome;
  ctx.save();
  // One small effect per seeded, traversable cell: visible tiles only.
  for(const p of plan.positions){
    if(!valid(map,p.x,p.y))continue;
    const x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;
    if(x<view.left-cell||y<view.top-cell||
       x>view.right+cell||y>view.bottom+cell)continue;
    const sway=reduced?0:Math.sin(t*(biome==='frost'?.64:1.25)+p.phase);
    ctx.globalAlpha=(reduced?.18:.16+.11*(.5+.5*sway))*p.strength;
    ctx.strokeStyle=biome==='frost'?'#d8f4ff':
      biome==='marsh'?'#9edfd4':
      biome==='bamboo'?'#c9eab3':'#edc99a';
    ctx.lineWidth=Math.max(.65,cell*.028);
    if(biome==='marsh'){
      ctx.beginPath();
      ctx.ellipse(x,y+cell*.15,cell*(.17+.04*sway),
        cell*.064,0,0,TAU);ctx.stroke();
    }else if(biome==='frost'){
      const drift=reduced?0:Math.sin(t*.74+p.phase)*cell*.12;
      const r=clamp(cell*.045,1,2.7);
      ctx.beginPath();ctx.moveTo(x-r,y+drift);
      ctx.lineTo(x+r,y+drift);ctx.moveTo(x,y+drift-r);
      ctx.lineTo(x,y+drift+r);ctx.stroke();
    }else if(biome==='bamboo'){
      const r=cell*.10;
      ctx.beginPath();ctx.moveTo(x-r,y+cell*.05);
      ctx.quadraticCurveTo(x+cell*.03+sway*cell*.09,y-r,
        x+r+sway*cell*.05,y-r*.7);
      ctx.stroke();
    }else{
      const r=clamp(cell*.05,1.5,3.3);
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.stroke();
    }
  }
  ctx.restore();
  if(plan.arena==='boss'){
    // Floor-level ember currents, anchored to arena. No extra hit polygons.
    const x=ox+(map.bossSite?.x+1||12)*cell,
      y=oy+(map.bossSite?.y+1||7)*cell;
    ctx.save();ctx.strokeStyle='#f3a77a';
    ctx.globalAlpha=reduced?.11:.11+.06*Math.sin(t*1.1);
    ctx.lineWidth=Math.max(1,cell*.031);
    ctx.beginPath();ctx.ellipse(x,y,cell*2.9,cell*2.13,0,0,TAU);
    ctx.stroke();ctx.restore();
  }else if(plan.portal&&objectives?.portalStatus==='open'){
    const p=plan.portal,x=ox+(p.x+.5)*cell,y=oy+(p.y+.5)*cell;
    ctx.save();ctx.strokeStyle='#cbb3ff';
    const pulse=reduced?0:Math.sin(t*2.6);
    ctx.globalAlpha=reduced?.35:.34+.16*pulse;
    ctx.lineWidth=Math.max(1.2,cell*.06);
    ctx.beginPath();ctx.ellipse(x,y,cell*(.38+pulse*.05),
      cell*(.16+pulse*.027),0,0,TAU);ctx.stroke();ctx.restore();
  }
}
// Non-damaging local cast windup, never a hit or positional prediction.
export function drawDungeonCastWindup(ctx,cue,view,time=0,reduced=false){
  if(!cue?.origin||!cue.target||!view||!ctx||
      !Number.isFinite(cue.origin.x)||!Number.isFinite(cue.origin.y)||
      !Number.isFinite(cue.target.x)||!Number.isFinite(cue.target.y))return;
  const {ox,oy,cell}=view;
  const a={x:ox+(cue.origin.x+.5)*cell,y:oy+(cue.origin.y+.5)*cell};
  const b={x:ox+(cue.target.x+.5)*cell,y:oy+(cue.target.y+.5)*cell};
  const elapsed=Math.max(0,(time||0)-(cue.startedAt||0));
  const grow=reduced?1:Math.min(1,elapsed/180);
  const f=reduced?0:Math.sin(elapsed*.022);
  const fist=/fist|dragon|tiger/.test(cue.style||cue.skillId||'');
  const color=fist?'#f5bc7a':'#b8e7d5';
  ctx.save();ctx.globalAlpha=.31+.24*grow;
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.3,cell*.055);
  ctx.beginPath();ctx.arc(a.x,a.y,cell*(.22+.20*grow),0,TAU);ctx.stroke();
  if(a.x!==b.x||a.y!==b.y){
    ctx.setLineDash([Math.max(3,cell*.22),Math.max(2,cell*.11)]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(
      a.x+(b.x-a.x)*grow,a.y+(b.y-a.y)*grow);ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha=.53+.17*f;ctx.beginPath();ctx.arc(b.x,b.y,
    cell*(.24+.035*f),0,TAU);ctx.stroke();ctx.restore();
}
