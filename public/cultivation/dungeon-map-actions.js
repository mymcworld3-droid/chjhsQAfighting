// Local preview pathfinding for the same single-click movement used in
// 問道試煉. This path has no authority: the C-room validates every tile,
// stamina point and enemy occupancy inside the atomic move-route action.
const DIRS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
export function dungeonRoute(map,from,to,enemies=[],maxLength=240){
  if(!map||!Number.isInteger(map.width)||!Number.isInteger(map.height)||
      !Array.isArray(map.tiles)||map.tiles.length!==map.width*map.height)
    return null;
  const {width,height,tiles}=map;
  const index=p=>p?.x>=0&&p.x<width&&p?.y>=0&&p.y<height&&
    Number.isInteger(p.x)&&Number.isInteger(p.y)?p.y*width+p.x:-1;
  const first=index(from),last=index(to);
  if(first<0||last<0||tiles[last]===0||tiles[first]===0)return null;
  if(first===last)return [];
  const blocked=new Set();
  for(const enemy of enemies){
    const p=enemy?.position;
    if(!p)continue;
    const size=enemy.kind==='boss'?2:1;
    for(let y=p.y;y<p.y+size;y++)for(let x=p.x;x<p.x+size;x++){
      const i=index({x,y});if(i>=0)blocked.add(i);
    }
  }
  if(blocked.has(last))return null;
  const came=new Int32Array(tiles.length).fill(-1);
  const dirs=new Int8Array(tiles.length);
  const pending=new Int32Array(tiles.length);
  let head=0,tail=0;
  pending[tail++]=first;came[first]=first;
  while(head<tail&&came[last]===-1){
    const here=pending[head++],x=here%width,y=(here-x)/width;
    for(let d=0;d<DIRS.length;d++){
      const [dx,dy]=DIRS[d],nx=x+dx,ny=y+dy;
      if(nx<0||nx>=width||ny<0||ny>=height)continue;
      const next=ny*width+nx;
      if(tiles[next]===0||blocked.has(next)||came[next]!==-1)continue;
      came[next]=here;dirs[next]=d;pending[tail++]=next;
    }
  }
  if(came[last]===-1)return null;
  const vectors=[];
  for(let at=last;at!==first;at=came[at]){
    if(vectors.length>=Math.min(1024,Math.max(1,maxLength)))return null;
    const [dx,dy]=DIRS[dirs[at]];
    vectors.push({dx,dy});
  }
  return vectors.reverse();
}

// Presentation only. The endpoint still validates every move and cast.
// Matching the trial: grey cells communicate walking, amber/red cells indicate
// attack direction/placement. These never cover any player or creature sprite.
export function dungeonReachableTiles(map,from,enemies=[],stamina=0){
  if(!map||!Array.isArray(map.tiles)||!from)return [];
  const {width:w,height:h,tiles}=map;
  if(!Number.isInteger(w)||!Number.isInteger(h)||tiles.length!==w*h)return [];
  const max=Math.max(0,Math.min(100,Number(stamina)||0));
  if(!max)return [];
  const blocked=new Set();
  for(const e of enemies){
    const p=e?.position;if(!p)continue;
    const size=e.kind==='boss'?2:1;
    for(let y=p.y;y<p.y+size;y++)for(let x=p.x;x<p.x+size;x++)
      if(x>=0&&y>=0&&x<w&&y<h)blocked.add(y*w+x);
  }
  const queue=[{x:from.x,y:from.y,d:0}],visited=new Set([from.y*w+from.x]);
  const result=[];
  for(let i=0;i<queue.length;i++){
    const {x,y,d}=queue[i];
    if(d>=max)continue;
    for(const [dx,dy]of DIRS){
      const nx=x+dx,ny=y+dy,j=ny*w+nx;
      if(nx<0||ny<0||nx>=w||ny>=h||!tiles[j]||
          blocked.has(j)||visited.has(j))continue;
      visited.add(j);result.push({x:nx,y:ny});
      queue.push({x:nx,y:ny,d:d+1});
    }
  }
  return result;
}
export function dungeonAttackTiles(map,from,skill,enemies=[]){
  if(!map||!from||!Array.isArray(map.tiles))return [];
  const {width:w,height:h,tiles}=map;
  const walk=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&tiles[y*w+x]>0;
  const cells=[],seen=new Set();
  const add=(x,y)=>{
    if(!walk(x,y)||seen.has(y*w+x))return false;
    seen.add(y*w+x);cells.push({x,y});return true;
  };
  const kind=skill?.kind||'attack';
  const range=Math.max(0,Math.min(15,Number(skill?.range)||1));
  if(kind==='fist-focus'){add(from.x,from.y);return cells;}
  if(['attack','fist-sweep','fist-throw','fist-chain'].includes(kind)){
    for(const [dx,dy]of DIRS)add(from.x+dx,from.y+dy);
    return cells;
  }
  if(['line','flying-sword','dash-cleave'].includes(kind)){
    for(const [dx,dy]of DIRS){
      for(let n=1;n<=Math.max(1,range);n++){
        const x=from.x+dx*n,y=from.y+dy*n;
        if(!walk(x,y))break;
        const occupies=enemies.some(e=>e?.position&&
          x>=e.position.x&&y>=e.position.y&&
          x<e.position.x+(e.kind==='boss'?2:1)&&
          y<e.position.y+(e.kind==='boss'?2:1));
        if(kind!=='dash-cleave'||!occupies)add(x,y);
        if(kind==='dash-cleave'&&occupies)break;
      }
    }
    return cells;
  }
  // The array center is validated by a server visibility/path check.
  // We deliberately display conservative reachable centers, not a promise
  // that every nominal square can hit an enemy.
  for(let y=Math.max(0,from.y-range);y<=Math.min(h-1,from.y+range);y++)
    for(let x=Math.max(0,from.x-range);x<=Math.min(w-1,from.x+range);x++){
      if(Math.abs(x-from.x)+Math.abs(y-from.y)>range)continue;
      if(walk(x,y))add(x,y);
    }
  return cells;
}
