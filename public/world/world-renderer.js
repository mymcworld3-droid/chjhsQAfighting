import './world-core.js';
const BaseWorld=globalThis.QAGridWorld, TILE=40;
const colors=BaseWorld.COLORS;
export class WorldRenderer {
  constructor(canvas,mini,onPick){
    this.world=BaseWorld.createWorld();const W=this.world;
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.mini=mini;this.onPick=onPick;
    this.camera={x:W.SPAWN.x+.5,y:W.SPAWN.y+.5,zoom:1,follow:true};this.data={};this.pointers=new Map();this.active=false;
    this.effects=[];this.images={};for(const [id,url]of Object.entries({grass:'/assets/world-map/terrain/grass.webp',male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'})){
      const img=new Image();img.src=url;this.images[id]=img;
    }
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
    this.resize();this.bind();
  }
  resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;this.dpr=Math.min(2,devicePixelRatio||1);
    this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr);}
  set(data){
    const previous=this.data.state?.battle,next=data.state?.battle,at=Date.now();
    if(previous?.id===next?.id&&previous?.revision!==next?.revision){
      for(const enemy of next.enemies){const before=previous.enemies.find(e=>e.id===enemy.id);if(before&&before.hp>enemy.hp)this.effects.push({x:enemy.x,y:enemy.y,text:'−'+(before.hp-enemy.hp),color:'#ffe1ac',at});}
      if(previous.player.hp!==next.player.hp){const heal=next.player.hp>previous.player.hp;this.effects.push({x:next.player.x,y:next.player.y,text:(heal?'+':'−')+Math.abs(next.player.hp-previous.player.hp),color:heal?'#c5f6ac':'#ffc09b',at});}
      if(previous.meteors?.length&&!next.meteors.length)for(const mark of previous.meteors)this.effects.push({...mark,meteor:true,at});
    }
    this.data={...this.data,...data};
  }
  start(){if(this.active)return;this.active=true;const frame=()=>{if(!this.active)return;this.draw();this.frame=requestAnimationFrame(frame);};frame();}
  stop(){this.active=false;cancelAnimationFrame(this.frame);}
  destroy(){this.stop();this.resizeObserver.disconnect();}
  center(){this.camera.follow=true;}
  zoom(amount){this.camera.zoom=Math.max(.65,Math.min(1.8,this.camera.zoom*amount));}
  worldPoint(clientX,clientY){const r=this.canvas.getBoundingClientRect(),s=TILE*this.camera.zoom;
    return {x:(clientX-r.left-this.width/2)/s+this.camera.x,y:(clientY-r.top-this.height/2)/s+this.camera.y};}
  bind(){
    const W=this.world;
    const c=this.canvas;
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
      if(this.pointers.size===2){const[p,q]=[...this.pointers.values()];this.pinch=Math.hypot(p.x-q.x,p.y-q.y);this.drag.moved=true;}});
    c.addEventListener('pointermove',e=>{
      if(!this.pointers.has(e.pointerId))return;this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size===2){const[p,q]=[...this.pointers.values()],d=Math.hypot(p.x-q.x,p.y-q.y);if(this.pinch)this.zoom(d/this.pinch);this.pinch=d;this.camera.follow=false;return;}
      if(!this.drag)return;
      const d=this.drag;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)d.moved=true;
      if(d.moved){const s=TILE*this.camera.zoom;this.camera.follow=false;this.camera.x-=(e.clientX-d.lastX)/s;this.camera.y-=(e.clientY-d.lastY)/s;this.clampCamera();}
      d.lastX=e.clientX;d.lastY=e.clientY;
    });
    const end=e=>{const click=this.drag&&!this.drag.moved&&this.pointers.size===1&&e.type!=='pointercancel';
      this.pointers.delete(e.pointerId);this.pinch=null;if(click){const p=this.worldPoint(e.clientX,e.clientY);this.onPick({x:Math.floor(p.x),y:Math.floor(p.y)});}this.drag=null;};
    c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);
    c.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?.92:1.08);},{passive:false});
    c.addEventListener('keydown',e=>{
      const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
      if(dirs[e.key]){e.preventDefault();const p=this.data.cursor||this.data.state?.position||W.SPAWN,[dx,dy]=dirs[e.key];
        const target={x:Math.max(0,Math.min(this.world.SIZE-1,p.x+dx)),y:Math.max(0,Math.min(this.world.SIZE-1,p.y+dy))};this.data.cursor=target;
        this.canvas.setAttribute('aria-label','大世界地圖，選取地格 '+target.x+'，'+target.y+'。按 Enter 前往或互動。');
      }else if(e.key==='Enter'&&this.data.cursor){e.preventDefault();this.onPick(this.data.cursor);}
    });
    this.mini.addEventListener('click',e=>{const r=this.mini.getBoundingClientRect();this.camera.follow=false;this.camera.x=(this.miniOrigin?.x||0)+(e.clientX-r.left)/r.width*96;this.camera.y=(this.miniOrigin?.y||0)+(e.clientY-r.top)/r.height*96;this.clampCamera();});
  }
  clampCamera(){this.camera.x=Math.max(0,Math.min(this.world.SIZE,this.camera.x));this.camera.y=Math.max(0,Math.min(this.world.SIZE,this.camera.y));}
  label(text,x,y,color='#fff3d6',size=11){const c=this.ctx;c.font=`600 ${size}px "Noto Sans TC",sans-serif`;c.textAlign='center';c.lineWidth=3;c.strokeStyle='#1b2a23cc';c.strokeText(text,x,y);c.fillStyle=color;c.fillText(text,x,y);}
  tile(x,y,t,at){
    const W=this.world;
    const c=this.ctx,px=x*TILE,py=y*TILE,h=W.hash(x,y);c.fillStyle=colors[t]||colors.grass;c.fillRect(px,py,TILE,TILE);
    const grass=this.images.grass;if((t==='grass'||t==='bamboo')&&grass.complete&&grass.naturalWidth){c.save();c.globalAlpha=t==='bamboo'?.65:.83;c.drawImage(grass,px,py,TILE,TILE);c.restore();}
    if(t==='road'||t==='courtyard'){c.strokeStyle='#6e6b5527';c.lineWidth=1;c.strokeRect(px+.5,py+.5,39,39);
      if(t==='courtyard'){c.beginPath();c.moveTo(px,py+20);c.lineTo(px+40,py+20);c.moveTo(px+20,py);c.lineTo(px+20,py+40);c.stroke();}
      else{c.fillStyle='#7c795a44';c.fillRect(px+7+h%13,py+7,3,2);c.fillRect(px+9,py+25+h%5,2,2);}}
    if(t==='water'||t==='ocean'||t==='broken-bridge'){
      c.strokeStyle='#aed2c16a';c.beginPath();const wave=Math.sin(at/1700+x+y)*3;c.moveTo(px+8+wave,py+12);c.lineTo(px+25+wave,py+12);c.moveTo(px+19-wave,py+28);c.lineTo(px+33-wave,py+28);c.stroke();
    }
    if(t==='desert'){c.strokeStyle='#e4ca9255';c.beginPath();c.ellipse(px+15+h%9,py+23,15,4,0,Math.PI,Math.PI*2);c.stroke();}
    if(t==='stone'||t==='volcano'||t==='lava'){
      c.strokeStyle=t==='lava'?'#ffd181':t==='volcano'?'#c06c4680':'#5f5c535e';c.lineWidth=t==='lava'?2:1;c.beginPath();c.moveTo(px+5,py+8+h%7);c.lineTo(px+19,py+20);c.lineTo(px+30,py+12);c.moveTo(px+19,py+20);c.lineTo(px+24,py+36);c.stroke();
    }
    if(t==='bridge'||t==='broken-bridge'){
      c.fillStyle=t==='bridge'?'#b3986c':'#756e54';c.fillRect(px,py+7,t==='bridge'?40:14,27);
      if(t==='broken-bridge')c.fillRect(px+31,py+7,9,27);
      c.strokeStyle='#685b3b';for(let n=0;n<5;n++){c.beginPath();c.moveTo(px+n*9,py+7);c.lineTo(px+n*9,py+34);c.stroke();}
    }
    c.strokeStyle='#223d2718';c.strokeRect(px+.5,py+.5,39,39);
    if(t==='sealed'){c.strokeStyle='#c5d9b9';c.lineWidth=2;c.strokeRect(px+5,py+5,30,30);this.label('封',px+20,py+24,'#e4e9bf',15);}
    const dx=x-W.SPAWN.x,dy=y-W.SPAWN.y,r=W.CITY_RADIUS;
    if((Math.abs(dx)===r&&Math.abs(dy)<=r&&Math.abs(dy)>1)||(Math.abs(dy)===r&&Math.abs(dx)<=r&&Math.abs(dx)>1)){
      c.strokeStyle='#777460';c.lineWidth=5;c.beginPath();
      if(Math.abs(dx)===r){const edge=px+(dx>0?38:2);c.moveTo(edge,py);c.lineTo(edge,py+40);}
      if(Math.abs(dy)===r){const edge=py+(dy>0?38:2);c.moveTo(px,edge);c.lineTo(px+40,edge);}c.stroke();
    }
  }
  decoration(x,y,t){
    const c=this.ctx,px=(x+.5)*TILE,py=(y+.65)*TILE;
    if(t==='bamboo'){
      c.fillStyle='#1d3f2433';c.beginPath();c.ellipse(px,py+4,17,7,0,0,Math.PI*2);c.fill();
      for(const d of [-8,5]){c.strokeStyle='#365b32';c.lineWidth=4;c.beginPath();c.moveTo(px+d,py);c.lineTo(px+d+2,py-36);c.stroke();
        c.strokeStyle='#a1bd6a';c.lineWidth=1;for(let k=0;k<3;k++){c.beginPath();c.moveTo(px+d-2,py-k*11);c.lineTo(px+d+4,py-k*11);c.stroke();}
        c.fillStyle='#2f633c';for(const [dx,dy]of [[-10,-15],[6,-25],[-7,-33]]){c.beginPath();c.ellipse(px+d+dx,py+dy,11,4,dx>0?-.6:.6,0,Math.PI*2);c.fill();}}
    }else if(t==='forest'){
      c.fillStyle='#27442c44';c.beginPath();c.ellipse(px,py+4,17,7,0,0,7);c.fill();c.fillStyle='#65513b';c.fillRect(px-3,py-24,6,27);
      for(const[dx,dy,r]of [[-8,-24,11],[7,-26,12],[0,-36,12]]){c.fillStyle=dy<-30?'#5e8650':'#3c7046';c.beginPath();c.arc(px+dx,py+dy,r,0,7);c.fill();}
    }else if(t==='volcano'){
      c.fillStyle='#443d3c';c.beginPath();c.moveTo(px-16,py+3);c.lineTo(px-6,py-22);c.lineTo(px+6,py-22);c.lineTo(px+17,py+3);c.closePath();c.fill();c.fillStyle='#d87a43';c.beginPath();c.ellipse(px,py-22,6,3,0,0,7);c.fill();
    }else if(t==='rock'){
      c.fillStyle='#45564b55';c.beginPath();c.ellipse(px,py+3,17,8,0,0,7);c.fill();c.fillStyle='#a3ad99';c.beginPath();c.moveTo(px-16,py);c.lineTo(px-10,py-18);c.lineTo(px+3,py-23);c.lineTo(px+16,py-9);c.lineTo(px+11,py+4);c.closePath();c.fill();
      c.fillStyle='#73816d';c.beginPath();c.moveTo(px+3,py-23);c.lineTo(px+1,py-5);c.lineTo(px+11,py+4);c.lineTo(px+16,py-9);c.fill();
    }
  }
  object(o,claimed){
    const c=this.ctx,x=(o.x+.5)*TILE,y=(o.y+.5)*TILE;
    c.save();if(claimed)c.globalAlpha=.45;
    c.fillStyle='#152c2633';c.beginPath();c.ellipse(x,y+6,o.kind==='building'?28:15,8,0,0,7);c.fill();
    if(['building','realm','structure'].includes(o.kind)){
      c.fillStyle='#e4d8b4';c.fillRect(x-19,y-21,38,25);c.fillStyle='#5e5845';c.fillRect(x-5,y-11,10,15);
      c.fillStyle='#3c615a';c.beginPath();c.moveTo(x-29,y-22);c.lineTo(x-10,y-36);c.lineTo(x+11,y-36);c.lineTo(x+29,y-22);c.lineTo(x+21,y-19);c.lineTo(x-21,y-19);c.closePath();c.fill();
      c.strokeStyle='#ceb879';c.lineWidth=2;c.stroke();this.label(o.icon,x,y-23,'#f9e6a8',12);
    }else{
      const fill=o.veinId?'#bca362':{gather:'#a9d281',chest:'#d4aa51',monster:'#8c6453',npc:'#83a9a0',event:'#7e98b5'}[o.kind];
      c.fillStyle=fill;c.strokeStyle='#ece0b1';c.lineWidth=1.5;c.beginPath();
      if(o.kind==='chest'){c.roundRect(x-12,y-15,24,19,3);}else{c.arc(x,y-7,13,0,7);}c.fill();c.stroke();
      this.label(o.icon,x,y-3,'#fff5da',13);
    }
    if(!o.veinId||o.veinAnchor)this.label(o.name+(o.level?' · '+o.level+'級':''),x,y+(o.kind==='building'?20:18),claimed?'#c9d3be':o.kind==='monster'?'#ffe2be':'#fff5d5',10);c.restore();
  }
  sprite(actor,pos,at,self=false,showName=true){
    const c=this.ctx,x=(pos.x+.5)*TILE,y=(pos.y+.5)*TILE,img=this.images[actor.gender||'male'];
    c.fillStyle=self?'#192f276b':'#192f2744';c.beginPath();c.ellipse(x,y,11,5,0,0,7);c.fill();
    if(actor.travelMode==='sail'){c.fillStyle='#866640';c.strokeStyle='#ddc389';c.lineWidth=1.5;c.beginPath();c.ellipse(x,y+1,22,9,0,0,Math.PI*2);c.fill();c.stroke();}
    if(self){c.strokeStyle='#ffe6a5';c.lineWidth=1.4;c.beginPath();c.ellipse(x,y+1,15,7,0,0,7);c.stroke();}
    const direction=pos.moving||actor.route?.path?.length>1?pos.direction:actor.direction||'down',row=['down','right','left','up'].indexOf(direction);
    const frame=pos.moving?[1,2,3,0][Math.floor((at-(actor.route?.startedAtMs||0))/130)%4]:0;
    if(img.complete&&img.naturalWidth)c.drawImage(img,frame*112,Math.max(0,row)*112,112,112,x-28,y-52,56,56);
    else{c.fillStyle='#ece6d1';c.beginPath();c.arc(x,y-15,10,0,7);c.fill();}
    if(showName)this.label(actor.name+(actor.stack>1?' · '+actor.stack+'人':''),x,y-53,self?'#ffe3a0':'#e7f2df',10);
    if(showName&&actor.status==='battle')this.label('交戰中',x,y+16,'#ffc9a4',10);
  }
  overlayCell(p,fill,stroke){const c=this.ctx;c.fillStyle=fill;c.fillRect(p.x*TILE+1,p.y*TILE+1,38,38);if(stroke){c.strokeStyle=stroke;c.lineWidth=1.4;c.strokeRect(p.x*TILE+2,p.y*TILE+2,36,36);}}
  route(path){if(!path?.length)return;const c=this.ctx;c.strokeStyle='#fff0b4';c.lineWidth=3;c.setLineDash([3,5]);c.beginPath();path.forEach((p,i)=>c[i?'lineTo':'moveTo']((p.x+.5)*TILE,(p.y+.5)*TILE));c.stroke();c.setLineDash([]);
    const last=path.at(-1);this.overlayCell(last,'#f3d37730','#fff1b0');}
  draw(){
    const W=this.world;
    if(!this.width||!this.data.state)return;const d=this.data,b=d.state.battle?.status==='active'?d.state.battle:null,at=Date.now()+(d.clockOffset||0),c=this.ctx;
    const mine=d.players?.find(p=>p.uid===d.uid)||d.self,pos=b?{...b.player,moving:false}:W.sample(mine?.route,at);
    if(this.camera.follow){this.camera.x=b?b.bounds.x+4:pos.x+.5;this.camera.y=b?b.bounds.y+4:pos.y+.5;}
    const zoom=b?Math.max(.55,Math.min(1.4,(this.width-28)/320,(this.height-80)/320)):this.camera.zoom,s=TILE*zoom;
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#253b31';c.fillRect(0,0,this.width,this.height);
    c.translate(this.width/2,this.height/2);c.scale(zoom,zoom);c.translate(-this.camera.x*TILE,-this.camera.y*TILE);
    // Keep hit testing on the same battle zoom as rendering.
    if(b)this.camera.zoom=zoom;
    const left=Math.max(0,Math.floor(this.camera.x-this.width/s/2)-1),right=Math.min(this.world.SIZE-1,Math.ceil(this.camera.x+this.width/s/2)+1),
      top=Math.max(0,Math.floor(this.camera.y-this.height/s/2)-2),bottom=Math.min(this.world.SIZE-1,Math.ceil(this.camera.y+this.height/s/2)+2),decor=[];
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const discovered=W.known(d.state.explored,x,y)||b&&x>=b.bounds.x&&x<b.bounds.x+8&&y>=b.bounds.y&&y<b.bounds.y+8;
      if(!discovered){c.fillStyle=W.hash(x,y)%3===0?'#34483c':'#304438';c.fillRect(x*TILE,y*TILE,40,40);continue;}
      const t=W.terrain(x,y,b?.events||d.events);this.tile(x,y,t,at);if(['bamboo','rock'].includes(t)||t==='forest'&&W.hash(x,y)%3===0||t==='volcano'&&W.hash(x,y)%11===0)decor.push({y:y+.65,draw:()=>this.decoration(x,y,t)});
      if(b&&(x<b.bounds.x||x>=b.bounds.x+8||y<b.bounds.y||y>=b.bounds.y+8)){c.fillStyle='#11221ac9';c.fillRect(x*40,y*40,40,40);}
    }
    if(!b&&W.known(d.state.explored,W.SPAWN.x,W.SPAWN.y)&&Math.abs(this.camera.x-W.SPAWN.x)<30&&Math.abs(this.camera.y-W.SPAWN.y)<30)this.label('問 道 宗',(W.SPAWN.x+.5)*TILE,(W.SPAWN.y-2.6)*TILE,'#f3dfac',17);
    if(b){
      for(const p of b.reachable||[])this.overlayCell(p,'#c9e0d029');
      for(const e of b.enemies.filter(e=>e.hp>0)){
        for(const p of e.intent?.cells||[])this.overlayCell(p,'#c2453f65','#ef9c746e');
        c.strokeStyle='#e7b79488';c.setLineDash([2,4]);c.beginPath();c.moveTo((e.x+.5)*40,(e.y+.5)*40);c.lineTo((e.nextMove.x+.5)*40,(e.nextMove.y+.5)*40);c.stroke();c.setLineDash([]);
      }
      for(const t of b.tides)for(const p of t.cells)this.overlayCell(p,'#51b2c280','#a5eee8');
      for(const m of b.meteors)this.overlayCell(m,'#c4a45d99','#ffe3a0');
      if(b.mechanism?.active){this.overlayCell(b.mechanism,'#73d2c65c','#c1f4e2');this.label('陣眼',(b.mechanism.x+.5)*40,(b.mechanism.y+.5)*40+4,'#f4ffdc');}
      for(const e of b.enemies.filter(e=>e.hp>0))decor.push({y:e.y+.5,draw:()=>{
        const x=(e.x+.5)*40,y=(e.y+.5)*40;c.fillStyle=e.elite?'#a16e8b':'#9e7261';c.strokeStyle='#f1cfaa';c.lineWidth=2;c.beginPath();c.arc(x,y-12,16,0,7);c.fill();c.stroke();this.label(e.elite?'衛':'獸',x,y-8,'#fff1d9',15);
        c.fillStyle='#241d1c';c.fillRect(x-19,y-33,38,4);c.fillStyle='#e39a77';c.fillRect(x-19,y-33,38*e.hp/e.maxHp,4);
      }});
    }else for(const o of W.objectsIn({x:left,y:top,w:right-left+1,h:bottom-top+1}))if(W.known(d.state.explored,o.x,o.y)&&o.x>=left&&o.x<=right&&o.y>=top&&o.y<=bottom){
      const today=new Date(at+8*3600000).toISOString().slice(0,10),claimed=d.state.claims?.[(o.kind==='chest'?'chest:':o.kind==='monster'?'monster:':'gather:')+o.id+(o.kind==='chest'?'':':'+today)];
      decor.push({y:o.y+.5,draw:()=>this.object(o,claimed)});
    }
    if(!b){
      const grouped=new Map();for(const actor of d.players||[]){const p=W.sample(actor.route,at),k=p.moving?actor.uid:W.key(p.tile.x,p.tile.y);let g=grouped.get(k);if(!g){g=[];grouped.set(k,g);}g.push({actor,p});}
      for(const group of grouped.values()){const g=group.find(a=>a.actor.uid===d.uid)||group[0];if(W.known(d.state.explored,g.p.tile.x,g.p.tile.y))decor.push({y:g.p.y+.5,draw:()=>this.sprite({...g.actor,stack:group.length},g.p,at,g.actor.uid===d.uid)});}
      this.route(d.preview?.path||mine?.route?.path?.slice(W.sample(mine?.route,at).index));
    }else{decor.push({y:b.player.y+.5,draw:()=>this.sprite({...mine,name:mine?.name||'我'},pos,at,true,false)});this.route(d.preview?.path);}
    decor.sort((a,q)=>a.y-q.y).forEach(n=>n.draw());
    const effectTime=Date.now();this.effects=this.effects.filter(e=>effectTime-e.at<1000);
    for(const e of this.effects){const elapsed=(effectTime-e.at)/1000,x=(e.x+.5)*40,y=(e.y+.5)*40;
      c.save();c.globalAlpha=Math.max(0,1-elapsed);
      if(e.meteor){c.strokeStyle='#fff0ba';c.lineWidth=6*(1-elapsed);c.beginPath();c.moveTo(x-40*(1-elapsed),y-120*(1-elapsed));c.lineTo(x,y);c.stroke();c.strokeStyle='#e7bf71';c.lineWidth=3;c.beginPath();c.arc(x,y,10+elapsed*35,0,7);c.stroke();}
      else{this.label(e.text,x,y-30-elapsed*24,e.color,18);c.strokeStyle=e.color;c.lineWidth=2;c.beginPath();c.arc(x,y-9,8+elapsed*20,0,7);c.stroke();}
      c.restore();
    }
    if(d.selected)this.overlayCell(d.selected,'#e7c66e20','#ffe8a0');
    if(d.cursor)this.overlayCell(d.cursor,'#ffffff12','#fff');
    if(b){c.strokeStyle='#ead39a';c.lineWidth=3;c.strokeRect(b.bounds.x*40,b.bounds.y*40,320,320);}
    this.drawMini(pos);
  }
  drawMini(pos){
    const W=this.world,fog=this.data.state.explored,x0=Math.max(0,Math.min(W.SIZE-96,Math.floor(pos.x/16)*16-48)),y0=Math.max(0,Math.min(W.SIZE-96,Math.floor(pos.y/16)*16-48)),scale=this.mini.width/96;
    this.miniOrigin={x:x0,y:y0};const signature=[x0,y0,fog.revision,W.patchRevision,this.data.events.bridge,this.data.events.array].join(':');
    if(signature!==this.miniSignature){
      this.miniSignature=signature;this.miniBase||=document.createElement('canvas');this.miniBase.width=this.mini.width;this.miniBase.height=this.mini.height;const c=this.miniBase.getContext('2d');
      for(let y=0;y<96;y++)for(let x=0;x<96;x++){c.fillStyle=W.known(fog,x+x0,y+y0)?colors[W.terrain(x+x0,y+y0,this.data.events)]:'#252b25';c.fillRect(x*scale,y*scale,scale+.3,scale+.3);}
      for(const o of W.objectsIn({x:x0,y:y0,w:96,h:96}))if(W.known(fog,o.x,o.y)){c.fillStyle=o.kind==='monster'?'#b85b49':o.kind==='realm'?'#c3a1dd':'#e5ca83';c.fillRect((o.x-x0)*scale,(o.y-y0)*scale,scale+1,scale+1);}
    }
    const c=this.mini.getContext('2d');c.clearRect(0,0,this.mini.width,this.mini.height);c.drawImage(this.miniBase,0,0);c.fillStyle='#fff3ba';c.beginPath();c.arc((pos.x+.5-x0)*scale,(pos.y+.5-y0)*scale,3,0,7);c.fill();
    const z=TILE*this.camera.zoom;c.strokeStyle='#fff3b987';c.lineWidth=1;c.strokeRect((this.camera.x-this.width/z/2-x0)*scale,(this.camera.y-this.height/z/2-y0)*scale,this.width/z*scale,this.height/z*scale);
  }
}
