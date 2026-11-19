/* Pure seal-range presentation for v4 tactical sealing; no combat state mutations. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalSealRanges=api;
})(globalThis,()=>{
  'use strict';
  const MODES=Object.freeze(['all','focus','off']);
  const MODE_LABELS=Object.freeze({all:'全部',focus:'單座',off:'隱藏'});
  const xy=p=>p.x+','+p.y;
  const same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
  const rgb=(hex,opacity)=>{
    const h=String(hex||'').match(/^#([a-f0-9]{6})$/i);
    if(!h)return 'rgba(140,200,180,'+opacity+')';
    const x=parseInt(h[1],16);
    return 'rgba('+((x>>16)&255)+','+((x>>8)&255)+','+(x&255)+','+opacity+')';
  };
  // The rules module decides which cells matter. In particular, hazard
  // has NO circular radius, and maze references only an actual stone gate.
  function derive(state,rules){
    if(state?.mode!=='pve'||state.trial?.layoutVersion!==4||
      state.objective?.type!=='sealing'||!rules?.sealInfos)return {seals:[]};
    const blocks=new Set((state.blocks||[]).map(xy));
    const seals=rules.sealInfos(state).filter(s=>s.active).map(seal=>{
      const cells=rules.sealEffectCells(state,seal);
      const gate=seal.range.kind==='linked-block'&&seal.gate&&
        blocks.has(xy(seal.gate))?{x:seal.gate.x,y:seal.gate.y}:null;
      return {...seal,cells:cells.map(p=>({x:p.x,y:p.y})),gate};
    });
    return {seals};
  }
  function focused(plan,focusId){
    return plan?.seals?.find(s=>s.id===focusId)||plan?.seals?.[0]||null;
  }
  function visible(plan,mode='all',focusId=null){
    if(mode==='off'||!plan?.seals?.length)return [];
    if(mode==='focus'){const target=focused(plan,focusId);return target?[target]:[];}
    return plan.seals;
  }
  function groups(plan,mode,focusId){
    const result=new Map();
    for(const seal of visible(plan,mode,focusId)){
      if(seal.range.kind!=='manhattan')continue;
      let group=result.get(seal.kind);
      if(!group){group={kind:seal.kind,color:seal.color,cells:new Map()};result.set(seal.kind,group);}
      // Same-kind auras do not stack mechanically: only paint the union once.
      for(const p of seal.cells)group.cells.set(xy(p),p);
    }
    return [...result.values()];
  }
  function ground(ctx,plan,view,mode='all',focusId=null){
    if(!ctx||!view||mode==='off'||!plan?.seals?.length)return;
    const {ox,oy,cell}=view;
    if(!(cell>0))return;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    for(const group of groups(plan,mode,focusId)){
      const cells=[...group.cells.values()],keys=new Set(group.cells.keys());
      const emphasis=mode==='focus';
      ctx.fillStyle=rgb(group.color,emphasis?.14:.055);
      for(const p of cells){
        ctx.fillRect(ox+p.x*cell+cell*.075,oy+p.y*cell+cell*.075,
          Math.max(0,cell*.85),Math.max(0,cell*.85));
      }
      ctx.strokeStyle=rgb(group.color,emphasis?.9:.55);
      ctx.lineWidth=Math.max(1,Math.min(2.4,cell*(emphasis?.042:.026)));
      ctx.setLineDash(emphasis?[]:[Math.max(2,cell*.12),Math.max(2,cell*.11)]);
      ctx.beginPath();
      const inset=Math.max(1,cell*.075);
      for(const p of cells){
        const x=ox+p.x*cell,y=oy+p.y*cell,x0=x+inset,x1=x+cell-inset,
          y0=y+inset,y1=y+cell-inset;
        if(!keys.has((p.x-1)+','+p.y)){ctx.moveTo(x0,y0);ctx.lineTo(x0,y1);}
        if(!keys.has((p.x+1)+','+p.y)){ctx.moveTo(x1,y0);ctx.lineTo(x1,y1);}
        if(!keys.has(p.x+','+(p.y-1))){ctx.moveTo(x0,y0);ctx.lineTo(x1,y0);}
        if(!keys.has(p.x+','+(p.y+1))){ctx.moveTo(x0,y1);ctx.lineTo(x1,y1);}
      }
      ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
  }
  // Connection details are painted above rock sprites, but before all target
  // previews, red danger contours, creature images and health bars.
  function details(ctx,plan,view,mode='all',focusId=null){
    if(!ctx||!view||mode==='off'||!plan?.seals?.length)return;
    const {ox,oy,cell}=view;
    if(!(cell>0))return;
    const active=visible(plan,mode,focusId),strong=mode==='focus';
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    const warnings=new Set();
    for(const seal of active){
      if(seal.range.kind==='linked-block'&&seal.gate){
        const gate=seal.gate,tx=ox+(gate.x+.5)*cell,ty=oy+(gate.y+.5)*cell,
          sx=ox+(seal.x+.5)*cell,sy=oy+(seal.y+.5)*cell;
        ctx.strokeStyle=rgb(seal.color,strong?.9:.55);
        ctx.lineWidth=Math.max(1.3,Math.min(2.5,cell*.044));
        ctx.setLineDash([Math.max(3,cell*.16),Math.max(3,cell*.16)]);
        ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
        const r=cell*.37;
        ctx.strokeStyle=rgb(seal.color,strong?.94:.78);
        ctx.strokeRect(tx-r,ty-r,2*r,2*r);
        ctx.beginPath();
        for(const [dx,dy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
          const x=tx+dx*r,y=ty+dy*r;
          ctx.moveTo(x-dx*cell*.12,y);ctx.lineTo(x,y);ctx.lineTo(x,y-dy*cell*.12);
        }
        ctx.stroke();
      }else if(seal.range.kind==='warning'){
        for(const tile of seal.cells){
          if(warnings.has(xy(tile)))continue;warnings.add(xy(tile));
          const sx=ox+(seal.x+.5)*cell,sy=oy+(seal.y+.5)*cell,
            tx=ox+(tile.x+.5)*cell,ty=oy+(tile.y+.5)*cell;
          if(strong&&!same(seal,tile)){
            ctx.strokeStyle=rgb(seal.color,.65);
            ctx.lineWidth=Math.max(1,cell*.026);
            ctx.setLineDash([Math.max(2,cell*.12),Math.max(3,cell*.15)]);
            ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
          }
          // Small magenta ticks distinguish the seal warning from beasts'
          // ordinary red attack telegraphs, without recoloring danger cells.
          ctx.strokeStyle=rgb(seal.color,strong?.9:.63);
          ctx.lineWidth=Math.max(1,cell*.035);
          const x=ox+tile.x*cell,y=oy+tile.y*cell;
          ctx.beginPath();
          ctx.moveTo(x+cell*.15,y+cell*.18);
          ctx.lineTo(x+cell*.28,y+cell*.18);
          ctx.moveTo(x+cell*.15,y+cell*.18);
          ctx.lineTo(x+cell*.15,y+cell*.32);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  return Object.freeze({MODES,MODE_LABELS,derive,focused,visible,groups,ground,details});
});
