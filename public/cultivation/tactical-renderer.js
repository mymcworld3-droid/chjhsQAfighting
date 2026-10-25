import './tactical-rules.js';
const R=globalThis.QATactical;
const SOURCES={ground:'/assets/world-map/ai/ground-atlas.webp',props:'/assets/world-map/ai/props-atlas.webp',
  monsters:'/assets/world-map/ai/creatures-atlas.webp',male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'};

export class TacticalRenderer{
  constructor(canvas,onSelect){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.images={};this.frame=0;this.destroyed=false;this.motion=null;
    for(const [id,url]of Object.entries(SOURCES)){
      const img=new Image();img.onload=()=>this.draw();img.onerror=()=>this.draw();img.src=url;this.images[id]=img;
    }
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);
    canvas.addEventListener('click',event=>{
      if(!this.state)return;const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left-this.ox)/this.cell),y=Math.floor((event.clientY-rect.top-this.oy)/this.cell);
      if(R.inside(this.state,{x,y}))this.onSelect({x,y});
    });
    canvas.addEventListener('keydown',event=>{
      if(!this.state)return;const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
      if(!delta)return;event.preventDefault();const p=this.selection||this.state.actors.find(a=>a.uid===this.uid)||{x:0,y:0};
      const next={x:p.x+delta[0],y:p.y+delta[1]};if(R.inside(this.state,next))this.onSelect(next);
    });
  }
  update(state,uid,mode,selection){
    if(this.state&&state.id===this.state.id&&state.revision>this.state.revision){
      const event=state.events.at(-1);if(event?.type==='move'&&event.path?.length>1)this.motion={uid:event.actor,path:event.path,started:performance.now()};
    }
    this.state=state;this.uid=uid;this.mode=mode;this.selection=selection;this.draw();
  }
  destroy(){this.destroyed=true;this.resize.disconnect();cancelAnimationFrame(this.frame);}
  sprite(id,sx,sy,sw,sh,x,y,w,h){
    const img=this.images[id];if(!img?.complete||!img.naturalWidth)return false;
    this.ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);return true;
  }
  draw(){
    if(this.destroyed||!this.state)return;cancelAnimationFrame(this.frame);
    const {canvas,ctx:c,state:s}=this,rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dpr=Math.min(3,window.devicePixelRatio||1),w=rect.width,h=rect.height;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle='#171e19';c.fillRect(0,0,w,h);
    const cell=this.cell=Math.min((w-20)/s.width,(h-24)/s.height),ox=this.ox=Math.round((w-cell*s.width)/2),oy=this.oy=Math.round((h-cell*s.height)/2);
    const mine=s.actors.find(a=>a.uid===this.uid),myTurn=s.status==='active'&&s.turnUid===this.uid;
    const fill=(p,color,stroke)=>{const x=ox+p.x*cell,y=oy+p.y*cell;c.fillStyle=color;c.fillRect(x+1,y+1,cell-2,cell-2);if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.strokeRect(x+2,y+2,cell-4,cell-4);}};
    c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
      const px=Math.round(ox+x*cell),py=Math.round(oy+y*cell),edgeX=Math.round(ox+(x+1)*cell),edgeY=Math.round(oy+(y+1)*cell),t=s.ground?.[y*s.width+x]??s.terrain;
      if(!this.sprite('ground',t%4*128,Math.floor(t/4)*128,128,128,px,py,edgeX-px,edgeY-py)){c.fillStyle=(x+y)%2?'#5b6650':'#5f6b53';c.fillRect(px,py,edgeX-px,edgeY-py);}
      c.strokeStyle='#10291b30';c.lineWidth=.7;c.strokeRect(px,py,edgeX-px,edgeY-py);
    }
    for(const a of s.actors.filter(a=>a.bot&&R.alive(a)))for(const p of a.intent?.cells||[])fill(p,'#e2564547','#f0896da0');
    for(const e of s.effects)for(const p of e.cells)fill(p,'#9b7aec55','#d5b8ff');
    if(myTurn&&this.mode==='move'){
      // One bounded BFS rather than a path search for every cell on larger maps.
      const queue=[{x:mine.x,y:mine.y,d:0}],seen=new Set([R.key(mine)]),step=1+(mine.slow||0);
      for(let i=0;i<queue.length;i++){
        const p=queue[i];if(p.d>0)fill(p,'#e5d08815');if((p.d+1)*step>mine.stamina)continue;
        for(const n of R.neighbours(s,p))if(!seen.has(R.key(n))&&!R.at(s,n)){seen.add(R.key(n));queue.push({...n,d:p.d+1});}
      }
    }
    if(myTurn&&['attack','skill'].includes(this.mode)){
      const sk=this.mode==='attack'?R.BASIC:R.branchFor(mine).skill;
      for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++)if(R.dist(mine,{x,y})<=sk.range&&!R.blocked(s,{x,y})&&R.sight(s,mine,{x,y}))fill({x,y},'#e4b66e17');
      if(this.selection)for(const p of R.skillCells(s,mine,sk,this.selection))fill(p,'#eabb664a','#ffdf9e');
    }
    if(myTurn&&this.mode==='move'&&this.selection){
      const route=R.path(s,mine,this.selection,mine.uid);if(route&&route.length>1){
        c.beginPath();route.forEach((p,i)=>c[i?'lineTo':'moveTo'](ox+(p.x+.5)*cell,oy+(p.y+.5)*cell));
        c.strokeStyle='#f8df9b';c.lineWidth=2.5;c.setLineDash([4,4]);c.stroke();c.setLineDash([]);
      }
    }
    for(const p of s.blocks){
      if(p.kind==='water')continue;
      const x=ox+p.x*cell,y=oy+p.y*cell;fill(p,'#1c261b60');
      if(!this.sprite('props',(p.kind==='tree'?1:2)*128,0,128,128,x-cell*.06,y-cell*.15,cell*1.12,cell*1.12)){
        c.fillStyle='#56594c';c.fillRect(x+cell*.14,y+cell*.1,cell*.72,cell*.8);
      }
    }
    let moving=false;
    const positions=s.actors.filter(R.alive).map(a=>{
      let x=a.x,y=a.y,frame=0,row=a.gender==='female'?2:0;
      if(this.motion?.uid===a.uid&&!window.matchMedia('(prefers-reduced-motion:reduce)').matches){
        const t=(performance.now()-this.motion.started)/130,path=this.motion.path,i=Math.floor(t);
        if(i<path.length-1){const f=t-i,p=path[i],n=path[i+1];x=p.x+(n.x-p.x)*f;y=p.y+(n.y-p.y)*f;
          row=n.x>p.x?1:n.x<p.x?2:n.y<p.y?3:0;frame=[1,2,3,0][Math.floor(t)%4];moving=true;
        }
      }
      return {a,x,y,frame,row};
    }).sort((a,b)=>a.y-b.y);
    for(const {a,x,y,frame,row}of positions){
      const px=ox+(x+.5)*cell,py=oy+(y+.5)*cell,own=a.uid===this.uid,enemy=a.team!==mine?.team;
      c.beginPath();c.ellipse(px,py+cell*.18,cell*.28,cell*.12,0,0,Math.PI*2);c.fillStyle='#0005';c.fill();
      c.strokeStyle=own?'#f8d58a':enemy?'#f29c83':'#a2d8c4';c.lineWidth=own?2.5:1.5;
      c.beginPath();c.ellipse(px,py+cell*.15,cell*.34,cell*.2,0,0,Math.PI*2);c.stroke();
      const size=cell*1.18,drawn=a.bot?this.sprite('monsters',a.species%5*128,Math.floor(a.species/5)*128,128,128,px-size/2,py-size*.7,size,size):
        this.sprite(a.gender,frame*112,row*112,112,112,px-size/2,py-size*.76,size,size);
      if(!drawn){c.fillStyle=enemy?'#c57a67':'#e5cc8a';c.beginPath();c.arc(px,py-cell*.12,cell*.24,0,Math.PI*2);c.fill();}
      if(a.shield){c.strokeStyle='#9adcf1';c.lineWidth=2;c.beginPath();c.arc(px,py-cell*.12,cell*.39,0,Math.PI*2);c.stroke();}
      const bar=cell*.65;c.fillStyle='#14251c';c.fillRect(px-bar/2,py+cell*.38,bar,4);c.fillStyle=enemy?'#df8a73':'#c8d895';c.fillRect(px-bar/2,py+cell*.38,bar*a.hp/a.maxHp,4);
      if(s.turnUid===a.uid){c.fillStyle='#f9e6ad';c.beginPath();c.moveTo(px-4,py-cell*.6);c.lineTo(px+4,py-cell*.6);c.lineTo(px,py-cell*.48);c.fill();}
    }
    if(this.selection)fill(this.selection,'#fff0','#fff1ba');
    c.strokeStyle='#d9c69380';c.lineWidth=1.5;c.strokeRect(ox,oy,cell*s.width,cell*s.height);
    if(moving)this.frame=requestAnimationFrame(()=>this.draw());else this.motion=null;
  }
}
