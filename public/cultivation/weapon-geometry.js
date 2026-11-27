/* Shared grid geometry for future weapons. Coordinates are integer tile
 * centers, screen y increases downward. All functions are deterministic and
 * operate on snapshots; no function changes an actor or the board. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QAWeaponGeometry=api;
})(globalThis,()=>{
  'use strict';
  const point=p=>({x:p.x,y:p.y});
  const key=p=>p.x+','+p.y;
  const integer=p=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y);
  const same=(a,b)=>a.x===b.x&&a.y===b.y;
  const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const DIRS=Object.freeze([[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].map(([x,y])=>Object.freeze({x,y})));
  const CARDINAL=Object.freeze(DIRS.filter((_,i)=>i%2===0));
  const inside=(board,p)=>integer(p)&&p.x>=0&&p.y>=0&&p.x<board.width&&p.y<board.height;
  const open=(board,p)=>inside(board,p)&&!(board.blocked?.(p));
  const add=(p,d)=>({x:p.x+d.x,y:p.y+d.y});
  const unique=points=>[...new Map(points.map(p=>[key(p),point(p)])).values()];
  function directionIndex(d){return DIRS.findIndex(v=>same(v,d));}
  function rotate(d,steps){
    const i=directionIndex(d);if(i<0||!Number.isInteger(steps))throw new RangeError('invalid grid direction');
    return point(DIRS[((i+steps)%8+8)%8]);
  }
  // The face normal points back into walkable space. A diagonal corner with
  // two blocked sides (or a diagonal-only blocked destination) has a diagonal
  // normal; one blocked side identifies that side's axis. No ray enters walls.
  function collision(board,from,d){
    const to=add(from,d);
    const xBlocked=d.x!==0&&!open(board,{x:from.x+d.x,y:from.y});
    const yBlocked=d.y!==0&&!open(board,{x:from.x,y:from.y+d.y});
    const corner=d.x!==0&&d.y!==0&&xBlocked&&yBlocked;
    if(open(board,to)&&!corner)return null;
    let normal={x:-d.x,y:-d.y};
    if(d.x&&d.y&&xBlocked!==yBlocked)normal=xBlocked?{x:-d.x,y:0}:{x:0,y:-d.y};
    return {from:point(from),to,normal,kind:corner?'closed-corner':inside(board,to)?'wall':'edge'};
  }
  function traceRay(board,origin,d,range=Math.max(board.width,board.height)){
    if(directionIndex(d)<0||!Number.isSafeInteger(range)||range<0)throw new RangeError('invalid ray');
    if(!open(board,origin))return {cells:[],collision:null};
    const cells=[];let p=point(origin);
    for(let i=0;i<range;i++){
      const hit=collision(board,p,d);
      if(hit)return {cells,collision:hit};
      p=add(p,d);cells.push(p);
    }
    return {cells,collision:null};
  }
  // A reflected blade follows the collision normal, not specular reflection
  // and not a tangent along the obstacle. It starts at the last legal tile.
  function normalRay(board,hit,range=3){
    return hit?traceRay(board,hit.from,hit.normal,range):{cells:[],collision:null};
  }
  function squareRing(board,center,radius){
    if(!integer(center)||!Number.isSafeInteger(radius)||radius<1)return [];
    const out=[];
    for(let y=center.y-radius;y<=center.y+radius;y++)for(let x=center.x-radius;x<=center.x+radius;x++)
      if(Math.max(Math.abs(x-center.x),Math.abs(y-center.y))===radius&&open(board,{x,y}))out.push({x,y});
    return out;
  }
  function squareArea(board,center,radius,{includeCenter=false}={}){
    if(!integer(center)||!Number.isSafeInteger(radius)||radius<0)return [];
    const cells=includeCenter&&open(board,center)?[point(center)]:[];
    for(let r=1;r<=radius;r++)cells.push(...squareRing(board,center,r));
    return cells;
  }
  // Symmetric center-to-center traversal: integer crossing comparisons avoid
  // floating point tie drift. Exact corner crossings advance both coordinates;
  // the same closed-corner rule as the eight-direction ray then applies.
  function segment(board,a,b){
    if(!open(board,a)||!open(board,b))return {valid:false,cells:[]};
    const nx=Math.abs(b.x-a.x),ny=Math.abs(b.y-a.y),sx=Math.sign(b.x-a.x),sy=Math.sign(b.y-a.y);
    let ix=0,iy=0,p=point(a);const cells=[p];
    while(ix<nx||iy<ny){
      const tx=(1+2*ix)*ny,ty=(1+2*iy)*nx;
      const d={x:0,y:0};
      if(ix<nx&&(iy===ny||tx<=ty)){d.x=sx;ix++;}
      if(iy<ny&&(ix===nx&&d.x===0||ty<=tx)){d.y=sy;iy++;}
      // When one axis is exhausted, the other must advance.
      if(!d.x&&!d.y){if(iy<ny){d.y=sy;iy++;}else{d.x=sx;ix++;}}
      if(collision(board,p,d))return {valid:false,cells};
      p=add(p,d);cells.push(p);
    }
    return {valid:true,cells};
  }
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  function hull(points){
    const pts=unique(points.filter(integer)).sort((a,b)=>a.x-b.x||a.y-b.y);
    if(pts.length<3)return pts;
    const half=seq=>{const stack=[];for(const p of seq){while(stack.length>1&&cross(stack.at(-2),stack.at(-1),p)<=0)stack.pop();stack.push(p);}return stack;};
    const lo=half(pts),hi=half(pts.slice().reverse());return lo.slice(0,-1).concat(hi.slice(0,-1));
  }
  function polygon(board,points){
    const vertices=hull(points);
    if(vertices.length<2)return {valid:false,vertices,cells:[]};
    if(vertices.length===2){const line=segment(board,...vertices);return {valid:line.valid,vertices,cells:line.valid?line.cells:[]};}
    const edges=vertices.map((p,i)=>segment(board,p,vertices[(i+1)%vertices.length]));
    if(edges.some(e=>!e.valid))return {valid:false,vertices,cells:[]};
    const cells=new Map();
    for(const e of edges)for(const p of e.cells)cells.set(key(p),p);
    for(let y=Math.max(0,Math.min(...vertices.map(p=>p.y)));y<=Math.min(board.height-1,Math.max(...vertices.map(p=>p.y)));y++)
      for(let x=Math.max(0,Math.min(...vertices.map(p=>p.x)));x<=Math.min(board.width-1,Math.max(...vertices.map(p=>p.x)));x++){
        const p={x,y};if(open(board,p)&&vertices.every((a,i)=>cross(a,vertices[(i+1)%vertices.length],p)>=0))cells.set(key(p),p);
      }
    return {valid:true,vertices,cells:[...cells.values()].sort((a,b)=>a.y-b.y||a.x-b.x)};
  }
  function mirror(board,p){return {x:board.width-1-p.x,y:board.height-1-p.y};}
  function footprint(actor,position=actor.position||actor){
    const shape=actor.footprint;
    const width=shape?.width??(Number.isInteger(shape)?shape:actor.kind==='boss'||actor.boss?2:1);
    const height=shape?.height??(Number.isInteger(shape)?shape:actor.kind==='boss'||actor.boss?2:1);
    if(!integer(position)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return [];
    const cells=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++)cells.push({x:position.x+x,y:position.y+y});return cells;
  }
  const id=a=>String(a.uid??a.id);
  const living=a=>a.hp!==0&&a.battleHealth!==0&&!a.downed;
  function canPlace(board,actor,position,actors=[],reserved=new Set(),forbidden=new Set()){
    const occupied=new Set(actors.filter(a=>living(a)&&id(a)!==id(actor)).flatMap(a=>footprint(a)).map(key));
    const cells=footprint(actor,position);
    return cells.length>0&&cells.every(p=>open(board,p)&&!occupied.has(key(p))&&!reserved.has(key(p))&&!forbidden.has(key(p)));
  }
  function distanceTo(core,actor,position){return Math.min(...footprint(actor,position).map(p=>dist(core,p)),Infinity);}
  // Clockwise from north, then stable uid. Original footprints remain
  // occupied during assignment, so no overlap, swaps or moves into a tile
  // that another unit has not yet vacated. Reserve complete footprints.
  function pullClockwise(board,core,targets,actors=targets,radius=3){
    const anchor=a=>a.position||a;
    const angle=a=>{const p=anchor(a);return (Math.atan2(p.x-core.x,core.y-p.y)+2*Math.PI)%(2*Math.PI);};
    const order=targets.filter(a=>living(a)&&distanceTo(core,a,anchor(a))<=radius)
      .slice().sort((a,b)=>angle(a)-angle(b)||(id(a)<id(b)?-1:id(a)>id(b)?1:0));
    const reserved=new Set(),forbidden=new Set([key(core)]),moves=[];
    for(const a of order){
      const from=point(anchor(a)),before=distanceTo(core,a,from);
      const clockwise=d=>(from.x-core.x)*d.y-(from.y-core.y)*d.x;
      const dirs=CARDINAL.slice().sort((a,b)=>clockwise(b)-clockwise(a)||directionIndex(a)-directionIndex(b));
      const to=dirs.map(d=>add(from,d)).find(p=>distanceTo(core,a,p)<before&&canPlace(board,a,p,actors,reserved,forbidden))||from;
      for(const p of footprint(a,to))reserved.add(key(p));
      moves.push({uid:id(a),from,to:point(to),moved:!same(from,to)});
    }
    return moves;
  }
  return Object.freeze({DIRS,CARDINAL,key,inside,open,rotate,collision,traceRay,normalRay,squareRing,squareArea,segment,hull,polygon,mirror,footprint,canPlace,pullClockwise});
});
