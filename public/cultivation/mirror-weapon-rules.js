/* Private mirror base techniques. The avatar is a derived position,
 * never a second actor, energy pool, life bar or independent pathfinder. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'),require('./weapon-special-objects.js'));
  else root.QAMirrorRules=factory(root.QAWeaponGeometry,root.QAWeaponObjects);
})(globalThis,(G,O)=>{
  'use strict';
  const supports=sk=>['mirror-strike','mirror-summon','mirror-swap'].includes(sk?.kind);
  const p=q=>({x:q.x,y:q.y}),same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
  const active=(state,uid)=>O.owned(state,uid,'mirror')[0]||null;
  function location(board,origin,state,uid){
    const avatar=active(state,uid);
    return avatar?O.location(avatar,board,origin):null;
  }
  function plans(board,origin,sk,state,uid,canSwap=()=>true){
    const out={aims:[],cells:[],byAim:{},reason:''},union=new Map();
    if(!supports(sk)||!G.open(board,origin))return out;
    const shadow=location(board,origin,state,uid),reflected=G.mirror(board,origin);
    const part=(source,cells,power,avatar)=>({source:p(source),cells:cells.map(p),power,avatar});
    const area=q=>G.open(board,q)?G.squareArea(board,q,sk.radius,{includeCenter:true}).filter(c=>G.segment(board,q,c).valid):[];
    function add(aim,parts,extra={}){
      const cells=[...new Map(parts.flatMap(q=>q.cells).map(q=>[G.key(q),q])).values()];
      const plan={aim:p(aim),origin:p(origin),shadow:shadow?p(shadow):null,parts,cells,...extra};
      out.aims.push(p(aim));out.byAim[G.key(aim)]=plan;
      for(const q of cells)union.set(G.key(q),q);
    }
    if(sk.kind==='mirror-strike'){
      for(const d of G.CARDINAL){
        const cells=G.traceRay(board,origin,d,sk.range).cells;
        if(!cells.length)continue;
        const parts=[part(origin,cells,sk.power,false)];
        if(shadow&&G.open(board,shadow)){
          const mirrorCells=G.traceRay(board,shadow,{x:-d.x||0,y:-d.y||0},sk.range).cells;
          if(mirrorCells.length)parts.push(part(shadow,mirrorCells,sk.power*.3,true));
        }
        for(const aim of cells)add(aim,parts);
      }
      if(!out.aims.length)out.reason='沒有合法出拳方向';
    }else if(sk.kind==='mirror-summon'){
      const cells=area(reflected);
      add(origin,cells.length?[part(reflected,cells,sk.power,true)]:[],{summon:true,shadow:p(reflected),suppressed:!cells.length});
    }else if(!shadow)out.reason='尚未召喚蜃影';
    else if(!G.open(board,shadow)||!canSwap(shadow))out.reason='蜃影位置被障礙或其他角色占用，不能換位';
    else add(origin,[part(shadow,area(shadow),sk.power,false),part(origin,area(origin),sk.power,true)],{landing:p(shadow)});
    out.cells=[...union.values()];return out;
  }
  function selected(board,origin,sk,state,uid,aim,canSwap){
    const all=plans(board,origin,sk,state,uid,canSwap);
    const plan=G.open(board,aim)?all.byAim[G.key(aim)]:null;
    return {plan:plan||null,reason:plan?'':all.reason||'請選擇合法出拳方向或自身格'};
  }
  function activate(state,plan,{uid,board,clock,level,refinement}){
    if(!plan.summon||active(state,uid))return O.normalize(state);
    return O.add(state,{type:'mirror',ownerUid:uid,board,generatedAt:clock,level,refinement});
  }
  // Per-origin hits deduplicate footprints. Overlap between the two distinct
  // attack parts is intentional and never re-enters skill resolution.
  function resolve(plan,targets,covers,alive,apply,canContinue=()=>true){
    const hits=[];
    for(const [index,part] of plan.parts.entries()){
      const seen=new Set();
      for(const target of targets){
        if(!canContinue())return hits;
        const uid=target.uid??target.id;
        if(seen.has(uid)||!alive(target))continue;
        const cell=part.cells.find(q=>covers(target,q));
        if(!cell)continue;
        seen.add(uid);
        const hit=apply(target,part.power,p(cell),index,part);
        if(hit)hits.push({...hit,uid,part:index,avatar:part.avatar,cell:p(cell)});
      }
    }
    return hits;
  }
  // Battle-local identity, dynamically derived coordinates, no stored actor.
  function reconcile(state,uid,weaponIds){return O.reconcileEquipment(state,uid,weaponIds);}
  return Object.freeze({supports,active,location,plans,selected,activate,resolve,clear:O.clear,reconcileEquipment:reconcile,finish:O.finish});
});
