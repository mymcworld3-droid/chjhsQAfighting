/* Read-only PvE telegraphs. Server intents are the sole source of danger.
 * Visual safety means "outside currently announced attack/hazard cells",
 * NOT a guarantee about future enemy movement or unannounced mechanics.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QATacticalThreats=api;
})(globalThis,()=>{
  'use strict';
  const K=p=>p.x+','+p.y;
  const inside=(s,p)=>Number.isInteger(p?.x)&&Number.isInteger(p?.y)&&
    p.x>=0&&p.y>=0&&p.x<s.width&&p.y<s.height;
  const attacks=new Set(['attack','boss-attack','defense-attack','strike']);
  const viable=a=>a?.hp>0;
  const same=(a,b)=>Number(a?.x)===Number(b?.x)&&Number(a?.y)===Number(b?.y);
  function derive(state,uid,mode='move',movement=[]){
    const empty={cells:[],byKey:Object.create(null),playerThreatened:false,
      attackers:0,landingHints:[],player:null,description:''};
    if(!state||state.mode!=='pve')return empty;
    const player=state.actors?.find(a=>a.uid===uid);
    if(!player)return empty;
    const byKey=Object.create(null);
    let attackers=0;
    const add=(p,source,boss=false)=>{
      if(!inside(state,p))return;
      const key=K(p);
      let record=byKey[key];
      if(!record){record={x:p.x,y:p.y,attackers:[],boss:false,hazard:false};byKey[key]=record;}
      if(source==='hazard')record.hazard=true;
      else if(!record.attackers.includes(source))record.attackers.push(source);
      if(boss)record.boss=true;
    };
    for(const actor of state.actors||[]){
      if(!actor.bot||!viable(actor)||!attacks.has(actor.intent?.kind))continue;
      const intent=actor.intent;
      // Pushed/teleported enemies cannot execute stale locked-origin attacks.
      if(intent.origin&&!same(intent.origin,actor))continue;
      const cells=(intent.cells||[]).filter(p=>inside(state,p));
      if(!cells.length)continue;
      attackers++;
      for(const p of cells)add(p,String(actor.uid),!!actor.boss);
    }
    for(const hazard of state.objective?.hazards||[])add(hazard,'hazard');
    const cells=Object.values(byKey).sort((a,b)=>a.y-b.y||a.x-b.x);
    const playerThreatened=cells.some(p=>p.x>=player.x&&p.y>=player.y&&
      p.x<player.x+(player.footprint?.width||1)&&p.y<player.y+(player.footprint?.height||1));
    const landingHints=[];
    if(playerThreatened&&mode==='move'&&state.status==='active'&&state.turnUid===uid){
      // Only already-reachable cells are considered; don't suggest a path
      // across obstacles or promise the tile is safe beyond current telegraphs.
      const candidate=(movement||[]).filter(p=>inside(state,p)&&!byKey[K(p)])
        .sort((a,b)=>(a.cost??999)-(b.cost??999)||Math.abs(a.y-player.y)-Math.abs(b.y-player.y)||
          a.y-b.y||a.x-b.x);
      for(const p of candidate){
        if(landingHints.length===2)break;
        // Two different directions give genuine alternatives rather than
        // two adjacent labels for essentially the same tile.
        const dx=Math.sign(p.x-player.x),dy=Math.sign(p.y-player.y);
        if(landingHints.some(q=>Math.sign(q.x-player.x)===dx&&
          Math.sign(q.y-player.y)===dy))continue;
        landingHints.push({x:p.x,y:p.y,cost:p.cost});
      }
    }
    const count=byKey[K(player)]?.attackers.length||0;
    const danger=cells.length;
    const description=danger?
      '目前有 '+danger+' 個預告危險格'+
      (playerThreatened?'；你所在的地格受到攻擊或場地危險預告':
        '；目前所在位置沒有被標記')+
      (count?'；其中 '+count+' 隻靈獸鎖定你的地格':'')+
      (landingHints.length?'；青綠色標記僅表示能避開當前預告':''):
      '目前沒有已標示的敵方攻擊預告';
    return {cells,byKey,playerThreatened,attackers,landingHints,
      player:{x:player.x,y:player.y},description};
  }
  const point=(p,v)=>({x:v.ox+(p.x+.5)*v.cell,y:v.oy+(p.y+.5)*v.cell});
  function drawGround(ctx,plan,view){
    if(!ctx||!plan?.cells?.length||!view)return;
    const {ox,oy,cell}=view;
    ctx.save();
    ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    for(const p of plan.cells){
      const x=ox+p.x*cell,y=oy+p.y*cell;
      ctx.fillStyle=p.boss?'rgba(180,63,45,.17)':
        p.hazard?'rgba(178,92,36,.18)':'rgba(204,60,45,.15)';
      ctx.fillRect(x+1,y+1,Math.max(0,cell-2),Math.max(0,cell-2));
      // Short diagonal markings are readable without red/green discrimination.
      ctx.save();ctx.lineWidth=Math.max(.85,Math.min(2,cell*.025));
      ctx.strokeStyle=p.boss?'rgba(255,193,137,.74)':'rgba(246,164,136,.63)';
      for(let k=0;k<3;k++){
        const o=cell*(.13+k*.075);
        ctx.beginPath();ctx.moveTo(x+o,y+cell*.07);
        ctx.lineTo(x+cell*.07,y+o);ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function drawContours(ctx,plan,view){
    if(!ctx||!plan?.cells?.length||!view)return;
    const {ox,oy,cell}=view;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    const inset=Math.max(1.5,cell*.043);
    for(const p of plan.cells){
      const x=ox+p.x*cell,y=oy+p.y*cell;
      ctx.strokeStyle=p.boss?'#ffc69b':p.hazard?'#ffe0a1':'#f5a28b';
      ctx.lineWidth=p.boss?Math.max(2.1,cell*.049):Math.max(1.35,cell*.035);
      const border=(n,dir)=>{
        const c=plan.byKey[(p.x+(dir==='x'?n:0))+','+(p.y+(dir==='y'?n:0))];
        return !c;
      };
      ctx.beginPath();
      const x0=x+inset,y0=y+inset,x1=x+cell-inset,y1=y+cell-inset;
      if(border(-1,'y')){ctx.moveTo(x0,y0);ctx.lineTo(x1,y0);}
      if(border(1,'y')){ctx.moveTo(x0,y1);ctx.lineTo(x1,y1);}
      if(border(-1,'x')){ctx.moveTo(x0,y0);ctx.lineTo(x0,y1);}
      if(border(1,'x')){ctx.moveTo(x1,y0);ctx.lineTo(x1,y1);}
      ctx.stroke();
      // Multiple attackers are indicated with two white ticks, not a
      // possibly misleading numeric damage estimate.
      if(p.attackers.length>1&&cell>=28){
        ctx.fillStyle='#fff1da';
        ctx.fillRect(x+cell*.61,y+cell*.13,Math.max(1,cell*.045),cell*.19);
        ctx.fillRect(x+cell*.72,y+cell*.13,Math.max(1,cell*.045),cell*.19);
      }
    }
    ctx.restore();
  }
  function drawGuidance(ctx,plan,view,reduced=false){
    if(!ctx||!plan?.playerThreatened||!plan.player||!view)return;
    const {ox,oy,cell}=view;
    ctx.save();ctx.beginPath();ctx.rect(ox,oy,view.width*cell,view.height*cell);ctx.clip();
    // A single compact danger icon is anchored to the hero's grid, not to
    // the sprite, and remains static when reduced-motion mode is enabled.
    const x=ox+plan.player.x*cell,y=oy+plan.player.y*cell;
    const radius=Math.max(7,Math.min(12,cell*.23));
    const tx=x+cell*.73,ty=y+cell*.18;
    ctx.fillStyle='rgba(63,26,20,.94)';ctx.strokeStyle='#ffcc9c';
    ctx.lineWidth=Math.max(1.1,cell*.025);
    ctx.beginPath();ctx.arc(tx,ty,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff2d8';ctx.font='bold '+Math.round(radius*1.45)+'px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('!',tx,ty+radius*.1);
    for(const p of plan.landingHints){
      const pt=point(p,view),r=Math.min(11,cell*.21);
      ctx.strokeStyle='#a5e5c8';ctx.fillStyle='rgba(18,70,53,.65)';
      ctx.lineWidth=Math.max(1.4,cell*.038);
      ctx.beginPath();ctx.arc(pt.x,pt.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(pt.x-r*.42,pt.y);
      ctx.lineTo(pt.x-r*.06,pt.y+r*.36);
      ctx.lineTo(pt.x+r*.47,pt.y-r*.36);ctx.stroke();
    }
    ctx.restore();
  }
  return Object.freeze({derive,drawGround,drawContours,drawGuidance});
});
