/* Shared deterministic terrain and movement rules. No player or network state. */
(function (root) {
  'use strict';
  const SIZE = 48, VERSION = 'qingyun-48-v1', STEP_MS = 220;
  const SPAWN = Object.freeze({x:9,y:36});
  const DIRS = Object.freeze([[0,1],[1,0],[0,-1],[-1,0]]);
  const OBJECTS = Object.freeze([
    {id:'meditation',x:5,y:31,kind:'building',name:'修煉室',icon:'修',entry:'core'},
    {id:'forge',x:13,y:32,kind:'building',name:'鍛造坊',icon:'煉',entry:'refinery'},
    {id:'contract',x:14,y:39,kind:'building',name:'契器閣',icon:'契',entry:'contract'},
    {id:'vault',x:5,y:39,kind:'building',name:'寶庫',icon:'庫',entry:'bag'},
    {id:'rank',x:4,y:35,kind:'building',name:'仙榜',icon:'榜',entry:'rank'},
    {id:'quest',x:11,y:34,kind:'npc',name:'宗門執事',icon:'任'},
    {id:'duel',x:16,y:35,kind:'building',name:'論道台',icon:'鬥',entry:'duel'},
    {id:'raid',x:17,y:31,kind:'building',name:'秘境之門',icon:'境',entry:'raid'},
    {id:'herb-a',x:12,y:26,kind:'gather',name:'青靈木',material:'qi-spirit-wood',icon:'木'},
    {id:'ore-a',x:21,y:23,kind:'gather',name:'玄鐵礦',material:'qi-spirit-iron',icon:'鐵'},
    {id:'herb-b',x:23,y:13,kind:'gather',name:'青靈木',material:'qi-spirit-wood',icon:'木'},
    {id:'ore-b',x:34,y:14,kind:'gather',name:'玄鐵礦',material:'qi-spirit-iron',icon:'鐵'},
    {id:'chest-a',x:19,y:26,kind:'chest',name:'林間遺箱',icon:'寶'},
    {id:'chest-b',x:33,y:27,kind:'chest',name:'溪畔遺箱',icon:'寶'},
    {id:'chest-array',x:39,y:4,kind:'chest',name:'古陣秘藏',icon:'寶'},
    {id:'wolf',x:18,y:22,kind:'monster',name:'竹林靈狼',icon:'狼',hp:700,atk:150},
    {id:'boar',x:22,y:18,kind:'monster',name:'玄甲山豬',icon:'獸',hp:850,atk:170},
    {id:'sister',x:20,y:29,kind:'monster',name:'大師姐・試劍',icon:'劍',hp:1600,atk:210,elite:true},
    {id:'sentinel',x:37,y:12,kind:'monster',name:'古陣守衛',icon:'衛',hp:1400,atk:200,elite:true},
    {id:'bridge',x:25,y:27,kind:'event',name:'修復青溪橋',icon:'橋'},
    {id:'array',x:39,y:8,kind:'event',name:'共破古陣',icon:'陣'}
  ].map(Object.freeze));
  const key = (x,y) => x+','+y;
  const index = (x,y) => y*SIZE+x;
  const inside = (x,y) => Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<SIZE&&y<SIZE;
  const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const same = (a,b) => !!a&&!!b&&a.x===b.x&&a.y===b.y;
  const hash = (x,y) => ((Math.imul(x+91,73856093)^Math.imul(y+17,19349663))>>>0);
  const objectAt = (x,y) => OBJECTS.find(o=>o.x===x&&o.y===y);
  const object = id => OBJECTS.find(o=>o.id===id);
  function makeTerrain() {
    const cells = Array.from({length:SIZE*SIZE},(_,i)=>{
      const x=i%SIZE,y=Math.floor(i/SIZE),h=hash(x,y);
      if(!x||!y||x===47||y===47)return 'rock';
      if(x>=26&&x<=27&&y<=33)return 'water';
      if(x>30&&y<19)return h%9===0?'rock':'mountain';
      if(y<30&&x<26)return h%7===0?'bamboo':'grass';
      return h%43===0?'rock':'grass';
    });
    const set=(x,y,t)=>{if(inside(x,y))cells[index(x,y)]=t;};
    const rect=(x,y,w,h,t)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)set(i,j,t);};
    rect(2,30,16,15,'courtyard');
    function road(a,b){let x=a.x,y=a.y;set(x,y,'road');while(x!==b.x||y!==b.y){if(x!==b.x)x+=Math.sign(b.x-x);else y+=Math.sign(b.y-y);set(x,y,'road');}}
    const waypoints=[SPAWN,{x:9,y:28},{x:18,y:28},{x:18,y:17},{x:32,y:17},{x:32,y:9},{x:42,y:9}];
    waypoints.slice(1).forEach((p,i)=>road(waypoints[i],p));
    road({x:9,y:36},{x:16,y:36});road({x:9,y:36},{x:9,y:42});
    road({x:18,y:27},{x:35,y:27});
    // The north crossing is always open; repairing the south bridge adds a shortcut.
    rect(26,17,2,1,'bridge');rect(26,27,2,1,'broken-bridge');
    for(const o of OBJECTS){
      // Interactions always have a clear approach. This is shared terrain, not random per login.
      for(let y=o.y-1;y<=o.y+1;y++)for(let x=o.x-1;x<=o.x+1;x++){
        if(['bamboo','rock'].includes(cells[index(x,y)]))set(x,y,o.y<19&&x>30?'mountain':'grass');
      }
      set(o.x,o.y,o.kind==='building'?'courtyard':o.y<19&&o.x>30?'mountain':'grass');
    }
    // Completing the shared array opens the only entrance to its optional treasure court.
    rect(36,2,7,5,'mountain');rect(36,2,7,1,'rock');rect(36,6,7,1,'rock');
    rect(36,2,1,5,'rock');rect(42,2,1,5,'rock');set(39,6,'sealed');
    return Object.freeze(cells);
  }
  const TERRAIN = makeTerrain();
  function terrain(x,y,events={}) {
    const t=inside(x,y)?TERRAIN[index(x,y)]:'rock';
    if(t==='sealed'&&events.array>=60)return 'road';
    return t==='broken-bridge'&&events.bridge>=20?'bridge':t;
  }
  function walkable(x,y,{events={},bounds=null,blocked=null,ignoreObjects=false}={}) {
    if(!inside(x,y)||bounds&&(x<bounds.x||y<bounds.y||x>=bounds.x+bounds.w||y>=bounds.y+bounds.h))return false;
    if(['water','rock','bamboo','broken-bridge','sealed'].includes(terrain(x,y,events)))return false;
    const o=objectAt(x,y);
    if(!ignoreObjects&&o&&o.kind==='building')return false;
    return !blocked?.has(key(x,y));
  }
  function known(explored,x,y) {return inside(x,y)&&explored?.[index(x,y)]==='1';}
  function reveal(explored,p,radius=5) {
    const cells=(typeof explored==='string'&&explored.length===SIZE*SIZE?explored:'0'.repeat(SIZE*SIZE)).split('');
    for(let y=Math.max(0,p.y-radius);y<=Math.min(SIZE-1,p.y+radius);y++)
      for(let x=Math.max(0,p.x-radius);x<=Math.min(SIZE-1,p.x+radius);x++)
        if(Math.hypot(x-p.x,y-p.y)<=radius+.3)cells[index(x,y)]='1';
    return cells.join('');
  }
  function initialExplored() {
    const cells='0'.repeat(SIZE*SIZE).split('');
    for(let y=29;y<=46;y++)for(let x=1;x<=18;x++)cells[index(x,y)]='1';
    return reveal(cells.join(''),SPAWN);
  }
  function reachable(start,options={}) {
    const queue=[{x:start.x,y:start.y}],parents=new Map([[key(start.x,start.y),null]]),cost=new Map([[key(start.x,start.y),0]]);
    for(let n=0;n<queue.length;n++){
      const p=queue[n],depth=cost.get(key(p.x,p.y));
      if(depth>=(options.maxSteps??SIZE*SIZE))continue;
      for(const[dx,dy]of DIRS){
        const x=p.x+dx,y=p.y+dy,k=key(x,y);
        if(parents.has(k)||!walkable(x,y,options)||options.explored&&!known(options.explored,x,y))continue;
        const next={x,y};parents.set(k,p);cost.set(k,depth+1);queue.push(next);
      }
    }
    return {cells:queue,parents,cost};
  }
  function pathTo(target,parents) {
    if(!parents.has(key(target.x,target.y)))return [];
    const path=[];for(let p=target;p;p=parents.get(key(p.x,p.y)))path.push({x:p.x,y:p.y});
    return path.reverse();
  }
  function plan(start,target,options={}) {
    if(!inside(target?.x,target?.y))return {path:[],reason:'目的地不在地圖內'};
    const area=reachable(start,options);
    if(area.parents.has(key(target.x,target.y)))return {path:pathTo(target,area.parents),partial:false};
    if(options.explored&&!known(options.explored,target.x,target.y)){
      const frontier=area.cells.filter(p=>DIRS.some(([dx,dy])=>inside(p.x+dx,p.y+dy)&&!known(options.explored,p.x+dx,p.y+dy)))
        .sort((a,b)=>distance(a,target)-distance(b,target)||area.cost.get(key(a.x,a.y))-area.cost.get(key(b.x,b.y)))[0];
      if(frontier)return {path:pathTo(frontier,area.parents),partial:true};
    }
    return {path:[],reason:'此處無法通行，請選擇道路或空地'};
  }
  function approach(start,target,options={}) {
    if(distance(start,target)<=1)return {path:[start],partial:false};
    const choices=DIRS.map(([dx,dy])=>({x:target.x+dx,y:target.y+dy}))
      .filter(p=>walkable(p.x,p.y,options)).map(p=>plan(start,p,options)).filter(p=>p.path.length);
    choices.sort((a,b)=>Number(a.partial)-Number(b.partial)||a.path.length-b.path.length);
    return choices[0]||{path:[],reason:'找不到可接近的道路'};
  }
  function safePosition(p,options={}) {
    if(inside(p?.x,p?.y)&&walkable(p.x,p.y,options))return {x:p.x,y:p.y};
    const origin=inside(p?.x,p?.y)?p:SPAWN;
    for(let d=0;d<SIZE*2;d++)for(let y=Math.max(0,origin.y-d);y<=Math.min(SIZE-1,origin.y+d);y++)
      for(let x=Math.max(0,origin.x-d);x<=Math.min(SIZE-1,origin.x+d);x++)
        if(distance(origin,{x,y})===d&&walkable(x,y,options))return {x,y};
    return {...SPAWN};
  }
  function sample(route,at=Date.now()) {
    const path=route?.path?.length?route.path:[SPAWN],stepMs=route?.stepMs||STEP_MS;
    const progress=Math.max(0,(at-(route?.startedAtMs||0))/stepMs),i=Math.min(path.length-1,Math.floor(progress));
    const a=path[i],b=path[Math.min(i+1,path.length-1)],f=Math.min(1,progress-i);
    const from=i<path.length-1?a:path[Math.max(0,i-1)],to=i<path.length-1?b:a;
    return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,tile:{...a},next:{...b},fraction:f,index:i,
      moving:i<path.length-1,direction:to.x>from.x?'right':to.x<from.x?'left':to.y<from.y?'up':'down'};
  }
  function redirect(route,target,at,options={}) {
    const p=sample(route,at),start=p.moving?p.next:p.tile;
    const result=target?.objectId?approach(start,object(target.objectId),options):plan(start,target,options);
    if(!result.path.length)return result;
    const path=p.moving?[p.tile,...result.path]:result.path;
    return {...result,route:{path,stepMs:STEP_MS,startedAtMs:at-(p.moving?p.fraction*STEP_MS:0)}};
  }
  const zone = p => p.y>=30&&p.x<19?'問道宗':p.x>29&&p.y<20?'古陣山口':'青竹林';
  const api=Object.freeze({SIZE,VERSION,STEP_MS,SPAWN,DIRS,OBJECTS,TERRAIN,key,index,inside,distance,same,hash,
    object,objectAt,terrain,walkable,known,reveal,initialExplored,reachable,pathTo,plan,approach,safePosition,sample,redirect,zone});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QAGridWorld=api;
})(globalThis);
