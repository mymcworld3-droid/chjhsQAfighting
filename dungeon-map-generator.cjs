'use strict';

// Immutable procedural blueprint v1 for cooperative dungeon exploration.
// The only inputs are the room's server-issued seed and this layout version.
// Never change this version's geometry: old rooms must regenerate identically.
const LAYOUT_VERSION=1; // immutable legacy geometry for existing rooms
const FAST_LAYOUT_VERSION=2; // newly created ~5-minute exploration
const CURRENT_LAYOUT_VERSION=FAST_LAYOUT_VERSION;
const supportedVersion=version=>version===LAYOUT_VERSION||version===FAST_LAYOUT_VERSION;
const WALL=0, CORRIDOR=1, CHAMBER=2;
const BIOMES=Object.freeze([
  {id:'bamboo',name:'青竹幽徑'},
  {id:'ruins',name:'殘碑古道'},
  {id:'frost',name:'霜嶺石窟'},
  {id:'marsh',name:'雲隱荒澤'}
]);
const DIRS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
const key=p=>p.x+','+p.y;
function hash(str){
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);h=Math.imul(h,16777619);
  }
  return h>>>0;
}
function randomGenerator(seed){
  let state=hash(seed)||0x6d2b79f5;
  const next=()=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)/4294967296;
  };
  const int=n=>Math.floor(next()*n);
  const shuffle=items=>{
    const result=items.slice();
    for(let i=result.length-1;i>0;i--){
      const j=int(i+1);[result[i],result[j]]=[result[j],result[i]];
    }
    return result;
  };
  return {next,int,shuffle};
}
const validSeed=seed=>typeof seed==='string'&&
  seed.length>=1&&seed.length<=128&&/^[A-Za-z0-9_.:-]+$/.test(seed);
function expanded(points){
  const route=[];
  for(const p of points){
    if(!route.length){route.push({x:p.x,y:p.y});continue;}
    const previous=route[route.length-1];
    const dx=Math.sign(p.x-previous.x),dy=Math.sign(p.y-previous.y);
    const steps=Math.abs(p.x-previous.x)+Math.abs(p.y-previous.y);
    if(dx&&dy)throw new Error('主路線不得包含對角移動');
    for(let i=1;i<=steps;i++)route.push({x:previous.x+dx*i,y:previous.y+dy*i});
  }
  return route;
}
function turns(route){
  let count=0;
  for(let i=2;i<route.length;i++){
    const a=route[i-1],b=route[i],c=route[i-2];
    if(a.x-c.x!==b.x-a.x||a.y-c.y!==b.y-a.y)count++;
  }
  return count;
}
function makeCandidate(seed,attempt,version=LAYOUT_VERSION){
  const fast=version===FAST_LAYOUT_VERSION;
  const rng=randomGenerator(seed+':dungeon:v'+version+':attempt:'+attempt);
  const logicalWidth=(fast?8:11)+rng.int(2);
  const logicalHeight=(fast?7:9)+rng.int(2);
  const width=logicalWidth*4+3,height=logicalHeight*4+3;
  const start={x:0,y:2+rng.int(logicalHeight-4)};
  const inside=p=>p.x>=0&&p.y>=0&&p.x<logicalWidth&&p.y<logicalHeight;
  const neighbors=p=>DIRS.map(([dx,dy])=>({x:p.x+dx,y:p.y+dy})).filter(inside);
  const parents=new Map([[key(start),null]]);
  const depth=new Map([[key(start),0]]);
  const stack=[start];
  // A randomized depth-first spanning tree gives a winding, non-self-
  // intersecting spine without any risk of an unreachable maze segment.
  while(stack.length){
    const current=stack[stack.length-1];
    const available=rng.shuffle(neighbors(current).filter(p=>!parents.has(key(p))));
    if(!available.length){stack.pop();continue;}
    const n=available[0];
    parents.set(key(n),current);
    depth.set(key(n),depth.get(key(current))+1);
    stack.push(n);
  }
  const farthest=[...depth].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(!farthest||farthest[1]<(fast?18:29))return null;
  const farRoute=[];
  for(let current=farthest[0];current;){
    const [x,y]=current.split(',').map(Number);
    farRoute.push({x,y});
    const parent=parents.get(current);
    current=parent?key(parent):null;
  }
  farRoute.reverse();
  // A shorter spine and two optional branches preserve the guardian/key
  // objective without turning exploration into an eight-minute maze.
  const targetLength=fast?14+rng.int(4):23+rng.int(6);
  const main=farRoute.slice(0,targetLength);
  if(main.length!==targetLength||turns(main)<(fast?4:5))return null;
  const occupied=new Set(main.map(key));
  const requestedBranches=fast?2:2+rng.int(3);
  const possibleOrigins=rng.shuffle(main.map((p,index)=>({p,index}))
    .filter(item=>item.index>=(fast?3:4)&&item.index<=main.length-(fast?6:9)));
  const branches=[],origins=[];
  function grow(origin,wanted){
    const selected=[],local=new Set();
    function search(current){
      if(selected.length===wanted)return true;
      const candidates=rng.shuffle(neighbors(current)
        .filter(p=>!occupied.has(key(p))&&!local.has(key(p))));
      for(const n of candidates){
        const k=key(n);local.add(k);selected.push(n);
        if(search(n))return true;
        selected.pop();local.delete(k);
      }
      return false;
    }
    return search(origin)?selected.slice():null;
  }
  for(const {p,index} of possibleOrigins){
    if(branches.length>=requestedBranches)break;
    if(origins.some(other=>Math.abs(other-index)<3))continue;
    // A branch is deliberately shorter than the remaining primary spine,
    // keeping the key guardian at the unambiguous deepest destination.
    const length=fast?2+rng.int(2):3+rng.int(3);
    const side=grow(p,length);
    if(!side)continue;
    for(const point of side)occupied.add(key(point));
    origins.push(index);
    branches.push({originIndex:index,nodes:[p,...side]});
  }
  if(branches.length!==requestedBranches)return null;
  branches.sort((a,b)=>a.originIndex-b.originIndex);
  const pixel=p=>({x:3+4*p.x,y:3+4*p.y});
  const tiles=Array(width*height).fill(WALL);
  const put=(x,y,value)=>{
    if(x<1||y<1||x>=width-1||y>=height-1)
      throw new Error('副本地圖超出邊界');
    const at=y*width+x;
    tiles[at]=Math.max(tiles[at],value);
  };
  // Each logical node occupies a 2x2 room. Connecting edges are 2-wide;
  // unconnected nodes remain separated by at least one solid wall.
  const carveNode=(p,large)=>{
    const {x,y}=pixel(p);
    for(let yy=y-(large?1:0);yy<=y+1;yy++)
      for(let xx=x-(large?1:0);xx<=x+1;xx++)
        put(xx,yy,large?CHAMBER:CORRIDOR);
  };
  const carveLink=(a,b)=>{
    const start=pixel(a),end=pixel(b);
    if(Math.abs(start.x-end.x)+Math.abs(start.y-end.y)!==4)
      throw new Error('路線連結不相鄰');
    for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++)
      for(let step=0;step<=4;step++){
        put(start.x+dx+Math.sign(end.x-start.x)*step,
          start.y+dy+Math.sign(end.y-start.y)*step,CORRIDOR);
      }
  };
  for(const p of main)carveNode(p,false);
  for(let i=1;i<main.length;i++)carveLink(main[i-1],main[i]);
  for(const branch of branches){
    for(const p of branch.nodes.slice(1))carveNode(p,false);
    for(let i=1;i<branch.nodes.length;i++)carveLink(branch.nodes[i-1],branch.nodes[i]);
  }
  // Selected clearings make terrain irregular without creating unintended
  // shortcuts between otherwise separate cave passages.
  const entrancesAndEnds=new Set([
    key(main[0]),key(main[main.length-1]),key(main[main.length-2]),
    ...branches.map(b=>key(b.nodes[b.nodes.length-1])),
    ...branches.map(b=>key(b.nodes[0]))
  ]);
  for(const p of [...main,...branches.flatMap(b=>b.nodes.slice(1))]){
    if(entrancesAndEnds.has(key(p))||rng.next()<.37)carveNode(p,true);
  }
  const mainRoute=expanded(main.map(pixel));
  const branchesOut=branches.map((branch,index)=>{
    const route=expanded(branch.nodes.map(pixel));
    return {id:'branch-'+(index+1),originIndex:branch.originIndex,
      entrance:route[0],end:route[route.length-1],route};
  });
  const entrance=mainRoute[0],deepest=mainRoute[mainRoute.length-1];
  const portalSite=mainRoute[mainRoute.length-5]; // one logical step toward the exit
  const guardianSite=deepest;
  const spawnPads=[{...entrance},{x:entrance.x+1,y:entrance.y},
    {x:entrance.x,y:entrance.y+1},{x:entrance.x+1,y:entrance.y+1}];
  const walkableCount=tiles.reduce((sum,tile)=>sum+(tile!==WALL?1:0),0);
  const biome=BIOMES[rng.int(BIOMES.length)];
  const fingerprint=hash(seed+(fast?'|v2':'')+'|'+width+':'+height+':'+tiles.join(''));
  return {
    mode:'dungeon',layoutVersion:version,seed,
    layoutId:'dungeon-v'+version+'-'+fingerprint.toString(16).padStart(8,'0'),
    width,height,tiles,biome:biome.id,title:biome.name,
    spawn:entrance,spawnPads,entrance,deepest,guardianSite,portalSite,
    mainRoute,mainTurns:turns(main),branches:branchesOut,
    branchCount:branchesOut.length,walkableCount
  };
}
function generateDungeonLayout(seed,version=LAYOUT_VERSION){
  if(!validSeed(seed))throw new TypeError('地圖種子碼無效');
  if(!supportedVersion(version))throw new RangeError('不支援的副本地圖版本');
  for(let attempt=0;attempt<64;attempt++){
    const candidate=makeCandidate(seed,attempt,version);
    if(candidate)return candidate;
  }
  throw new Error('無法生成符合連通性與支線限制的副本地圖');
}
const walkable=(layout,p)=>{
  if(!layout||!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||
    p.x<0||p.y<0||p.x>=layout.width||p.y>=layout.height)return false;
  return Number(layout.tiles[p.y*layout.width+p.x])!==WALL;
};
module.exports={LAYOUT_VERSION,FAST_LAYOUT_VERSION,CURRENT_LAYOUT_VERSION,
  supportedVersion,WALL,CORRIDOR,CHAMBER,BIOMES,generateDungeonLayout,walkable};
module.exports.__test={hash,randomGenerator,turns,makeCandidate};
