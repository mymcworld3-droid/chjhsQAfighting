/* Private bell combat. Each wave snapshots living targets, settles damage
 * and legal displacement, then queries current footprints for the next wave. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'));
  else root.QABellRules=factory(root.QAWeaponGeometry);
})(globalThis,G=>{
  'use strict';
  const supports=sk=>['bell-strike','bell-shock','bell-echo'].includes(sk?.kind);
  const point=p=>({x:p.x,y:p.y}),id=e=>String(e.uid??e.id);
  const pos=e=>e.position||e;
  const same=(a,b)=>G.key(a)===G.key(b);
  const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  function plans(board,origin,sk){
    const aims=[],byAim={},union=new Map();
    if(!supports(sk)||!G.open(board,origin))return {aims,byAim,cells:[]};
    function add(aim,steps){
      const cells=[...new Map(steps.flatMap(s=>s.cells).map(p=>[G.key(p),p])).values()];
      const plan={origin:point(origin),aim:point(aim),steps,cells};
      aims.push(point(aim));byAim[G.key(aim)]=plan;
      for(const p of cells)union.set(G.key(p),p);
    }
    if(sk.kind==='bell-strike'){
      for(const d of G.CARDINAL){
        const cells=G.traceRay(board,origin,d,sk.range).cells;
        for(const aim of cells)add(aim,[{layer:1,cells,power:sk.power,push:false}]);
      }
    }else if(sk.kind==='bell-shock'){
      add(origin,[{layer:1,cells:G.squareArea(board,origin,sk.radius),power:sk.power,push:true}]);
    }else{
      add(origin,Array.from({length:sk.rings},(_,i)=>({layer:i+1,cells:G.squareRing(board,origin,i+1),power:sk.power,push:true})));
    }
    return {aims,byAim,cells:[...union.values()]};
  }
  const selected=(board,origin,sk,aim)=>plans(board,origin,sk).byAim[G.key(aim)]||null;
  // Match legacy cardinal knockback: dominant axis, horizontal on ties.
  // Use the footprint centre for large enemies instead of their top-left tile.
  function outward(origin,enemy){
    const cells=G.footprint(enemy,pos(enemy));
    if(!cells.length)return null;
    const x=cells.reduce((n,p)=>n+p.x,0)/cells.length-origin.x;
    const y=cells.reduce((n,p)=>n+p.y,0)/cells.length-origin.y;
    return x&&Math.abs(x)>=Math.abs(y)?{x:Math.sign(x),y:0}:y?{x:0,y:Math.sign(y)}:null;
  }
  function resolve(plan,{targets,alive,covers,apply,push,canContinue=()=>true}){
    const steps=[];
    for(const step of plan.steps){
      if(!canContinue())break;
      const candidates=targets().filter(alive).map(enemy=>({enemy,cell:step.cells.find(p=>covers(enemy,p))})).filter(h=>h.cell);
      // Outer targets move first, freeing legal spaces for inner targets.
      // Each target appears once per wave even if several footprint tiles hit.
      candidates.sort((a,b)=>distance(plan.origin,pos(b.enemy))-distance(plan.origin,pos(a.enemy))||
        (id(a.enemy)<id(b.enemy)?-1:id(a.enemy)>id(b.enemy)?1:0));
      const hits=[],moves=[];
      for(const {enemy,cell} of candidates){
        if(!canContinue())break;
        if(!alive(enemy))continue;
        const hit=apply(enemy,step.power,step.layer,point(cell));
        if(hit)hits.push({...hit,uid:id(enemy),layer:step.layer,cell:point(cell)});
        if(step.push&&alive(enemy)){
          const d=outward(plan.origin,enemy),from=point(pos(enemy));
          if(d)push(enemy,d);
          const to=point(pos(enemy));
          if(!same(from,to))moves.push({uid:id(enemy),from,to});
        }
      }
      steps.push({layer:step.layer,cells:step.cells.map(point),hits,moves});
    }
    return steps;
  }
  // One authoritative segment per wave, with the exact displacement endpoints.
  // Consecutive movements finish before the next hit; no jump to final position.
  function timeline(plan,sk,steps,records=null){
    const strike=sk.kind==='bell-strike',echo=sk.kind==='bell-echo';
    const durationMs=strike?260:echo?600:350;
    const segments=steps.map((step,i)=>{
      const impact=strike?130:echo?110*(i+1):175;
      const start=echo?110*i:0,end=echo&&i<steps.length-1?110*(i+2):durationMs;
      const radius=strike?0:echo?step.layer:sk.radius;
      const hits=records?records.filter(h=>h.rayId===step.layer):step.hits;
      return {kind:strike?'ray':'shock',tone:'copper',bell:true,start,impact,end,
        origin:point(plan.origin),target:point(plan.aim),radius,waveFrom:echo?step.layer-1:0,
        cells:step.cells.map(point),
        ...(strike?{rays:[{cells:[point(plan.origin),...step.cells.map(point)],tone:'copper'}]}:{}),
        hits:hits.map(h=>({uid:h.uid,damage:h.damage,absorbed:h.absorbed||0,cell:point(h.cell)})),
        moves:step.moves.map(m=>({uid:m.uid,path:[point(m.from),point(m.to)],style:'slide'}))};
    });
    return {version:2,durationMs,segments};
  }
  return Object.freeze({supports,plans,selected,outward,resolve,timeline});
});
