/* Private prism weapon combat rules. Geometry and ordered hit intents are
 * shared by both modes. Existing combat adapters own authoritative damage. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'));
  else root.QAPrismRules=factory(root.QAWeaponGeometry);
})(globalThis,G=>{
  'use strict';
  const kinds=new Set(['prism-slash','prism-reflect','prism-scatter']);
  const supports=sk=>kinds.has(sk?.kind);
  const point=p=>({x:p.x,y:p.y}),key=G.key;
  const targetId=e=>String(e.uid??e.id);
  const boardForTrial=s=>({width:s.width,height:s.height,blocked:p=>s.blocks.some(b=>key(b)===key(p))});
  const boardForDungeon=m=>({width:m.width,height:m.height,blocked:p=>Number(m.tiles[p.y*m.width+p.x])===0});
  function direction(a,b){
    if(!Number.isSafeInteger(b?.x)||!Number.isSafeInteger(b?.y))return null;
    const dx=b.x-a.x,dy=b.y-a.y;
    if((!dx&&!dy)||(dx&&dy&&Math.abs(dx)!==Math.abs(dy)))return null;
    return {x:Math.sign(dx),y:Math.sign(dy)};
  }
  function build(board,origin,sk,dir){
    if(!supports(sk)||!dir||!G.open(board,origin)||!G.DIRS.some(d=>key(d)===key(dir)))return null;
    const first=G.traceRay(board,origin,dir,sk.unlimited?Math.max(board.width,board.height):sk.range);
    if(!first.cells.length)return null;
    const rays=[];
    function append(start,d,trace,depth,parent,power){
      const ray={id:rays.length,parent,depth,origin:point(start),direction:point(d),cells:trace.cells.map(point),collision:trace.collision,power};
      rays.push(ray);return ray;
    }
    const initial=append(origin,dir,first,0,null,sk.powers?.initial??sk.power);
    if(sk.kind==='prism-reflect'&&initial.collision){
      const h=initial.collision,ref=G.normalRay(board,h,sk.reflectionRange);
      if(ref.cells.length)append(h.from,h.normal,ref,1,initial.id,sk.powers.reflected);
    }else if(sk.kind==='prism-scatter'){
      // Breadth-first, fixed angular order; all siblings share a beat.
      for(let i=0;i<rays.length;i++){
        const ray=rays[i];if(ray.depth>=sk.maxDepth||!ray.collision)continue;
        for(const turn of sk.branchTurns){
          const d=G.rotate(ray.direction,turn),start=ray.collision.from;
          const trace=G.traceRay(board,start,d);
          if(!trace.cells.length)continue;
          if(rays.length>=sk.maxRays)throw new Error('prism ray limit exceeded');
          append(start,d,trace,ray.depth+1,ray.id,ray.depth===0?sk.powers.first:sk.powers.second);
        }
      }
    }
    const cells=[...new Map(rays.flatMap(r=>r.cells).map(p=>[key(p),p])).values()];
    return {direction:point(dir),aims:first.cells.map(point),cells,rays};
  }
  function plans(board,origin,sk){
    const result={aims:[],cells:[],byAim:{},byDirection:{}},union=new Map();
    if(!supports(sk))return result;
    for(const dir of G.DIRS){
      const plan=build(board,origin,sk,dir);if(!plan)continue;
      result.byDirection[key(dir)]=plan;
      for(const p of plan.aims){result.aims.push(p);result.byAim[key(p)]=plan;}
      for(const p of plan.cells)union.set(key(p),p);
    }
    result.cells=[...union.values()];return result;
  }
  function selected(board,origin,sk,aim){
    const dir=direction(origin,aim);if(!dir)return null;
    const plan=build(board,origin,sk,dir);
    return plan?.aims.some(p=>key(p)===key(aim))?plan:null;
  }
  // Each target is counted once per ray even for a 2x2 footprint.
  // A cap is per enemy and never limits total crowd damage.
  function hitIntents(plan,sk,enemies,covers=(e,p)=>G.footprint(e).some(q=>key(q)===key(p))){
    const used=new Map(),out=[];
    const ordered=enemies.slice().sort((a,b)=>targetId(a)<targetId(b)?-1:targetId(a)>targetId(b)?1:0);
    for(const ray of plan.rays)for(const enemy of ordered){
      const cell=ray.cells.find(p=>covers(enemy,p));if(!cell)continue;
      const uid=targetId(enemy),remaining=sk.maxTargetPower===undefined?Infinity:sk.maxTargetPower-(used.get(uid)||0);
      const power=Math.min(ray.power,remaining);if(power<=1e-10)continue;
      used.set(uid,(used.get(uid)||0)+power);
      out.push({uid,rayId:ray.id,depth:ray.depth,power,cell:point(cell)});
    }
    return out;
  }
  function resolve(plan,sk,enemies,apply,covers){
    const hits=[];
    for(const h of hitIntents(plan,sk,enemies,covers)){
      const result=apply(h);if(result!=null)hits.push({...h,...result});
    }
    return hits;
  }
  return Object.freeze({supports,boardForTrial,boardForDungeon,direction,build,plans,selected,hitIntents,resolve});
});
