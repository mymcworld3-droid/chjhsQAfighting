/* Presentation-only, offscreen battlefield compass.
 * Markers are computed from the SAME camera geometry as tile selection;
 * clicking one moves only the camera, never the combat state.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalCompass=api;
})(globalThis,()=>{
  'use strict';
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const icons=Object.freeze({self:'我',boss:'首',monster:'獸',objective:'標'});
  const colors=Object.freeze({self:'#a5e8c0',boss:'#f9c38c',
    monster:'#efae99',objective:'#a9d9f3'});
  function pointFor(actor){
    const sizeX=actor.footprint?.width||1,sizeY=actor.footprint?.height||1;
    return {x:actor.x+sizeX*.5,y:actor.y+sizeY*.5,
      width:sizeX,height:sizeY};
  }
  function outside(q,g){
    const x=g.ox+q.x*g.cell,y=g.oy+q.y*g.cell;
    const halfX=g.cell*q.width*.47,halfY=g.cell*q.height*.47;
    // Only fully offscreen actors receive a compass marker. A creature
    // partially visible on the edge should not get a second symbol.
    return x+halfX<0||x-halfX>g.width||y+halfY<0||y-halfY>g.height;
  }
  function placement(q,g){
    const x=g.ox+q.x*g.cell,y=g.oy+q.y*g.cell;
    const centerX=g.width/2,centerY=g.height/2;
    const dx=x-centerX,dy=y-centerY;
    const minX=27,maxX=Math.max(27,g.width-27);
    const minY=Math.min(66,Math.max(29,g.height*.18));
    // Never put map indicators inside the two quarter-circle controls.
    const maxY=Math.max(minY+10,Math.min(g.height-30,g.height*.71));
    const tx=dx<0?(minX-centerX)/dx:dx>0?(maxX-centerX)/dx:Infinity;
    const ty=dy<0?(minY-centerY)/dy:dy>0?(maxY-centerY)/dy:Infinity;
    const t=Math.min(Math.max(0,tx),Math.max(0,ty));
    return {screenX:clamp(centerX+dx*t,minX,maxX),
      screenY:clamp(centerY+dy*t,minY,maxY),
      angle:Math.atan2(dy,dx)};
  }
  function derive(state,uid,g){
    if(state?.mode!=='pve'||state?.status!=='active'||!g||
      ![g.cell,g.ox,g.oy,g.width,g.height].every(finite)||
      g.cell<=0||g.width<140||g.height<160)return [];
    const living=(state.actors||[]).filter(a=>a&&a.hp>0);
    const hero=living.find(a=>a.uid===uid);
    const boss=living.find(a=>a.bot&&a.boss);
    const enemies=living.filter(a=>a.bot&&!a.boss);
    const candidates=[];
    if(hero)candidates.push({kind:'self',actor:hero,priority:0});
    if(boss)candidates.push({kind:'boss',actor:boss,priority:1});
    const objective=state.objective||{};
    let objectives=[];
    if(objective.type==='sealing')objectives=(objective.points||[]).filter(p=>!p.activated);
    else if(objective.type==='defense'&&objective.shrine)objectives=[objective.shrine];
    else if(objective.type==='transport'){
      objectives=[objective.carrying?objective.destination:objective.item].filter(Boolean);
    }
    for(const [i,p] of objectives.entries())
      if(finite(p?.x)&&finite(p?.y))candidates.push({kind:'objective',
        actor:{uid:'objective-'+i,x:p.x,y:p.y,footprint:{width:1,height:1}},priority:2});
    for(const enemy of enemies)candidates.push({kind:'monster',actor:enemy,priority:3});
    const shown=[],max=3;
    // Enemy candidates: favor the creature nearest the center of the current
    // view, not merely the oldest spawn ID.
    candidates.sort((a,b)=>a.priority-b.priority||
      Math.hypot(g.ox+pointFor(a.actor).x*g.cell-g.width/2,
                 g.oy+pointFor(a.actor).y*g.cell-g.height/2)-
      Math.hypot(g.ox+pointFor(b.actor).x*g.cell-g.width/2,
                 g.oy+pointFor(b.actor).y*g.cell-g.height/2));
    for(const c of candidates){
      if(shown.length>=max)break;
      const q=pointFor(c.actor);
      if(!outside(q,g))continue;
      const p=placement(q,g);
      // Keep badges separated instead of stacking three on the same edge.
      if(shown.some(a=>Math.hypot(a.screenX-p.screenX,a.screenY-p.screenY)<37)){
        const shift=[-42,42,-84,84].map(delta=>({...p,screenY:clamp(p.screenY+delta,35,
          Math.max(45,g.height*.72))})).find(test=>
          shown.every(a=>Math.hypot(a.screenX-test.screenX,a.screenY-test.screenY)>=36));
        if(!shift)continue;
        Object.assign(p,shift);
      }
      shown.push({...p,kind:c.kind,uid:c.actor.uid,
        label:icons[c.kind],color:colors[c.kind],
        target:{x:q.x,y:q.y},name:String(c.actor.name||({
          self:'自己',boss:'首領',monster:'靈獸',objective:'關卡目標'
        }[c.kind]))});
    }
    return shown;
  }
  function pick(markers,x,y){
    if(!finite(x)||!finite(y))return null;
    return (markers||[]).find(m=>Math.hypot(m.screenX-x,m.screenY-y)<=23)||null;
  }
  function draw(ctx,markers,g){
    if(!ctx||!Array.isArray(markers)||!markers.length||!g)return;
    ctx.save();ctx.beginPath();ctx.rect(0,0,g.width,g.height);ctx.clip();
    for(const m of markers){
      const x=m.screenX,y=m.screenY;
      ctx.save();ctx.translate(x,y);
      // A small badge, not an attack-range frame; painted below creatures.
      ctx.fillStyle='rgba(18,30,25,.87)';
      ctx.strokeStyle=m.color;ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(0,0,15,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle=m.color;ctx.font='bold 11px system-ui,sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(m.label,0,1);
      ctx.rotate(m.angle);
      ctx.fillStyle=m.color;
      ctx.beginPath();ctx.moveTo(24,0);ctx.lineTo(18,-5);ctx.lineTo(18,5);
      ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.restore();
  }
  return Object.freeze({pointFor,outside,placement,derive,pick,draw});
});
