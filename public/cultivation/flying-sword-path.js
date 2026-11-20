/* Shared four-direction flying-sword routes: the server is authoritative. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAFlyingSwordPath=api;
})(globalThis,()=>{
  'use strict';
  const DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
  const key=p=>p.x+','+p.y;
  const valid=p=>p&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y);
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  function neighbours(p,walkable){
    return DIRS.map(([dx,dy])=>({x:p.x+dx,y:p.y+dy})).filter(walkable);
  }
  function distances(from,walkable,maxSteps=2048){
    if(!valid(from)||!walkable(from))return new Map();
    const seen=new Map([[key(from),0]]),queue=[{x:from.x,y:from.y}];
    for(let i=0;i<queue.length;i++){
      const at=queue[i],d=seen.get(key(at));
      if(d>=maxSteps)continue;
      for(const p of neighbours(at,walkable)){
        const k=key(p);
        if(seen.has(k))continue;
        seen.set(k,d+1);queue.push(p);
      }
    }
    return seen;
  }
  function occupies(enemy,p){
    const pos=enemy.position||enemy;
    if(!valid(pos))return false;
    const size=typeof enemy.footprint==='number'?{width:enemy.footprint,height:enemy.footprint}:
      enemy.footprint||{width:enemy.kind==='boss'?2:1,height:enemy.kind==='boss'?2:1};
    return p.x>=pos.x&&p.x<pos.x+(size.width||1)&&
      p.y>=pos.y&&p.y<pos.y+(size.height||1);
  }
  function route({from,to,walkable,enemies=[],maxSteps=2048}={}){
    if(!valid(from)||!valid(to)||typeof walkable!=='function'||
      !walkable(from)||!walkable(to))return null;
    if(key(from)===key(to))return [{x:from.x,y:from.y}];
    const first=distances(from,walkable,maxSteps),goal=first.get(key(to));
    if(goal===undefined)return null;
    const last=distances(to,walkable,goal);
    // A shortest path always advances a distance layer toward the destination.
    // Keep distinct hit-sets for each cell so 2x2 beasts are not counted twice.
    const beasts=enemies.filter(e=>e&&e.battleHealth!==0&&e.hp!==0).slice(0,64);
    const masks=new Map();
    const maskAt=p=>{
      const k=key(p);
      if(masks.has(k))return masks.get(k);
      let bits=0n;
      for(let i=0;i<beasts.length;i++)if(occupies(beasts[i],p))bits|=1n<<BigInt(i);
      masks.set(k,bits);return bits;
    };
    const popcount=bits=>{let n=0;for(;bits;bits&=bits-1n)n++;return n;};
    let frontier=new Map([[key(from),[{p:{...from},bits:0n,hits:0,parent:null}]]]);
    for(let step=0;step<goal;step++){
      const next=new Map();
      for(const states of frontier.values())for(const state of states){
        for(const p of neighbours(state.p,walkable)){
          const k=key(p);
          if(first.get(k)!==step+1||last.get(k)!==goal-step-1)continue;
          const bits=state.bits|maskAt(p);
          const bucket=next.get(k)||[];
          if(bucket.some(item=>item.bits===bits))continue;
          bucket.push({p,bits,hits:popcount(bits),parent:state});
          next.set(k,bucket);
        }
      }
      if(!next.size)return null;
      // The short paths on tactical maps are exact; cap pathological branching
      // in large dungeons instead of creating exponential client/server work.
      for(const bucket of next.values())if(bucket.length>128){
        bucket.sort((a,b)=>b.hits-a.hits);
        bucket.length=128;
      }
      frontier=next;
    }
    const terminal=frontier.get(key(to));
    if(!terminal?.length)return null;
    terminal.sort((a,b)=>b.hits-a.hits);
    const out=[];for(let node=terminal[0];node;node=node.parent)out.unshift(node.p);
    return out;
  }
  return Object.freeze({distance,distances,occupies,route});
});
