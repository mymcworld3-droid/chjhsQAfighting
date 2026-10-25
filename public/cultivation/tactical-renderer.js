import './tactical-rules.js';
import './tactical-animation.js';
const R=globalThis.QATactical;
const A=globalThis.QATacticalAnimation;
const SOURCES={ground:'/assets/world-map/ai/ground-atlas.webp',props:'/assets/world-map/ai/props-atlas.webp',
  monsters:'/assets/world-map/ai/creatures-atlas.webp',male:'/assets/world-map/players/player-male.webp',female:'/assets/world-map/players/player-female.webp'};

export class TacticalRenderer{
  constructor(canvas,onSelect,onActivity=()=>{}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.onActivity=onActivity;this.images={};this.frame=0;this.destroyed=false;this.paused=false;this.range=[];this.queue=[];this.scene=null;this.heldAt=null;
    this.reducedMotion=window.matchMedia('(prefers-reduced-motion:reduce)');
    this.refresh=()=>this.draw();document.addEventListener('visibilitychange',this.refresh);this.reducedMotion.addEventListener('change',this.refresh);
    for(const [id,url]of Object.entries(SOURCES)){
      const img=new Image();img.onload=()=>this.draw();img.onerror=()=>this.draw();img.src=url;this.images[id]=img;
    }
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(canvas);
    canvas.addEventListener('click',event=>{
      if(!this.state||this.preview||this.isAnimating||this.paused)return;const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left-this.ox)/this.cell),y=Math.floor((event.clientY-rect.top-this.oy)/this.cell);
      if(R.inside(this.state,{x,y}))this.onSelect({x,y});
    });
    canvas.addEventListener('keydown',event=>{
      if(!this.state||this.preview||this.isAnimating||this.paused)return;const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
      if(!delta)return;event.preventDefault();const p=this.selection||this.state.actors.find(a=>a.uid===this.uid)||{x:0,y:0};
      const next={x:p.x+delta[0],y:p.y+delta[1]};if(R.inside(this.state,next))this.onSelect(next);
    });
  }
  update(state,uid,mode,selection){
    this.preview=null;
    if(this.state?.id!==state.id||this.state?.width!==state.width||this.state?.height!==state.height){this.queue=[];this.scene=null;}
    if(!this.reducedMotion.matches)this.queue.push(...A.plan(this.state,state,uid));
    if(this.state!==state||this.uid!==uid||this.mode!==mode){
      const me=state.actors.find(a=>a.uid===uid),mine=state.status==='active'&&state.turnUid===uid&&(!state.quizRound||state.phase==='action');
      this.range=mine?(mode==='move'?R.moveCells(state,me):R.aimCells(state,me,mode==='attack'?R.BASIC:R.branchFor(me).skill)):[];
    }
    this.state=state;this.uid=uid;this.mode=mode;this.selection=selection;this.activity();this.draw();
  }
  present(state,uid,scene=null,progress=0,view=null){
    this.queue=[];this.scene=null;this.preview={scene,progress,view};this.state=state;this.uid=uid;this.mode='demo';this.selection=null;this.range=[];this.draw();
  }
  get isAnimating(){return !!this.scene||this.queue.length>0;}
  get currentAction(){return (this.scene||this.queue[0])?.label||'';}
  get currentKind(){return (this.scene||this.queue[0])?.kind||'';}
  activity(){
    const kind=this.currentKind;this.canvas.dataset.animation=kind;this.canvas.setAttribute('aria-busy',String(this.isAnimating));
    queueMicrotask(()=>{if(!this.destroyed)this.onActivity();});
  }
  advance(now){
    let changed=false;
    while(this.scene&&now-this.scene.started>=this.scene.duration){this.scene=null;changed=true;}
    if(!this.scene&&this.queue.length){this.scene={...this.queue.shift(),started:now};changed=true;}
    if(changed)this.activity();
    return this.scene?Math.min(1,(now-this.scene.started)/this.scene.duration):0;
  }
  setPaused(value){if(this.paused===value)return;this.paused=value;this.draw();}
  destroy(){this.destroyed=true;this.queue=[];this.scene=null;this.resize.disconnect();cancelAnimationFrame(this.frame);document.removeEventListener('visibilitychange',this.refresh);this.reducedMotion.removeEventListener('change',this.refresh);}
  sprite(id,sx,sy,sw,sh,x,y,w,h){
    const img=this.images[id];if(!img?.complete||!img.naturalWidth)return false;
    this.ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);return true;
  }
  drawEffect(scene,p,above){
    const c=this.ctx,size=this.cell,{ox,oy}=this,beat=Math.sin(Math.PI*p),color=scene.color||'#e6ca8c';
    const center=a=>({x:ox+(a.x+.5)*size,y:oy+(a.y+.45)*size});
    const actor=scene.before.find(a=>a.uid===scene.actor),origin=scene.origin||actor||{x:3,y:3},target=scene.target||origin;
    const from=center(origin),to=center(target),cells=scene.cells||[];
    const ring=(pt,r,alpha=1,ink=color)=>{c.globalAlpha=alpha;c.strokeStyle=ink;c.lineWidth=Math.max(1.2,size*.045);c.beginPath();c.arc(pt.x,pt.y,Math.max(1,r*size),0,Math.PI*2);c.stroke();};
    const motes=(pt,ink=color,count=10,radius=.8)=>{
      c.fillStyle=ink;
      for(let i=0;i<count;i++){
        const angle=i*2.39996,travel=(.15+p*radius)*size;c.globalAlpha=(1-p)*(.5+i%3*.15);
        c.beginPath();c.arc(pt.x+Math.cos(angle)*travel,pt.y+Math.sin(angle)*travel-p*size*.3,Math.max(1,size*.028),0,Math.PI*2);c.fill();
      }
    };
    const beam=(a,b,ink=color,lightning=false)=>{
      c.globalAlpha=beat*.9;c.strokeStyle=ink;c.lineWidth=Math.max(1.6,size*(lightning?.06:.04));c.beginPath();c.moveTo(a.x,a.y);
      const steps=lightning?7:1;for(let i=1;i<=steps;i++){
        const t=i/steps,jitter=i===steps?0:Math.sin(i*17.3)*size*.13;
        c.lineTo(a.x+(b.x-a.x)*t+jitter,a.y+(b.y-a.y)*t-jitter);
      }c.stroke();
    };
    c.save();c.beginPath();c.rect(ox,Math.max(0,oy-size*.35),size*this.state.width,size*(this.state.height+.35));c.clip();
    if(!above){
      if(['cast','impact'].includes(scene.kind))for(const [i,cell]of cells.entries()){
        const at=center(cell),delay=scene.style==='line'?Math.min(.3,i*.06):0,q=Math.max(0,(p-delay)/(1-delay));
        c.globalAlpha=Math.sin(Math.PI*q)*.26;c.fillStyle=color;c.fillRect(ox+cell.x*size+1,oy+cell.y*size+1,size-2,size-2);
        if(q>0)ring(at,.15+q*.46,(1-q)*.65);
      }
      if(scene.kind==='move')for(const move of scene.moves){
        const route=move.path;
        if(scene.style==='teleport'){ring(center(route[0]),.15+p*.6,1-p);ring(center(route.at(-1)),.65-p*.4,p);}
        else{
          c.globalAlpha=(1-p)*.45;c.strokeStyle=color;c.lineWidth=size*(scene.style==='push'?.08:.05);c.setLineDash([size*.09,size*.08]);c.beginPath();
          route.forEach((pt,i)=>{const at=center(pt);c[i?'lineTo':'moveTo'](at.x,at.y);});c.stroke();c.setLineDash([]);
        }
      }
      if(['restore','guard','answer','turn','dodge'].includes(scene.kind))ring(from,.25+p*.55,beat*.7,scene.kind==='restore'?'#b6d69c':scene.kind==='answer'?'#e9d28c':color);
      c.restore();return;
    }
    if(['cast','impact'].includes(scene.kind)){
      const style=scene.style,lightning=scene.skill==='lightning'||scene.skill==='counter';
      if(scene.kind==='impact'){
        for(const cell of cells){const pt=center(cell),fall=Math.min(1,p/.65),head={x:pt.x-size*(1-fall)*.6,y:pt.y-(1-fall)*size*2.5};
          beam({x:head.x-size*.25,y:head.y-size*.65},head,'#dfb8ed');
          c.globalAlpha=1-p*.55;c.fillStyle='#f5d4ac';c.beginPath();c.arc(head.x,head.y,size*.11,0,Math.PI*2);c.fill();
          if(p>.5){ring(pt,(p-.5)*1.4,(1-p)*1.5,'#efd7a3');motes(pt,'#cfb7e7',5,.65);}
        }
      }else if(style==='meteor'){
        for(const cell of cells){const pt=center(cell);ring(pt,.2+beat*.15,beat);c.globalAlpha=beat;c.fillStyle='#e0c5f5';c.fillRect(pt.x-1,pt.y-size*.34,2,size*.2);}
      }else if(lightning){
        for(const cell of cells){const pt=center(cell);beam({x:pt.x+size*.25,y:pt.y-size*1.5},pt,'#e6c9ff',true);motes(pt,'#dbc1ef',5,.5);}
        ring(from,.35+beat*.15,beat,'#dfbded');
      }else if(['restore','counter','blink','swap'].includes(style)){
        ring(from,.28+p*.48,beat);motes(from,color,12,.7);
        if(style==='blink'||style==='swap'){ring(to,.7-p*.3,beat);motes(to,color,8,.7);}
      }else if(['cross','blast','shell','ring','nova','diagonal','area'].includes(style)){
        for(const cell of cells){const pt=center(cell);ring(pt,.12+p*.45,beat*.8);motes(pt,color,4,.42);}
        if(style==='shell'||style==='cross')ring(from,.2+p*(style==='shell'?2.5:1.5),1-p);
        if(style==='blast')for(const cell of cells)beam(from,center(cell),color);
      }else if(['cone','fork','line','shot','hit','charge','lunge'].includes(style)){
        if(['attack','blades','lunge','execute'].includes(scene.skill)){
          const angle=Math.atan2(to.y-from.y,to.x-from.x);
          for(const [i,cell]of cells.entries()){
            const pt=center(cell),q=Math.max(0,Math.min(1,(p-i*.06)/.8));c.globalAlpha=Math.sin(Math.PI*q);c.strokeStyle=color;c.lineWidth=size*.07;
            c.beginPath();c.arc(pt.x,pt.y,size*(.24+q*.2),angle-1.35+q*.7,angle+.2+q*.7);c.stroke();
          }
        }else{
          for(const cell of cells){const pt=center(cell),travel=Math.min(1,p/.65);beam(from,{x:from.x+(pt.x-from.x)*travel,y:from.y+(pt.y-from.y)*travel},color);}
          if(p>.35)motes(to,color,8,.55);
          if(scene.skill==='drain'){
            const q=Math.max(0,(p-.4)/.6);for(let i=0;i<4;i++){c.globalAlpha=beat;c.fillStyle='#b6d69c';c.beginPath();c.arc(to.x+(from.x-to.x)*q+Math.sin(q*6+i)*size*.08,to.y+(from.y-to.y)*q,size*.04,0,Math.PI*2);c.fill();}
          }
        }
      }else{
        // Bites, claws, pounces and wing cuts share the exact warned footprint.
        for(const cell of cells){const pt=center(cell);c.globalAlpha=beat;c.strokeStyle=color;c.lineWidth=Math.max(1.5,size*.045);
          for(let n=-1;n<=1;n++){c.beginPath();c.moveTo(pt.x-size*.28+n*size*.14,pt.y-size*.28);c.lineTo(pt.x+size*.12+n*size*.14,pt.y+size*.2);c.stroke();}
        }
      }
    }
    if(['restore','answer','guard','dodge'].includes(scene.kind)){
      const ink=scene.kind==='restore'?'#bddb9d':scene.kind==='answer'?'#efdc9d':color;motes(from,ink,scene.kind==='guard'?8:12,.75);
      if(scene.kind==='guard'){
        c.globalAlpha=beat;c.strokeStyle=ink;c.lineWidth=size*.05;c.beginPath();c.moveTo(from.x,from.y-size*.48);c.lineTo(from.x+size*.3,from.y-size*.3);c.lineTo(from.x+size*.24,from.y+size*.1);c.lineTo(from.x,from.y+size*.32);c.lineTo(from.x-size*.24,from.y+size*.1);c.lineTo(from.x-size*.3,from.y-size*.3);c.closePath();c.stroke();
      }
    }
    if(scene.kind==='damage'){
      if(scene.style==='counter')beam(from,to,'#e0baf1',true);
      for(const number of scene.numbers){const a=scene.before.find(a=>a.uid===number.uid);if(a)motes(center(a),number.absorbed?'#b9e5ef':'#efb18e',8,.7);}
    }
    const numbers=[...scene.numbers];
    if(scene.kind==='dodge'&&actor)numbers.push({uid:actor.uid,text:'閃避'});
    for(const number of numbers){
      const a=scene.before.find(a=>a.uid===number.uid);if(!a)continue;
      const at=center(a),lines=number.text?[{text:number.text,ink:'#ede1b9'}]:[
        ...(number.damage!==undefined?[{text:'−'+number.damage,ink:'#ffe0c5'}]:[]),
        ...(number.absorbed?[{text:'護盾 −'+number.absorbed,ink:'#bde5ed'}]:[]),
        ...(number.heal?[{text:'+'+number.heal+' 生命',ink:'#d1edb5'}]:[]),
        ...(number.shield?[{text:'護盾 +'+number.shield,ink:'#bde5ed'}]:[]),
        ...(number.gain!==undefined?[{text:'體力 +'+number.gain,ink:'#f5df9f'}]:[])];
      c.globalAlpha=Math.min(1,(1-p)*3);c.font=`600 ${Math.max(10,Math.min(17,size*.32))}px "Noto Sans TC",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=3;
      for(const [i,line]of lines.entries()){
        const half=c.measureText(line.text).width/2+3,x=Math.max(ox+half,Math.min(ox+size*this.state.width-half,at.x)),y=Math.max(oy+10,at.y-size*(.55+p*.6)+i*15);
        c.strokeStyle='#231a13';c.strokeText(line.text,x,y);c.fillStyle=line.ink;c.fillText(line.text,x,y);
      }
    }
    if(scene.kind==='finish'){
      const pt={x:ox+this.state.width*size/2,y:oy+this.state.height*size/2},ink=scene.style==='victory'?'#e7ca89':'#cfb99b';
      ring(pt,.5+p*2,beat*.6,ink);motes(pt,ink,22,2.5);
      c.globalAlpha=beat;c.fillStyle='#211b14d9';c.fillRect(pt.x-size*2,pt.y-size*.5,size*4,size);
      c.fillStyle=ink;c.font=`500 ${Math.min(30,size*.6)}px "Noto Serif TC",serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(scene.label,pt.x,pt.y);
    }
    c.restore();
  }
  draw(){
    cancelAnimationFrame(this.frame);this.frame=0;
    if(this.destroyed||!this.state)return;
    const now=performance.now();
    if(this.paused||document.hidden){this.heldAt??=now;return;}
    if(this.heldAt!==null){if(this.scene)this.scene.started+=now-this.heldAt;this.heldAt=null;}
    if(this.reducedMotion.matches&&this.isAnimating){this.queue=[];this.scene=null;this.activity();}
    const progress=this.preview?this.preview.progress:this.advance(now),scene=this.preview?this.preview.scene:this.scene,animating=!!scene||this.isAnimating;
    const {canvas,ctx:c,state:s}=this,rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dpr=Math.min(3,window.devicePixelRatio||1),w=rect.width,h=rect.height;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const view=this.preview?.view||{x:0,y:0,width:s.width,height:s.height};
    const cell=this.cell=Math.min((w-20)/view.width,(h-24)/view.height),ox=this.ox=Math.round((w-cell*view.width)/2)-view.x*cell,oy=this.oy=Math.round((h-cell*view.height)/2)-view.y*cell;
    const mine=s.actors.find(a=>a.uid===this.uid),myTurn=!animating&&s.status==='active'&&s.turnUid===this.uid,reduced=this.reducedMotion.matches;
    const fill=(p,color,stroke)=>{const x=ox+p.x*cell,y=oy+p.y*cell;c.fillStyle=color;c.fillRect(x+1,y+1,cell-2,cell-2);if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.strokeRect(x+2,y+2,cell-4,cell-4);}};
    c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    for(let y=view.y;y<view.y+view.height;y++)for(let x=view.x;x<view.x+view.width;x++){
      const px=Math.round(ox+x*cell),py=Math.round(oy+y*cell),edgeX=Math.round(ox+(x+1)*cell),edgeY=Math.round(oy+(y+1)*cell),t=s.ground?.[y*s.width+x]??s.terrain;
      if(!this.sprite('ground',t%4*128,Math.floor(t/4)*128,128,128,px,py,edgeX-px,edgeY-py)){c.fillStyle=(x+y)%2?'#5b6650':'#5f6b53';c.fillRect(px,py,edgeX-px,edgeY-py);}
      c.strokeStyle='#10291b30';c.lineWidth=.7;c.strokeRect(px,py,edgeX-px,edgeY-py);
    }
    if(myTurn&&this.mode==='move'){
      // Absolute time keeps the same soft pulse at any refresh rate. The BFS is
      // cached by update(), rather than repeated on every animation frame.
      const alpha=reduced ? .4 : .18+.34*(.5+.5*Math.sin(now*2*Math.PI/1400));
      for(const p of this.range)fill(p,`rgba(128,128,128,${alpha})`,'#dadde18c');
    }
    if(myTurn&&['attack','skill'].includes(this.mode)){
      const sk=this.mode==='attack'?R.BASIC:R.branchFor(mine).skill;
      for(const p of this.range)fill(p,'#e445454d','#ed6a6a99');
      if(this.selection&&this.range.some(p=>R.key(p)===R.key(this.selection)))for(const p of R.skillCells(s,mine,sk,this.selection))fill(p,'#ef39398c','#ffb1a3');
    }
    if(!animating){
      for(const e of s.effects)for(const p of e.cells)fill(p,'#9b7aec55','#d5b8ff');
      c.setLineDash([3,3]);for(const a of s.actors.filter(a=>a.bot&&R.alive(a)))for(const p of a.intent?.cells||[])fill(p,'#e2564518','#ff8871');c.setLineDash([]);
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
    if(scene)this.drawEffect(scene,progress,false);
    const actors=scene?A.sample(scene,progress):s.actors;
    const positions=actors.filter(R.alive).sort((a,b)=>a.y-b.y);
    for(const a of positions){
      const {x,y}=a,frame=a.frame||0,row=a.row??(a.gender==='female'?2:0);
      const px=ox+(x+.5+(a.sway||0))*cell,groundY=oy+(y+.5)*cell,py=Math.max(cell*.82,groundY-(a.lift||0)*cell),own=a.uid===this.uid,enemy=a.team!==mine?.team;
      c.save();c.globalAlpha=a.opacity??1;
      c.beginPath();c.ellipse(px,groundY+cell*.18,cell*.28,cell*.12,0,0,Math.PI*2);c.fillStyle='#0005';c.fill();
      c.strokeStyle=own?'#f8d58a':enemy?'#f29c83':'#a2d8c4';c.lineWidth=own?2.5:1.5;
      c.beginPath();c.ellipse(px,py+cell*.15,cell*.34,cell*.2,0,0,Math.PI*2);c.stroke();
      const size=cell*1.18,sw=size*(a.scaleX||1),sh=size*(a.scaleY||1),drawn=a.bot?this.sprite('monsters',a.species%5*128,Math.floor(a.species/5)*128,128,128,px-sw/2,py-sh*.7,sw,sh):
        this.sprite(a.gender,frame*112,row*112,112,112,px-sw/2,py-sh*.76,sw,sh);
      if(!drawn){c.fillStyle=enemy?'#c57a67':'#e5cc8a';c.beginPath();c.arc(px,py-cell*.12,cell*.24,0,Math.PI*2);c.fill();}
      if(a.shield){c.strokeStyle='#9adcf1';c.lineWidth=2;c.beginPath();c.arc(px,py-cell*.12,cell*.39,0,Math.PI*2);c.stroke();}
      if(a.guard){c.strokeStyle='#e3ca89a0';c.lineWidth=1.5;c.beginPath();c.arc(px,py-cell*.12,cell*.44,-Math.PI*.85,-Math.PI*.15);c.stroke();}
      if(a.flash){c.globalAlpha=(a.opacity??1)*a.flash;c.fillStyle='#ffe7c2';c.beginPath();c.ellipse(px,py-cell*.12,cell*.26,cell*.4,0,0,Math.PI*2);c.fill();c.globalAlpha=a.opacity??1;}
      const bar=cell*.65;c.fillStyle='#14251c';c.fillRect(px-bar/2,py+cell*.38,bar,4);c.fillStyle=enemy?'#df8a73':'#c8d895';c.fillRect(px-bar/2,py+cell*.38,bar*a.hp/a.maxHp,4);
      if(!animating&&s.turnUid===a.uid){c.fillStyle='#f9e6ad';c.beginPath();c.moveTo(px-4,py-cell*.6);c.lineTo(px+4,py-cell*.6);c.lineTo(px,py-cell*.48);c.fill();}
      c.restore();
    }
    if(scene)this.drawEffect(scene,progress,true);
    if(this.selection&&!animating)fill(this.selection,'#fff0','#fff1ba');
    c.strokeStyle='#d9c69380';c.lineWidth=1.5;c.strokeRect(ox+view.x*cell,oy+view.y*cell,cell*view.width,cell*view.height);
    if(!this.preview&&(animating||myTurn&&this.mode==='move'&&this.range.length&&!reduced))this.frame=requestAnimationFrame(()=>this.draw());
  }
}
