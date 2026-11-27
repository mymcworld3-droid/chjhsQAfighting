/* Shared private weave mechanics. Plans are based only on the current
 * owner's committed marks; endpoint coordinates are revalidated at cast. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'),require('./weapon-special-objects.js'));
  else root.QAWeaveRules=factory(root.QAWeaponGeometry,root.QAWeaponObjects);
})(globalThis,(G,O)=>{
  'use strict';
  const supports=sk=>['weave-mark','weave-thread','weave-domain'].includes(sk?.kind);
  const p=a=>({x:a.x,y:a.y}),same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
  const pairKey=(a,b)=>G.key(a)+'|'+G.key(b);
  function plans(board,origin,sk,state,uid){
    const out={aims:[],cells:[],byAim:{},byPair:{},pairs:[],reason:''},union=new Map(),aims=new Map();
    if(!supports(sk)||!G.open(board,origin))return out;
    const marks=O.owned(state,uid,'mark').map(o=>o.position);
    function add(plan,first=null){
      for(const cell of plan.cells)union.set(G.key(cell),cell);
      if(first){
        out.byPair[pairKey(first,plan.aim)]=plan;
        out.pairs.push({first:p(first),second:p(plan.aim)});
        aims.set(G.key(first),p(first));
      }else{
        out.byAim[G.key(plan.aim)]=plan;aims.set(G.key(plan.aim),p(plan.aim));
      }
    }
    if(sk.kind==='weave-mark'){
      for(const d of G.DIRS){
        const cells=G.traceRay(board,origin,d,sk.range).cells;
        for(const aim of cells)add({aim:p(aim),cells,vertices:[p(origin),p(cells.at(-1))],power:sk.power,mark:p(aim)});
      }
      if(!union.size)out.reason='沒有可放置劍痕的合法直線';
    }else if(sk.kind==='weave-thread'){
      const endpoints=[...new Map([origin,...marks].map(q=>[G.key(q),p(q)])).values()];
      for(const first of endpoints)for(const second of endpoints){
        if(same(first,second))continue;
        const line=G.segment(board,first,second);
        if(line.valid)add({aim:p(second),first:p(first),cells:line.cells,vertices:[p(first),p(second)],power:sk.power},first);
      }
      if(!out.pairs.length)out.reason=marks.length?'端點之間遭障礙阻斷，無合法連線':'尚未留下劍痕';
    }else{
      const distinct=[...new Map(marks.map(q=>[G.key(q),q])).values()];
      if(distinct.length<2)out.reason='織界至少需要兩道劍痕';
      else{
        const area=G.polygon(board,distinct);
        if(!area.valid)out.reason='障礙阻斷劍陣邊界，無法形成完整劍陣';
        else add({aim:p(origin),cells:area.cells,vertices:area.vertices,power:distinct.length===2?sk.powers.two:area.vertices.length===2?sk.powers.collinear:sk.powers.polygon});
      }
    }
    out.aims=[...aims.values()];out.cells=[...union.values()];return out;
  }
  function selected(board,origin,sk,state,uid,aim,first){
    const all=plans(board,origin,sk,state,uid);
    const plan=sk.kind==='weave-thread'?first&&aim&&all.byPair[pairKey(first,aim)]:aim&&all.byAim[G.key(aim)];
    return {plan:plan||null,reason:plan?'':all.reason||'請選擇兩個不同且可連通的合法端點'};
  }
  function place(state,plan,{uid,board,clock,level,refinement}){
    return plan.mark?O.add(state,{type:'mark',ownerUid:uid,position:plan.mark,board,generatedAt:clock,level,refinement}):O.normalize(state);
  }
  function resolve(plan,targets,covers,alive,apply,canContinue=()=>true){
    const seen=new Set();
    for(const target of targets){
      if(!canContinue())break;
      const id=target.uid??target.id;
      if(seen.has(id)||!alive(target))continue;
      const cell=plan.cells.find(q=>covers(target,q));
      if(cell){seen.add(id);apply(target,plan.power,p(cell));}
    }
  }
  return Object.freeze({supports,plans,selected,place,resolve,pairKey,clear:O.clear,reconcileEquipment:O.reconcileEquipment,finish:O.finish});
});
