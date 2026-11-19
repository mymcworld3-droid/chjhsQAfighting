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
