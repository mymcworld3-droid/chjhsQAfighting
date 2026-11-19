import * as Camera from './dungeon-map-camera.js';

// Stage-6-only deterministic canvas presentation. No gameplay mutations.
export const BIOMES=Object.freeze({
 bamboo:{name:'青竹幽徑',void:'#091711',wall:'#162b20',floor:'#34573d',clearing:'#456a4b',trim:'#b1d89d',line:'#709875',edge:'#203e30'},
 ruins:{name:'殘碑古道',void:'#1b1913',wall:'#312d25',floor:'#6c5944',clearing:'#877050',trim:'#e7c78e',line:'#ab946a',edge:'#493e2e'},
 frost:{name:'霜嶺石窟',void:'#0b1922',wall:'#1a3040',floor:'#3f6579',clearing:'#55859b',trim:'#c4e7f5',line:'#8fbccf',edge:'#28495f'},
 marsh:{name:'雲隱荒澤',void:'#0a1a1b',wall:'#163537',floor:'#316762',clearing:'#448079',trim:'#b1e3cf',line:'#76a8a5',edge:'#22514f'}
});
const partyColors=['#f0cf8a','#9bdcc0','#d8acd9','#f3b5a0'];
export const BEAST_COLORS=Object.freeze({
  wolf:'#f2b67d',wisp:'#80dfc9',golem:'#c9a383',
  guardian:'#edbd6a'
});
const glyphs=Object.freeze({wolf:'◆',wisp:'✦',golem:'⬟',guardian:'♜'});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function hashCell(map,x,y){
  const s=(map.layoutId||map.seed||'v1')+':'+x+','+y;
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0)/4294967296;
}
export function drawWorld(ctx,map,camera,width,height,
  {members=[],selfUid='',showRoutes=false,enemies=[],currentTick=0,
    aimTile=null,visualTimeMs=0,objectives=null}={}){
  const palette=BIOMES[map.biome]||BIOMES.ruins;
  const g=Camera.geometry(camera,map,width,height);
  const v=Camera.visibleTiles(camera,map,width,height);
  const cell=g.cell;
  ctx.fillStyle=palette.void;ctx.fillRect(0,0,width,height);
  const walk=(x,y)=>x>=0&&x<map.width&&y>=0&&y<map.height&&
    map.tiles[y*map.width+x]!==0;
  for(let y=v.y0;y<=v.y1;y++)for(let x=v.x0;x<=v.x1;x++){
    const tile=map.tiles[y*map.width+x],sx=g.ox+x*cell,sy=g.oy+y*cell;
    const noise=hashCell(map,x,y);
    if(tile===0){
      if(!walk(x-1,y)&&!walk(x+1,y)&&!walk(x,y-1)&&!walk(x,y+1))continue;
      ctx.fillStyle=palette.wall;ctx.fillRect(sx,sy,cell+.5,cell+.5);
      const edge=Math.max(1,cell*.13);
      ctx.fillStyle=palette.edge;
      if(walk(x,y-1))ctx.fillRect(sx,sy,cell,edge);
      if(walk(x,y+1))ctx.fillRect(sx,sy+cell-edge,cell,edge);
      if(walk(x-1,y))ctx.fillRect(sx,sy,edge,cell);
      if(walk(x+1,y))ctx.fillRect(sx+cell-edge,sy,edge,cell);
    }else{
      ctx.fillStyle=tile===2?palette.clearing:palette.floor;
      ctx.fillRect(sx,sy,cell+.5,cell+.5);
      if(cell>=6){
        ctx.globalAlpha=.07+noise*.14;ctx.fillStyle=palette.edge;
        ctx.fillRect(sx+cell*(noise>.5?.24:.12),sy+cell*.28,cell*.48,cell*.1);
        ctx.globalAlpha=1;
      }
      if(cell>=12){
        ctx.strokeStyle=palette.line;ctx.globalAlpha=.075;
        ctx.lineWidth=.75;ctx.strokeRect(sx+.5,sy+.5,cell-1,cell-1);
        if(noise>.8){
          ctx.fillStyle=palette.trim;ctx.fillRect(sx+cell*.5,sy+cell*.65,cell*.1,cell*.12);
        }
        ctx.globalAlpha=1;
      }
    }
  }
  if(showRoutes){
    const paintPath=(points,color,alpha)=>{
      if(!Array.isArray(points)||!points.length)return;
      ctx.save();ctx.beginPath();
      points.forEach((p,i)=>{
        const sx=g.ox+(p.x+.5)*cell,sy=g.oy+(p.y+.5)*cell;
        if(i===0)ctx.moveTo(sx,sy);else ctx.lineTo(sx,sy);
      });
      ctx.strokeStyle=color;ctx.globalAlpha=alpha;
      ctx.lineWidth=clamp(cell*.22,1,6);ctx.lineCap='round';ctx.lineJoin='round';
      ctx.stroke();ctx.restore();
    };
    paintPath(map.mainRoute,palette.trim,.62);
    for(const branch of map.branches||[])paintPath(branch.route,palette.line,.55);
  }
  // Stage 13: server-confirmed strike paths briefly gild or cool the FLOOR.
  // These are translucent underlays, not character-covering target masks.
  // No combat geometry or power is derived from browser animation state.
  for(const member of members){
    const skill=member?.lastSkill;
    if(skill?.visualVersion!==1||!Number.isSafeInteger(skill.tick)||
        currentTick<skill.tick||currentTick-skill.tick>1||
        !Array.isArray(skill.effectCells))continue;
    const gold=skill.focusEmpowered===true||skill.focusActivated===true;
    const shimmer=(.18+.07*Math.sin(visualTimeMs/190));
    for(const p of skill.effectCells.slice(0,72)){
      if(!Number.isSafeInteger(p?.x)||!Number.isSafeInteger(p?.y)||
          !walk(p.x,p.y)||p.x<v.x0||p.x>v.x1||p.y<v.y0||p.y>v.y1)continue;
      const x=g.ox+p.x*cell,y=g.oy+p.y*cell;
      ctx.save();
      ctx.fillStyle=gold?'#ffd36d':'#73d9e6';
      ctx.globalAlpha=shimmer;
      ctx.fillRect(x+1,y+1,Math.max(1,cell-2),Math.max(1,cell-2));
      ctx.globalAlpha=.55;
      ctx.lineWidth=clamp(cell*.085,1,2.5);
      ctx.strokeStyle=gold?'#fff0ac':'#b0f1ff';
      ctx.strokeRect(x+1.5,y+1.5,Math.max(1,cell-3),Math.max(1,cell-3));
      ctx.restore();
    }
  }
  // Attack telegraphs are painted after the skill floor trace but below
  // all beast/player sprites, preserving legible red danger outlines.
  // A warning cell never masks the player or overwrites a creature marker.
  for(const beast of enemies){
    const warning=beast?.attack;
    if(!Array.isArray(warning?.cells))continue;
    for(const p of warning.cells){
      if(!walk(p.x,p.y)||p.x<v.x0||p.x>v.x1||p.y<v.y0||p.y>v.y1)continue;
      const x=g.ox+p.x*cell,y=g.oy+p.y*cell;
      ctx.save();
      ctx.fillStyle='rgba(231,74,56,.23)';
      ctx.fillRect(x+.7,y+.7,Math.max(1,cell-1.4),Math.max(1,cell-1.4));
      ctx.strokeStyle='#ff785f';ctx.lineWidth=clamp(cell*.095,1,3);
      ctx.strokeRect(x+1.2,y+1.2,Math.max(1,cell-2.4),Math.max(1,cell-2.4));
      if(cell>=13){
        ctx.fillStyle='#ffe4bb';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.font='bold '+Math.round(clamp(cell*.55,10,18))+'px sans-serif';
        ctx.fillText('!',x+cell*.5,y+cell*.5);
      }
      ctx.restore();
    }
  }
  // Player-selected aim is an outline under every character marker, not a
  // filled overlay that hides the NPC or player on the selected tile.
  if(aimTile&&walk(aimTile.x,aimTile.y)){
    const x=g.ox+aimTile.x*cell,y=g.oy+aimTile.y*cell;
    ctx.save();ctx.strokeStyle='#ffe5a3';
    ctx.lineWidth=clamp(cell*.12,1.5,3);
    ctx.setLineDash([Math.max(3,cell*.25),Math.max(2,cell*.13)]);
    ctx.strokeRect(x+2,y+2,Math.max(1,cell-4),Math.max(1,cell-4));
    ctx.restore();
  }
  function marker(point,label,color,glyph){
    if(!point)return;
    const sx=g.ox+(point.x+.5)*cell,sy=g.oy+(point.y+.5)*cell;
    if(sx<-60||sx>width+60||sy<-60||sy>height+60)return;
    const radius=clamp(cell*.48,5,16);
    ctx.save();
    ctx.beginPath();ctx.arc(sx,sy,radius*1.8,0,Math.PI*2);
    ctx.fillStyle=color;ctx.globalAlpha=.2;ctx.fill();ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(sx,sy,radius*.82,0,Math.PI*2);
    ctx.fillStyle=palette.void;ctx.strokeStyle=color;ctx.lineWidth=1.8;
    ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.font='bold '+Math.round(clamp(radius,10,18))+'px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(glyph,sx,sy);
    if(cell>10){
      ctx.font='600 11px system-ui,"Noto Sans TC"';
      const tw=ctx.measureText(label).width+16;
      const textY=sy-radius-21;
      ctx.fillStyle='rgba(8,18,16,.88)';
      ctx.fillRect(sx-tw/2,textY-10,tw,19);
      ctx.fillStyle=color;ctx.fillText(label,sx,textY);
    }
    ctx.restore();
  }
  if(map.arena==='boss'){
    marker(map.spawn,'隊伍入口','#9edbc9','●');
  }else{
    if(objectives?.guardianStatus==='defeated')
      marker(map.guardianSite,'守鑰已破','#d4b46b','✦');
    else marker(map.guardianSite,'鎮鑰守護區','#e6acaa','◆');
    const portalOpen=objectives?.portalStatus==='open',
      portalReady=objectives?.portalStatus==='ready';
    marker(map.portalSite,
      portalOpen?'首領傳送門':portalReady?'可啟動傳送陣':'封印傳送陣',
      portalOpen?'#b5a5ff':portalReady?'#82e5db':'#8e9e99',
      portalOpen?'✦':'◇');
    marker(map.spawn,'起點','#bde9ab','●');
  }
  // Render hostile creatures beneath player markers so characters remain
  // visible when the AI reaches melee distance (no damage in stage 9).
  for(const enemy of enemies){
    const pos=enemy?.position;
    if(!pos||!walk(pos.x,pos.y))continue;
    const x=g.ox+(pos.x+.5)*cell,y=g.oy+(pos.y+.5)*cell;
    if(x<-35||y<-35||x>width+35||y>height+35)continue;
    const color=BEAST_COLORS[enemy.kind]||'#e5bc9e';
    if(enemy.kind==='boss'){
      // A single 2x2 animated-looking painted beast. All attack cells,
      // players and HP derive from one server entity, never four fake NPCs.
      const left=g.ox+pos.x*cell,top=g.oy+pos.y*cell;
      const w=cell*2,ratio=clamp((enemy.battleHealth||0)/
        Math.max(1,enemy.battleMaxHealth||900),0,1);
      ctx.save();
      ctx.fillStyle='#e9645d';ctx.globalAlpha=.16;
      ctx.fillRect(left-cell*.2,top-cell*.2,w+cell*.4,w+cell*.4);
      ctx.globalAlpha=1;
      ctx.fillStyle='#301a1e';ctx.strokeStyle='#e8b86b';
      ctx.lineWidth=clamp(cell*.10,2,5);
      ctx.fillRect(left+2,top+2,w-4,w-4);
      ctx.strokeRect(left+2,top+2,w-4,w-4);
      ctx.beginPath();ctx.arc(left+w*.5,top+w*.5,w*.37,0,Math.PI*2);
      ctx.fillStyle='#733c34';ctx.fill();
      ctx.fillStyle='#ffe8b2';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='bold '+Math.round(clamp(cell*1.1,18,51))+'px sans-serif';
      ctx.fillText('♜',left+w*.5,top+w*.52);
      const bw=Math.max(28,w*1.12),bx=left+w*.5-bw*.5,by=top-11;
      ctx.fillStyle='#210c12';ctx.fillRect(bx,by,bw,6);
      ctx.fillStyle=ratio>.35?'#f2c979':'#ed7468';
      ctx.fillRect(bx,by,bw*ratio,6);
      ctx.fillStyle='#ffe7c0';ctx.font='bold 12px system-ui,"Noto Sans TC"';
      const label=String(enemy.name||'首領').slice(0,15);
      const tw=ctx.measureText(label).width+14;
      ctx.fillStyle='#231016ee';ctx.fillRect(left+w*.5-tw/2,by-22,tw,18);
      ctx.fillStyle='#ffe7c0';ctx.fillText(label,left+w*.5,by-13);
      ctx.restore();continue;
    }
    const alerted=enemy.intent==='pursuit'||enemy.intent==='alert';
    const guardian=enemy.kind==='guardian';
    const r=clamp(cell*(guardian?.47:.35),guardian?6:4,guardian?17:12);
    ctx.save();
    ctx.beginPath();ctx.arc(x,y,r*1.55,0,Math.PI*2);
    ctx.globalAlpha=alerted?.25:.14;
    ctx.fillStyle=alerted?'#f47b76':color;ctx.fill();ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle='#231d19';ctx.strokeStyle=alerted?'#ff8f78':color;
    ctx.lineWidth=alerted?2.6:1.8;ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold '+Math.round(clamp(r*1.4,10,18))+'px sans-serif';
    ctx.fillText(glyphs[enemy.kind]||'◆',x,y);
    if(cell>=14){
      const max=Number.isSafeInteger(enemy.battleMaxHealth)?enemy.battleMaxHealth:60;
      const hp=Number.isSafeInteger(enemy.battleHealth)?enemy.battleHealth:max;
      const ratio=clamp(hp/Math.max(1,max),0,1),bar=clamp(cell*.85,15,29);
      ctx.fillStyle='#331d1a';ctx.fillRect(x-bar/2,y-r-13,bar,3);
      ctx.fillStyle=ratio>.4?'#e9b76a':'#ed7c6e';
      ctx.fillRect(x-bar/2,y-r-13,bar*ratio,3);
      ctx.fillStyle='#fff2d4';ctx.font='600 10px system-ui,"Noto Sans TC"';
      const label=String(enemy.name||'靈獸').slice(0,12);
      const tw=ctx.measureText(label).width+10;
      ctx.fillStyle='rgba(14,16,15,.86)';
      ctx.fillRect(x-tw/2,y-r-24,tw,17);
      ctx.fillStyle=alerted?'#ffc0ad':'#f2e2c2';
      ctx.fillText(label,x,y-r-15);
    }
    ctx.restore();
  }
  members.slice(0,4).forEach((member,index)=>{
    const validPos=member?.position&&Number.isInteger(member.position.x)&&
      Number.isInteger(member.position.y)&&member.position.x>=0&&
      member.position.y>=0&&member.position.x<map.width&&
      member.position.y<map.height&&
      map.tiles[member.position.y*map.width+member.position.x]!==0;
    const point=validPos?member.position:map.spawnPads[index];
    if(!point)return;
    // Players may cross or share a tile. Offset markers locally rather than
    // inventing a server collision with teammates.
    const occupancy=members.slice(0,4).filter((other,j)=>{
      const q=other.position||map.spawnPads[j];
      return q?.x===point.x&&q?.y===point.y;
    });
    const slot=Math.max(0,occupancy.findIndex(other=>other.uid===member.uid));
    const offset=occupancy.length>1?(.22*cell):0;
    const sx=g.ox+(point.x+.5)*cell+offset*(slot%2?1:-1),
      sy=g.oy+(point.y+.5)*cell+offset*(slot>=2?1:-1);
    const radius=clamp(cell*.26,3,9);
    ctx.beginPath();ctx.arc(sx,sy,radius,0,Math.PI*2);
    ctx.fillStyle=partyColors[index];ctx.fill();
    ctx.strokeStyle=palette.void;ctx.lineWidth=1.5;ctx.stroke();
    if(member.uid===selfUid){
      ctx.beginPath();ctx.arc(sx,sy,radius+3,0,Math.PI*2);
      ctx.strokeStyle='#fff5d1';ctx.lineWidth=1.5;ctx.stroke();
    }
    const hp=Number.isSafeInteger(member.battleHealth)?
      Math.max(0,Math.min(100,member.battleHealth)):100;
    if(member.downed||hp===0){
      ctx.save();ctx.strokeStyle='#f3aaa2';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(sx-radius*.56,sy-radius*.56);
      ctx.lineTo(sx+radius*.56,sy+radius*.56);
      ctx.moveTo(sx+radius*.56,sy-radius*.56);
      ctx.lineTo(sx-radius*.56,sy+radius*.56);ctx.stroke();ctx.restore();
    }
    if(cell>=12){
      const barW=clamp(cell*.85,13,27),barH=3;
      ctx.fillStyle='#251e1a';
      ctx.fillRect(sx-barW/2,sy-radius-10,barW,barH);
      ctx.fillStyle=hp>50?'#81da91':hp>25?'#e2b966':'#ed8d81';
      ctx.fillRect(sx-barW/2,sy-radius-10,barW*hp/100,barH);
      if(member.lastDamage&&Number.isSafeInteger(currentTick)&&
        currentTick-member.lastDamage.tick>=0&&
        currentTick-member.lastDamage.tick<=2){
        ctx.save();ctx.fillStyle='#ffd0b4';ctx.textAlign='center';
        ctx.textBaseline='middle';ctx.font='bold 11px system-ui';
        ctx.fillText('-'+member.lastDamage.amount,sx,sy-radius-23);
        ctx.restore();
      }
    }
  });
  const shadow=ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.2,
    width/2,height/2,Math.max(width,height)*.78);
  shadow.addColorStop(0,'rgba(0,0,0,0)');shadow.addColorStop(1,'rgba(0,0,0,.43)');
  ctx.fillStyle=shadow;ctx.fillRect(0,0,width,height);
  return g;
}
export function drawMinimap(ctx,map,geometry,width,height,
  {members=[],selfUid='',enemies=[],objectives=null}={}){
  const p=BIOMES[map.biome]||BIOMES.ruins;
  ctx.fillStyle=p.void;ctx.fillRect(0,0,width,height);
  const scale=Math.min((width-10)/map.width,(height-10)/map.height);
  const ox=(width-map.width*scale)/2,oy=(height-map.height*scale)/2;
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
    const tile=map.tiles[y*map.width+x];
    if(tile!==0){
      ctx.fillStyle=tile===2?p.clearing:p.floor;
      ctx.fillRect(ox+x*scale,oy+y*scale,scale+.3,scale+.3);
    }
  }
  // Draw warning tiles below player and NPC minimap pins.
  for(const enemy of enemies){
    for(const tile of enemy?.attack?.cells||[]){
      if(tile.x<0||tile.y<0||tile.x>=map.width||tile.y>=map.height||
        map.tiles[tile.y*map.width+tile.x]===0)continue;
      ctx.fillStyle='rgba(253,111,82,.7)';
      ctx.fillRect(ox+tile.x*scale,oy+tile.y*scale,
        Math.max(scale,1.5),Math.max(scale,1.5));
    }
  }
  const portalColor=objectives?.portalStatus==='open'?'#c2b1ff':
    objectives?.portalStatus==='ready'?'#74e4d1':'#899a95';
  for(const [point,color] of (map.arena==='boss'?
    [[map.spawn,'#bde9ab']]:
    [[map.spawn,'#bde9ab'],[map.guardianSite,'#e6acaa'],
      [map.portalSite,portalColor]])){
    if(!point)continue;
    ctx.fillStyle=color;ctx.beginPath();
    ctx.arc(ox+(point.x+.5)*scale,oy+(point.y+.5)*scale,Math.max(2,scale),0,Math.PI*2);
    ctx.fill();
  }
  // Tiny hostile markers use the same server positions as the main map.
  for(const enemy of enemies){
    const pos=enemy?.position;
    if(!pos||pos.x<0||pos.y<0||pos.x>=map.width||pos.y>=map.height||
       map.tiles[pos.y*map.width+pos.x]===0)continue;
    ctx.fillStyle=enemy.intent==='pursuit'?'#fa8076':
      BEAST_COLORS[enemy.kind]||'#e1a989';
    if(enemy.kind==='boss'){
      ctx.fillRect(ox+pos.x*scale,oy+pos.y*scale,
        Math.max(3,scale*2),Math.max(3,scale*2));
    }else{
      ctx.beginPath();
      ctx.arc(ox+(pos.x+.5)*scale,oy+(pos.y+.5)*scale,
        Math.max(1.6,scale*.7),0,Math.PI*2);
      ctx.fill();
    }
  }
  // Team positions are drawn from authoritative member snapshots.
  members.slice(0,4).forEach((member,index)=>{
    const position=member.position||map.spawnPads[index];
    if(!position||position.x<0||position.y<0||position.x>=map.width||
       position.y>=map.height||map.tiles[position.y*map.width+position.x]===0)return;
    const x=ox+(position.x+.5)*scale,y=oy+(position.y+.5)*scale;
    if(Number.isSafeInteger(member.focusCharges)&&member.focusCharges>0&&
        !member.downed&&Number(member.battleHealth)!==0){
      ctx.save();ctx.strokeStyle='#ffe18a';ctx.lineWidth=Math.max(1,scale*.33);
      ctx.beginPath();ctx.arc(x,y,Math.max(3,scale*1.7),0,Math.PI*2);
      ctx.stroke();ctx.restore();
    }
    ctx.fillStyle=partyColors[index];ctx.beginPath();
    ctx.arc(x,y,Math.max(1.6,member.uid===selfUid?scale*.95:scale*.7),
      0,Math.PI*2);ctx.fill();
  });
  const x0=clamp((-geometry.ox)/geometry.cell,0,map.width);
  const y0=clamp((-geometry.oy)/geometry.cell,0,map.height);
  const x1=clamp((geometry.width-geometry.ox)/geometry.cell,0,map.width);
  const y1=clamp((geometry.height-geometry.oy)/geometry.cell,0,map.height);
  ctx.strokeStyle=p.trim;ctx.lineWidth=1.2;
  ctx.strokeRect(ox+x0*scale,oy+y0*scale,Math.max(.3,(x1-x0)*scale),
    Math.max(.3,(y1-y0)*scale));
}
