/* Seeded visual scenery only: never changes terrain, collisions or saved worlds. */
(function(root){
  'use strict';
  const DIRECTIONS=Object.freeze(['north','east','south','west']);
  const STEPS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[1,1],[-1,1]]);
  const ROADS=new Set(['road','bridge','broken-bridge']),WATER=new Set(['water','ocean']);
  const DRY=new Set(['grass','courtyard','mountain','bamboo','forest','desert','snow','swamp','stone','volcano','beach']);
  const isSite=o=>['building','structure','realm'].includes(o.kind);
  const isBarrier=p=>p.prop==='fence'||p.prop==='wall',cell=p=>Math.floor(p.x)+','+Math.floor(p.y);
  // A block owns one centre and only the half-arms leading to compatible neighbours.
  // Resolve after visibility/occupancy, but before viewport clipping (one-cell halo).
  function connect(items){
    const nodes=new Map(),unique=[];
    for(const p of items){
      if(isBarrier(p)||p.prop==='gate'){const k=cell(p);if(nodes.has(k))continue;nodes.set(k,p);}
      unique.push(p);
    }
    return unique.map(p=>{
      if(!isBarrier(p))return p;
      let mask=0;
      for(let i=0;i<4;i++){
        const [dx,dy]=STEPS[i],n=nodes.get((Math.floor(p.x)+dx)+','+(Math.floor(p.y)+dy));
        if(n?.prop===p.prop||n?.prop==='gate'&&((['east','west'].includes(n.direction)?5:10)&(1<<i)))mask|=1<<i;
      }
      return {...p,mask,post:p.prop==='fence'||mask!==5&&mask!==10};
    });
  }
  function create(world){
    const W=world;
    function topology(x,y,t,events={},visible=()=>true){
      const neighbours=STEPS.map(([dx,dy])=>W.inside(x+dx,y+dy)&&visible(x+dx,y+dy)?W.terrain(x+dx,y+dy,events):t);
      let mask=0;neighbours.slice(0,4).forEach((v,i)=>{if(ROADS.has(v))mask|=1<<i;});
      const horizontal=[1,3].reduce((s,i)=>s+Number(ROADS.has(neighbours[i]))*3+Number(DRY.has(neighbours[i])),0);
      const vertical=[0,2].reduce((s,i)=>s+Number(ROADS.has(neighbours[i]))*3+Number(DRY.has(neighbours[i])),0);
      const bridgeDirection=horizontal>=vertical?'east':'south';
      const counts=new Map();for(const v of neighbours)if(DRY.has(v))counts.set(v,(counts.get(v)||0)+1);
      const underlay=Math.max(Math.abs(x-W.SPAWN.x),Math.abs(y-W.SPAWN.y))<=W.CITY_RADIUS?'courtyard':[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'grass';
      // Ground art spans four cells; mirror whole blocks rather than every cell.
      return {x,y,terrain:t,neighbours,mask,underlay,bridgeDirection,key:[t,...neighbours,mask,underlay,bridgeDirection,x&7,y&7].join(':')};
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
        if(t==='bamboo'&&sparse(x,y,42,92))add('bamboo-'+((h>>>12)%3),40+h%9);
        else if(t==='rock')add('rock',44);
        else if(t==='forest'&&sparse(x,y,48,93))add('tree',48+h%9);
        else if(t==='volcano'&&sparse(x,y,13,94,true))add('volcano',39);
        else if(t==='grass'&&h%17===0)add('flowers',22);
        else if(t==='bamboo'&&h%29===0)add('shrub',21);
        else if(t==='swamp'&&h%6===0)add('reeds',30);
        else if(t==='stone'&&sparse(x,y,23,95,true))add('stone-'+((h>>>12)%3),24+h%9);
        else if(t==='mountain'&&sparse(x,y,12,96,true))add('rock',27);
        else if(t==='sealed')add('sealed',44);
        for(const item of items){item.x+=((h>>>8)%101/100-.5)*.3;item.y+=((h>>>17)%101/100-.5)*.2;}
      }
      // Sect walls and gates have actual north/east/south/west illustrations.
      if(Math.abs(dx)===r&&Math.abs(dy)<=r&&dy!==0&&t==='courtyard')add('wall',40);
      if(Math.abs(dy)===r&&Math.abs(dx)<=r&&dx!==0&&t==='courtyard')add('wall',40);
      if((Math.abs(dx)===r&&dy===0)||(Math.abs(dy)===r&&dx===0))add('gate',66,dx===r?'east':dx===-r?'west':dy===r?'south':'north');
      if(t==='courtyard'&&Math.abs(dx)>=6&&Math.abs(dx)<=8&&Math.abs(dy)>=6&&Math.abs(dy)<=8&&(dx+dy)%2===0)add('garden',38);
      if(t==='courtyard'&&((Math.abs(dx)===8&&dy%4===0)||(Math.abs(dy)===8&&dx%4===0)))add('lantern',29);
      return items;
    }
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
        add('rubble',-2,1,27,'west');add('rubble',2,1,28,'east');
        add(subtype==='realm'&&/靈泉/.test(o.name)?'reeds':'lantern',-1,2,29);add('shrub',1,2,27);
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
      }
      return items;
    }
    function inBounds(bounds,events={},visible=()=>true){
      const objects=W.objectsIn({x:bounds.x-4,y:bounds.y-4,w:bounds.w+8,h:bounds.h+8}),sites=objects.filter(o=>isSite(o)&&visible(o.x,o.y)),reserved=new Set(),items=[],occupied=new Set();
      for(const o of sites)for(let y=o.y-2;y<=o.y+2;y++)for(let x=o.x-2;x<=o.x+2;x++)reserved.add(W.key(x,y));
      for(const o of sites.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))for(const item of site(o,events)){
        const x=Math.floor(item.x),y=Math.floor(item.y),k=W.key(x,y);
        if(visible(x,y)&&!occupied.has(k)){occupied.add(k);items.push(item);}
      }
      for(let y=Math.max(0,bounds.y-1);y<Math.min(W.SIZE,bounds.y+bounds.h+1);y++)for(let x=Math.max(0,bounds.x-1);x<Math.min(W.SIZE,bounds.x+bounds.w+1);x++){
        if(!visible(x,y))continue;
        const plants=ambient(x,y,W.terrain(x,y,events),events);
        items.push(...(reserved.has(W.key(x,y))?plants.filter(p=>p.prop==='wall'||p.prop==='gate'):plants));
      }
      return connect(items).filter(p=>p.x>=bounds.x&&p.x<bounds.x+bounds.w&&p.y>=bounds.y&&p.y<bounds.y+bounds.h);
    }
    return Object.freeze({world,topology,ambient,site,inBounds});
  }
  const api=Object.freeze({DIRECTIONS,STEPS,isBarrier,connect,create});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorldScenery=api;
})(globalThis);
