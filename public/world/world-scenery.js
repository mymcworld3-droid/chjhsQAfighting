/* Seeded visual scenery only: never changes terrain, collisions or saved worlds. */
(function(root){
  'use strict';
  const DIRECTIONS=Object.freeze(['north','east','south','west']);
  const STEPS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[1,1],[-1,1]]);
  const ROADS=new Set(['road','bridge','broken-bridge']),WATER=new Set(['water','ocean']);
  const DRY=new Set(['grass','courtyard','mountain','bamboo','forest','desert','snow','swamp','stone','volcano','beach']);
  const isSite=o=>['building','structure','realm'].includes(o.kind);
  const isBarrier=p=>p.prop==='fence'||p.prop==='wall',isGate=p=>p?.prop==='gate'||p?.prop==='sect-gate',cell=p=>Math.floor(p.x)+','+Math.floor(p.y);
  // A block owns one centre and only the half-arms leading to compatible neighbours.
  // Resolve after visibility/occupancy, but before viewport clipping (one-cell halo).
  function connect(items){
    const nodes=new Map(),unique=[];
    for(const p of items){
      if(isBarrier(p)||isGate(p)){const k=cell(p);if(nodes.has(k))continue;nodes.set(k,p);}
      unique.push(p);
    }
    return unique.map(p=>{
      if(!isBarrier(p))return p;
      let mask=0;
      for(let i=0;i<4;i++){
        const [dx,dy]=STEPS[i],n=nodes.get((Math.floor(p.x)+dx)+','+(Math.floor(p.y)+dy));
        if(n?.prop===p.prop||isGate(n)&&((['east','west'].includes(n.direction)?5:10)&(1<<i)))mask|=1<<i;
      }
      return {...p,mask,post:p.prop==='fence'||mask!==5&&mask!==10};
    });
  }
  function create(world){
    const W=world;
    function topology(x,y,t,events={},visible=()=>true){
      const neighbours=STEPS.map(([dx,dy])=>W.inside(x+dx,y+dy)&&visible(x+dx,y+dy)?W.terrain(x+dx,y+dy,events):t);
      let mask=0;neighbours.slice(0,4).forEach((v,i)=>{if(ROADS.has(v))mask|=1<<i;});
      // A road is a broad paved surface only where the neighbouring tiles
      // really form a 2x2 road square. The diagonal check keeps lone bends,
      // narrow paths and bridges from receiving unwanted paved corners.
      const road=i=>neighbours[i]==='road';
      let cornerMask=0;
      if(t==='road'){
        if(road(0)&&road(3)&&road(4))cornerMask|=1; // northwest
        if(road(0)&&road(1)&&road(5))cornerMask|=2; // northeast
        if(road(1)&&road(2)&&road(6))cornerMask|=4; // southeast
        if(road(2)&&road(3)&&road(7))cornerMask|=8; // southwest
      }
      const horizontal=[1,3].reduce((s,i)=>s+Number(ROADS.has(neighbours[i]))*3+Number(DRY.has(neighbours[i])),0);
      const vertical=[0,2].reduce((s,i)=>s+Number(ROADS.has(neighbours[i]))*3+Number(DRY.has(neighbours[i])),0);
      const bridgeDirection=horizontal>=vertical?'east':'south';
      const counts=new Map();for(const v of neighbours)if(DRY.has(v))counts.set(v,(counts.get(v)||0)+1);
      const inSect=Math.max(Math.abs(x-W.SPAWN.x),Math.abs(y-W.SPAWN.y))<=W.CITY_RADIUS;
      const adjacent=neighbours.slice(0,4);
      const underlay=inSect
        ?t==='road'&&adjacent.includes('grass')?'grass'
          :t==='road'&&adjacent.some(v=>WATER.has(v))?'water'
          :'courtyard'
        :[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'grass';
      // Only include neighbours that actually contribute pixels. A road's
      // eight surrounding terrain names used to create hundreds of duplicate
      // rasters when zooming out across an entire landscaped sect.
      const blended=neighbours.map(v=>v!==t&&!['road','bridge','broken-bridge','sealed'].includes(v)?v:'');
      const raster=t==='road'?[t,mask,cornerMask,underlay]:['bridge','broken-bridge'].includes(t)?[t,bridgeDirection,neighbours.includes('ocean')?'ocean':'water']:[t,...blended];
      // Ground.compose additionally keys every contributing texture's flips.
      return {x,y,terrain:t,neighbours,mask,cornerMask,underlay,bridgeDirection,key:raster.join(':')};
    }
    function sparse(x,y,limit,layer,diagonal=false){
      const h=W.hash(x,y,layer);if(h%100>=limit)return false;
      // A local priority rule works across chunk seams and never depends on visit order.
      return STEPS.slice(0,diagonal?8:4).every(([dx,dy])=>{
        const n=W.hash(x+dx,y+dy,layer);return n%100>=limit||n>=h;
      });
    }
    function ambient(x,y,t,events={}){
      const h=W.hash(x,y,91),items=[],dx=x-W.SPAWN.x,dy=y-W.SPAWN.y,r=W.CITY_RADIUS;
      const add=(prop,size,direction=null)=>items.push({x:x+.5,y:y+.65,prop,size,direction});
      if(!W.objectAt(x,y)){
        if(t==='bamboo'){
          // Seeded bamboo canopies are deliberately allowed to overlap neighbouring
          // tiles. Their foot is still in this tile; no terrain or collision changes.
          const density=W.hash(x,y,92)%100;
          if(density<80){
            add('bamboo-tall-'+((h>>>12)%4),82+h%11);
            // Mostly one or two staggered clumps, with occasional denser patches
            // and seeded clearings. Roots never change terrain or collisions.
            if(density<35){
              add('bamboo-tall-'+((h>>>20)%4),76+((h>>>5)%9));
              const extra=items[items.length-1];
              extra.x+=((h>>>25)&1)?.30:-.30;
              extra.y-=.12;
            }
            if(density<5){
              add('bamboo-tall-'+((h>>>23)%4),72+((h>>>3)%9));
              const extra=items[items.length-1];
              extra.x+=((h>>>25)&1)?-.29:.29;
              extra.y+=.16;
            }
          }else if(h%3===0)add('shrub',21);
        }else if(t==='rock')add('rock',44);
        else if(t==='forest'&&sparse(x,y,48,93))add('tree',48+h%9);
        else if(t==='volcano'&&sparse(x,y,13,94,true))add('volcano',39);
        else if(t==='grass'&&h%17===0)add('flowers',22);
        else if(t==='swamp'&&h%6===0)add('reeds',30);
        else if(t==='stone'&&sparse(x,y,23,95,true))add('stone-'+((h>>>12)%3),24+h%9);
        else if(t==='mountain'&&sparse(x,y,12,96,true))add('rock',27);
        else if(t==='sealed')add('sealed',44);
        for(const item of items){item.x+=((h>>>8)%101/100-.5)*.3;item.y+=((h>>>17)%101/100-.5)*.2;}
      }
      // Qingyun Sect's ceremonial gates are standalone four-view sprites.
      // Camp fence gates keep their existing small wooden atlas images.
      if(Math.abs(dx)===r&&Math.abs(dy)<=r&&dy!==0&&['courtyard','road'].includes(t))add('wall',40);
      if(Math.abs(dy)===r&&Math.abs(dx)<=r&&dx!==0&&['courtyard','road'].includes(t))add('wall',40);
      if((Math.abs(dx)===r&&dy===0)||(Math.abs(dy)===r&&dx===0))add('sect-gate',100,dx===r?'east':dx===-r?'west':dy===r?'south':'north');
      if(t==='courtyard'&&Math.abs(dx)>=6&&Math.abs(dx)<=8&&Math.abs(dy)>=6&&Math.abs(dy)<=8&&(dx+dy)%2===0)add('garden',38);
      if(t==='courtyard'&&((Math.abs(dx)===20&&dy%4===0)||(Math.abs(dy)===20&&dx%4===0)))add('lantern',42);
      // Ceremonial lantern avenues, paired gate stelae and hanging banners.
      // These are seeded visual props only; all existing roads stay passable.
      if(t==='courtyard'&&Math.abs(dx)===2&&dy>=-11&&dy<=18&&Math.abs(dy)%4===2)add('lantern',42);
      if(t==='courtyard'&&Math.abs(dy)===2&&Math.abs(dx)<=18&&Math.abs(dx)%4===2)add('lantern',42);
      if(t==='courtyard'&&((Math.abs(dy)===r-1&&Math.abs(dx)===2)||(Math.abs(dx)===r-1&&Math.abs(dy)===2)))add('obelisk',43);
      if(t==='courtyard'&&((Math.abs(dy)===r-2&&Math.abs(dx)===3)||(Math.abs(dx)===r-2&&Math.abs(dy)===3)))add('banner',38);
      return items;
    }
    function sect(){
      const items=[],add=(prop,dx,dy,w,h=w,anchor=.88,extra={})=>items.push({prop,x:W.SPAWN.x+dx+.5,y:W.SPAWN.y+dy+.5,w,h,size:w,anchor,owner:'wendao-gardens',occludes:true,...extra});
      for(const p of W.SECT_LANDMARKS||[])add(p.prop,p.dx,p.dy,p.w,p.h,p.anchor,{footprint:p.footprint});
      add('sect-medallion',0,0,232,232,.5,{layer:'ground',occludes:false});
      add('sect-medallion',0,13,152,152,.5,{layer:'ground',occludes:false});
      for(const side of [-1,1]){
        for(const dy of [-7,0,6]){
          const dx=side*(13+Math.round(Math.sin((dy+4)/7)*1.4));
          add('sect-bridge-ew',dx,dy,190,105,.55,{layer:'ground',occludes:false,bridge:true});
        }
        for(const dy of [7,19])add(side<0?'sect-lion-right':'sect-lion-left',side*3,dy,74,86,.9);
        for(const [dx,dy]of [[8,-13],[18,-12],[8,12],[18,4],[7,18]])add('sect-magnolia',side*dx,dy,128,142,.92);
        for(const dy of [-9,11])add('sect-censer',side*5,dy,80,88,.9);
        for(const [dx,dy]of [[9,12],[12,13],[10,15],[14,14]])add('sect-lotus',side*dx,dy,50,50,.5,{layer:'ground',occludes:false,water:true});
        // Small matching garden furniture keeps the broad lawns intentional.
        for(const [dx,dy]of [[18,-17],[9,-18],[19,16]])add('bonsai',side*dx,dy,72,72,.88);
      }
      return items;
    }
    const sectItems=sect();
    const intersects=(p,b)=>p.x+p.w/80>b.x&&p.x-p.w/80<b.x+b.w&&
      p.y+p.h*(1-p.anchor)/40>b.y&&p.y-p.h*p.anchor/40<b.y+b.h;
    function site(o,events={}){
      if(!isSite(o))return [];
      const subtype=o.kind==='building'?o.id:o.kind==='realm'?'realm':o.subtype,h=W.hash(o.x,o.y,110),items=[];
      // Every existing building has one front-facing image. Its door and surrounding
      // layout stay south-facing; only fences, gates and other props have variants.
      const turn=0;
      const add=(prop,dx,dy,size=34,facing='south')=>{
        for(let i=0;i<turn;i++){const a=dx;dx=-dy;dy=a;}
        const x=o.x+dx,y=o.y+dy,tx=Math.floor(x+.5),ty=Math.floor(y+.5);
        if(!W.inside(tx,ty)||!DRY.has(W.terrain(tx,ty,events))||W.terrain(tx,ty,events)==='road'||W.objectAt(tx,ty))return;
        items.push({x:x+.5,y:y+.6,prop,size,direction:['gate','broken-wall','pillar','rubble','supplies'].includes(prop)?DIRECTIONS[(DIRECTIONS.indexOf(facing)+turn)%4]:null,owner:o.id});
      };
      if(subtype==='camp'){
        for(const x of [-2,-1,0,1,2])add('fence',x,-2,40);
        for(const y of [-1,0,1]){add('fence',-2,y,40);add('fence',2,y,40);}
        for(const x of [-2,-1,1,2])add('fence',x,2,40);
        add('gate',0,2,54);add('supplies',-1,1,31);add('fire',1,1,24);add('logs',-1,-1,27);
      }else if(subtype==='ruins'){
        add('broken-wall',-2,-1,45,'west');add('broken-wall',2,-1,43,'east');
        add('pillar',-1,-2,36,'north');add('pillar',2,1,34);
        for(const [x,y]of [[-2,1],[-1,2],[1,2],[2,-2]])add('rubble',x,y,29+(h%5));
      }else if(subtype==='watchtower'){
        add('fence',-2,0,46,'west');add('fence',2,0,46,'east');add('supplies',-1,1,30);add('lantern',1,1,29);
      }else if(subtype==='shrine'||subtype==='realm'){
        add('pillar',-2,-1,37,'west');add('pillar',2,-1,37,'east');
        add('crystals',-2,1,30);add('obelisk',2,1,34);
        add(subtype==='realm'&&/靈泉/.test(o.name)?'reeds':'lantern',-1,2,31);add('banner',1,2,34);
      }else if(subtype==='forge'){
        add('weapons',-1,1,30);add('ore',1,1,29);add('logs',2,0,25);
      }else if(subtype==='contract'){
        add('weapons',-1,1,30);add('obelisk',1,1,28);
      }else if(subtype==='raid'){
        add('pillar',-2,0,35,'west');add('pillar',2,0,35,'east');add('rubble',1,1,27);
      }else{
        add(subtype==='vault'?'supplies':subtype==='rank'?'scrolls':'bonsai',-1,1,31);add('lantern',1,1,29);
        if(subtype==='meditation')add('bamboo',-2,-1,36);
        if(subtype==='duel')add('wall',2,-1,42,'east');
        if(['meditation','rank','duel','raid'].includes(subtype)){add('banner',-2,1,34);add('banner',2,1,34);}
      }
      return items;
    }
    function inBounds(bounds,events={},visible=()=>true){
      const objects=W.objectsIn({x:bounds.x-4,y:bounds.y-4,w:bounds.w+8,h:bounds.h+11}),sites=objects.filter(o=>isSite(o)&&visible(o.x,o.y)),reserved=new Set(),items=[],occupied=new Set();
      for(const o of sites)for(let y=o.y-2;y<=o.y+2;y++)for(let x=o.x-2;x<=o.x+2;x++)reserved.add(W.key(x,y));
      for(const o of sites.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))for(const item of site(o,events)){
        const x=Math.floor(item.x),y=Math.floor(item.y),k=W.key(x,y);
        if(visible(x,y)&&!occupied.has(k)){occupied.add(k);items.push(item);}
      }
      for(let y=Math.max(0,Math.floor(bounds.y)-1);y<Math.min(W.SIZE,bounds.y+bounds.h+5);y++)for(let x=Math.max(0,Math.floor(bounds.x)-2);x<Math.min(W.SIZE,bounds.x+bounds.w+2);x++){
        if(!visible(x,y))continue;
        const plants=ambient(x,y,W.terrain(x,y,events),events);
        items.push(...(reserved.has(W.key(x,y))?plants.filter(p=>p.prop==='wall'||isGate(p)):plants));
      }
      // Architectural sprites are clipped by their actual multi-tile extents,
      // not their anchor cell. Panning cannot pop a palace roof or bridge away.
      for(const p of sectItems){
        if(!visible(Math.floor(p.x),Math.floor(p.y))||!intersects(p,bounds))continue;
        if(p.footprint){const f=p.footprint;let known=true;for(let dy=0;dy<f.h;dy++)for(let dx=0;dx<f.w;dx++)if(!visible(W.SPAWN.x+f.x+dx,W.SPAWN.y+f.y+dy))known=false;if(!known)continue;}
        if(p.bridge&&W.terrain(Math.floor(p.x),Math.floor(p.y),events)!=='bridge')continue;
        if(p.water&&!WATER.has(W.terrain(Math.floor(p.x),Math.floor(p.y),events)))continue;
        items.push(p);
      }
      // Include tall canopies rooted below or beside the viewport. The halo
      // covers the largest 184px sprite at 40px/tile, including seeded offsets.
      return connect(items).filter(p=>{
        if(p.owner==='wendao-gardens')return intersects(p,bounds);
        const bamboo=p.prop.startsWith('bamboo-tall-'),side=bamboo?2:0;
        return p.x>=bounds.x-side&&p.x<bounds.x+bounds.w+side&&p.y>=bounds.y-(bamboo?1:0)&&p.y<bounds.y+bounds.h+(bamboo?5:0);
      });
    }
    return Object.freeze({world,topology,ambient,site,sect:()=>sectItems,inBounds});
  }
  const api=Object.freeze({DIRECTIONS,STEPS,isBarrier,connect,create});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldScenery=api;
})(globalThis);
