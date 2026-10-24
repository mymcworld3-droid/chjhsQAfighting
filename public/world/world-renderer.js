import './world-core.js';
import './world-art.js';
import './world-scenery.js';
import './world-ground.js';
const BaseWorld=globalThis.QAGridWorld, TILE=40;
const colors=BaseWorld.COLORS,Art=globalThis.QAGridWorldArt,Scenery=globalThis.QAGridWorldScenery,Ground=globalThis.QAGridWorldGround;
export class WorldRenderer {
  constructor(canvas,mini,onPick){
    this.world=BaseWorld.createWorld();const W=this.world;
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.mini=mini;this.onPick=onPick;
    this.camera={x:W.SPAWN.x+.5,y:W.SPAWN.y+.5,zoom:1,follow:true};this.data={};this.pointers=new Map();this.active=false;
    this.effects=[];this.hitRegions=[];this.hitMasks=new Map();this.images={};this.assetErrors=[];for(const [id,url]of Object.entries({...Art.sources,male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'})){
      const img=new Image();img.decoding='async';img.onerror=()=>{this.assetErrors.push(id);this.canvas.dispatchEvent(new CustomEvent('world:asset-error',{detail:{id,url}}));};img.src=url;this.images[id]=img;
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
      this.pointers.delete(e.pointerId);this.pinch=null;if(click){const p=this.worldPoint(e.clientX,e.clientY);this.onPick(this.pickPoint(p));}this.drag=null;};
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
  imageSprite(sprite,x,y,opacity=1){
    const img=this.images[sprite.image];if(!img?.complete||!img.naturalWidth)return false;
    const c=this.ctx;c.save();c.globalAlpha*=opacity;c.drawImage(img,sprite.sx,sprite.sy,sprite.sw,sprite.sh,x-sprite.w/2,y-sprite.h*sprite.anchor,sprite.w,sprite.h);c.restore();return true;
  }
  pickPoint(p){
    const x=p.x*40,y=p.y*40;
    // Later painted sprites are in front. Transparent padding never captures a click.
    for(let i=this.hitRegions.length-1;i>=0;i--){const hit=this.hitRegions[i],r=hit.bounds;
      if(x<r.x||x>=r.x+r.w||y<r.y||y>=r.y+r.h)continue;
      const s=hit.sprite,key=[s.image,s.sx,s.sy].join(':'),img=this.images[s.image];let mask=this.hitMasks.get(key);
      if(!mask&&img?.complete&&img.naturalWidth){const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');c.drawImage(img,s.sx,s.sy,s.sw,s.sh,0,0,64,64);mask=c.getImageData(0,0,64,64).data;this.hitMasks.set(key,mask);}
      const u=Math.min(63,Math.floor((x-r.x)/r.w*64)),v=Math.min(63,Math.floor((y-r.y)/r.h*64));
      if(mask&&mask[(v*64+u)*4+3]>32)return{x:hit.object.x,y:hit.object.y};
    }
    return{x:Math.floor(p.x),y:Math.floor(p.y)};
  }
  sceneryModel(){
    if(this.scenery?.world!==this.world){this.scenery=Scenery.create(this.world);this.ground=typeof document==='undefined'?null:Ground.create(Art);this.scenerySignature='';}
    return this.scenery;
  }
  tile(x,y,t,at,events=this.data?.events||{},visible=()=>true){
    const c=this.ctx,W=this.world,px=x*TILE,py=y*TILE,img=this.images['ground-atlas'];
    const model=this.sceneryModel(),name=x===W.SPAWN.x&&y===W.SPAWN.y?'plaza':t;
    const composed=this.ground?.compose(model.topology(x,y,name,events,visible),this.images);
    if(composed)c.drawImage(composed,px,py,40,40);
    else if(img?.complete&&img.naturalWidth){const cell=Math.max(0,Art.terrain.indexOf(name));c.drawImage(img,cell%4*128,Math.floor(cell/4)*128,128,128,px,py,40,40);}
    else{c.fillStyle=colors[t]||colors.grass;c.fillRect(px,py,40,40);}
    // Broad light breathing preserves the calm material instead of repeating fine ripples.
    if(composed&&['water','ocean','lava'].includes(t)){
      c.save();c.globalAlpha=.025+.015*Math.sin(at/1800+x*.2+y*.3);c.fillStyle=t==='lava'?'#ffc287':'#d4efea';c.fillRect(px,py,40,40);c.restore();
    }
  }
  drawScenery(p){
    if(Scenery.isBarrier(p)){
      for(const part of Art.barrierParts(p))this.imageSprite(part.sprite,p.x*TILE+part.dx,p.y*TILE+part.dy);
      return;
    }
    this.imageSprite(Art.scenery(p),p.x*TILE,p.y*TILE);
  }
  decoration(x,y,t){
    for(const p of this.sceneryModel().ambient(x,y,t,this.data?.events))this.drawScenery(p);
  }
  object(o,claimed,showName=true){
    const c=this.ctx,x=(o.x+.5)*TILE,y=(o.y+.5)*TILE;
    const direction=o.kind==='monster'?(o.nextMove?(o.nextMove.x>o.x?'east':o.nextMove.x<o.x?'west':o.nextMove.y<o.y?'north':o.nextMove.y>o.y?'south':o.direction||'south'):o.direction||Art.directions[this.world.hash(o.x,o.y,143)%4]):o.direction;
    const sprite=Art.object({...o,direction});
    if(this.imageSprite(sprite,x,y,claimed?.5:1))this.hitRegions.push({object:o,sprite,bounds:Art.bounds(o,sprite)});
    if(showName&&(!o.veinId||o.veinAnchor))this.label(o.name+(o.level?' · '+o.level+'級':''),x,y+17,claimed?'#c9d3be':o.kind==='monster'?'#ffe2be':'#fff5d5',10);
  }
  sprite(actor,pos,at,self=false,showName=true){
    const c=this.ctx,x=(pos.x+.5)*TILE,y=(pos.y+.5)*TILE,img=this.images[actor.gender||'male'];
    if(actor.travelMode==='sail')this.imageSprite(Art.directional('boat',pos.direction||actor.direction||'down',60),x,y+8);
    if(self)this.overlayCell({x:Math.floor(pos.x),y:Math.floor(pos.y)},'#ffe6a508','#ffe6a54a');
    const direction=pos.moving||actor.route?.path?.length>1?pos.direction:actor.direction||'down',row=['down','right','left','up'].indexOf(direction);
    const frame=pos.moving?[1,2,3,0][Math.floor((at-(actor.route?.startedAtMs||0))/130)%4]:0;
    if(img?.complete&&img.naturalWidth)c.drawImage(img,frame*112,Math.max(0,row)*112,112,112,x-28,y-52,56,56);
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
    this.hitRegions=[];
    const zoom=b?Math.max(.55,Math.min(1.4,(this.width-28)/320,(this.height-80)/320)):this.camera.zoom,s=TILE*zoom;
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#253b31';c.fillRect(0,0,this.width,this.height);
    c.translate(this.width/2,this.height/2);c.scale(zoom,zoom);c.translate(-this.camera.x*TILE,-this.camera.y*TILE);
    // Keep hit testing on the same battle zoom as rendering.
    if(b)this.camera.zoom=zoom;
    const left=Math.max(0,Math.floor(this.camera.x-this.width/s/2)-1),right=Math.min(this.world.SIZE-1,Math.ceil(this.camera.x+this.width/s/2)+1),
      top=Math.max(0,Math.floor(this.camera.y-this.height/s/2)-2),bottom=Math.min(this.world.SIZE-1,Math.ceil(this.camera.y+this.height/s/2)+2),decor=[];
    const visible=(x,y)=>W.known(d.state.explored,x,y)||!!(b&&x>=b.bounds.x&&x<b.bounds.x+8&&y>=b.bounds.y&&y<b.bounds.y+8),events=b?.events||d.events;
    const scenery=this.sceneryModel(),signature=[left,right,top,bottom,d.state.explored.revision,d.state.explored.all,W.patchRevision,events?.bridge,events?.array,b?.id,b?.revision].join(':');
    if(signature!==this.scenerySignature){this.scenerySignature=signature;this.sceneryItems=scenery.inBounds({x:left,y:top,w:right-left+1,h:bottom-top+1},events,visible);}
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const discovered=visible(x,y);
      if(!discovered){c.fillStyle=W.hash(x,y)%3===0?'#34483c':'#304438';c.fillRect(x*TILE,y*TILE,40,40);continue;}
      const t=W.terrain(x,y,events);this.tile(x,y,t,at,events,visible);
      if(b&&(x<b.bounds.x||x>=b.bounds.x+8||y<b.bounds.y||y>=b.bounds.y+8)){c.fillStyle='#11221ac9';c.fillRect(x*40,y*40,40,40);}
    }
    for(const p of this.sceneryItems)decor.push({y:p.y,draw:()=>this.drawScenery(p)});
    if(!b&&W.known(d.state.explored,W.SPAWN.x,W.SPAWN.y)&&Math.abs(this.camera.x-W.SPAWN.x)<30&&Math.abs(this.camera.y-W.SPAWN.y)<30)this.label('問 道 宗',(W.SPAWN.x+.5)*TILE,(W.SPAWN.y-2.6)*TILE,'#f3dfac',17);
    if(b){
      for(const p of b.reachable||[])this.overlayCell(p,'#c9e0d029');
      for(const e of b.enemies.filter(e=>e.hp>0)){
        for(const p of e.intent?.cells||[])this.overlayCell(p,'#c2453f65','#ef9c746e');
        c.strokeStyle='#e7b79488';c.setLineDash([2,4]);c.beginPath();c.moveTo((e.x+.5)*40,(e.y+.5)*40);c.lineTo((e.nextMove.x+.5)*40,(e.nextMove.y+.5)*40);c.stroke();c.setLineDash([]);
      }
      for(const t of b.tides)for(const p of t.cells)this.overlayCell(p,'#51b2c280','#a5eee8');
      for(const m of b.meteors)this.overlayCell(m,'#c4a45d99','#ffe3a0');
      if(b.mechanism?.active){decor.push({y:b.mechanism.y+.5,draw:()=>this.imageSprite(Art.prop('altar',44),(b.mechanism.x+.5)*40,(b.mechanism.y+.5)*40)});this.overlayCell(b.mechanism,'#73d2c65c','#c1f4e2');this.label('陣眼',(b.mechanism.x+.5)*40,(b.mechanism.y+.5)*40+4,'#f4ffdc');}
      for(const e of b.enemies.filter(e=>e.hp>0))decor.push({y:e.y+.5,draw:()=>{
        const x=(e.x+.5)*40,y=(e.y+.5)*40;this.object({...e,kind:'monster'},false,false);
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
      if(e.meteor)this.imageSprite(Art.prop('meteor',50),x-30*(1-elapsed),y-90*(1-elapsed));
      else{this.label(e.text,x,y-30-elapsed*24,e.color,18);this.imageSprite(Art.prop('shield',38+elapsed*20),x,y);}
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
