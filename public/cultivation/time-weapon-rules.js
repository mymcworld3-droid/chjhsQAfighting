/* Private time-sword mechanics: independently validated fixed origins. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'),require('./weapon-special-objects.js'));
  else root.QATimeRules=factory(root.QAWeaponGeometry,root.QAWeaponObjects);
})(globalThis,(G,O)=>{
  'use strict';
  const supports=sk=>['time-slash','time-double','time-union'].includes(sk?.kind);
  const point=p=>({x:p.x,y:p.y}),key=G.key;
  const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  function plans(board,origin,sk,state,uid){
    const out={aims:[],cells:[],byAim:{},reason:''},union=new Map();
    if(!supports(sk)||!G.open(board,origin))return out;
    const echoes=O.owned(state,uid,'echo');
    function add(aim,rays){
      const cells=[...new Map(rays.flatMap(r=>r.cells).map(p=>[key(p),p])).values()];
      const plan={aim:point(aim),origin:point(origin),cells,rays,echoes:echoes.map(e=>({id:e.id,position:point(e.position)}))};
      out.aims.push(point(aim));out.byAim[key(aim)]=plan;
      for(const p of cells)union.set(key(p),p);
    }
    if(sk.kind==='time-slash'){
      for(const d of G.DIRS){
        const cells=G.traceRay(board,origin,d,sk.range).cells;
        for(const aim of cells)add(aim,[{id:0,origin:point(origin),cells:cells.map(point),power:sk.power,echoId:null}]);
      }
    }else{
      if(echoes.length<(sk.minEchoes||1)){out.reason='需要至少一道時間殘影';return out;}
      const sources=[{position:origin,id:null},...(sk.kind==='time-double'?echoes.slice(-1):echoes)];
      const candidates=new Map();
      for(const s of sources)for(let y=s.position.y-sk.range;y<=s.position.y+sk.range;y++)
        for(let x=s.position.x-sk.range;x<=s.position.x+sk.range;x++){
          const p={x,y};if(G.open(board,p)&&dist(s.position,p)<=sk.range)candidates.set(key(p),p);
        }
      for(const aim of candidates.values()){
        const rays=[];
        for(const [id,s] of sources.entries()){
          if(dist(s.position,aim)>sk.range)continue;
          const line=G.segment(board,s.position,aim);if(!line.valid)continue;
          // Source occupancy is not an extra attack tile; zero-length
          // convergence can hit the selected tile, including an echo tile.
          rays.push({id,origin:point(s.position),cells:(line.cells.length===1?line.cells:line.cells.slice(1)).map(point),power:sk.power,echoId:s.id});
        }
        if(rays.length)add(aim,rays);
      }
    }
    out.cells=[...union.values()];if(!out.aims.length)out.reason='所有出劍起點皆無合法射線';
    return out;
  }
  function selected(board,origin,sk,state,uid,aim){
    const geometry=plans(board,origin,sk,state,uid);
    return {plan:geometry.byAim[key(aim)]||null,reason:geometry.reason||'目標超出射程或受到障礙阻擋'};
  }
  function update(state,plan,sk,{uid,board,clock,level,refinement}){
    if(sk.kind==='time-slash')return O.add(state,{type:'echo',ownerUid:uid,position:plan.origin,board,generatedAt:clock,level,refinement});
    if(sk.consumeEchoes)return O.clear(state,uid,'echo');
    return O.normalize(state);
  }
  function resolve(plan,enemies,covers,alive,apply,canContinue=()=>true){
    for(const ray of plan.rays)for(const enemy of enemies){
      if(!canContinue())return;
      if(!alive(enemy))continue;
      const cell=ray.cells.find(p=>covers(enemy,p));
      if(cell)apply(enemy,ray.power,cell,ray.id);
    }
  }
  function timeline(plan,sk,hits){
    const union=sk.kind==='time-union',slash=sk.kind==='time-slash';
    const durationMs=union?550:slash?280:350,start=union?180:slash?45:95,impact=union?300:slash?145:220;
    const segments=plan.rays.map(ray=>({kind:'ray',time:true,timeEcho:!!ray.echoId,timeConsume:union&&!!ray.echoId,timeBirth:slash,start,impact,end:durationMs,chargeMs:start,
      tone:ray.echoId?'gold':'violet',origin:point(ray.origin),cells:ray.cells.map(point),rays:[{cells:[point(ray.origin),...ray.cells.map(point)],tone:ray.echoId?'gold':'violet'}],
      hits:hits.filter(h=>h.rayId===ray.id).map(h=>({uid:h.uid??h.enemyId,damage:h.damage,absorbed:h.absorbed??h.shieldDamage??0,...(h.cell?{cell:point(h.cell)}:{})}))}));
    // A consumed but obstructed echo fades in place, without fabricating a ray.
    if(union)for(const echo of plan.echoes)if(!plan.rays.some(r=>r.echoId===echo.id))
      segments.push({kind:'echo',time:true,timeEcho:true,timeConsume:true,start,impact,end:durationMs,chargeMs:start,tone:'gold',origin:point(echo.position),hits:[],rays:[]});
    return {version:2,durationMs,segments};
  }
  return Object.freeze({supports,plans,selected,update,resolve,timeline});
});
