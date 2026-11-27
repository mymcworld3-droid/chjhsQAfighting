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
    const marks=O.owned(state,uid,'mark').map(o=>o.position).filter(q=>G.open(board,q));
    // Only weave formations ignore intervening terrain. Endpoints and damage
    // tiles must still be legal on the real board; other weapons are unchanged.
    const through={width:board.width,height:board.height,blocked:()=>false};
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
        const line=G.segment(through,first,second);
        if(line.valid)add({aim:p(second),first:p(first),cells:line.cells.filter(q=>G.open(board,q)),vertices:[p(first),p(second)],power:sk.power},first);
      }
      if(!out.pairs.length)out.reason=marks.length?'需要兩個不同的有效端點':'尚未留下劍痕';
    }else{
      const distinct=[...new Map(marks.map(q=>[G.key(q),q])).values()];
      if(distinct.length<2)out.reason='織界至少需要兩道劍痕';
      else{
        const area=G.polygon(through,distinct);
        if(!area.valid)out.reason='無法形成有效劍陣';
        else add({aim:p(origin),cells:area.cells.filter(q=>G.open(board,q)),vertices:area.vertices,power:distinct.length===2?sk.powers.two:area.vertices.length===2?sk.powers.collinear:sk.powers.polygon});
      }
    }
    out.aims=[...aims.values()];out.cells=[...union.values()];return out;
  }
  function selected(board,origin,sk,state,uid,aim,first){
    const all=plans(board,origin,sk,state,uid);
    if(!G.open(board,aim)||sk.kind==='weave-thread'&&!G.open(board,first))return {plan:null,reason:all.reason||'請選擇合法端點'};
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
  // Shared touch/keyboard interaction: first tap picks, second casts.
  // Tap the first endpoint again to cancel without casting.
  function choose(plan,selection,tile){
    const pairs=plan?.pairs||[];
    const first=selection?.first;
    if(first&&same(first,tile))return {selection:null,confirm:false,reason:'已取消端點，請重新選擇'};
    if(!first){
      if(!pairs.some(q=>same(q.first,tile)))return {selection:null,confirm:false,reason:plan?.reason||'請選擇可連接的第一端點'};
      return {selection:{...p(tile),first:p(tile),choosing:true},confirm:false,reason:'選擇第二端點立即施放；再點第一端點取消'};
    }
    const scheme=plan?.byPair?.[pairKey(first,tile)];
    if(!scheme)return {selection,confirm:false,reason:'請選擇另一個有效端點'};
    const confirm=Boolean(scheme.valid);
    return {selection:{...p(tile),first:p(first),choosing:false},confirm,reason:confirm?'施放牽絲':scheme.reason||'體力不足或目前不可施放'};
  }
  function selectionPlan(plan,selection){
    if(!plan?.pairs?.length||!selection?.first)return plan;
    const first=selection.first,pairs=plan.pairs.filter(q=>same(q.first,first));
    return {...plan,aims:pairs.map(q=>q.second),first:p(first),byAim:Object.fromEntries(pairs.map(q=>[G.key(q.second),plan.byPair[pairKey(first,q.second)]]))};
  }
  function timeline(plan,sk,hits){
    const durationMs=sk.kind==='weave-mark'?300:sk.kind==='weave-thread'?360:500;
    const impact=sk.kind==='weave-mark'?140:sk.kind==='weave-thread'?220:320;
    return {version:2,durationMs,segments:[{kind:sk.kind==='weave-mark'?'ray':'domain',weave:sk.kind,tone:'jade',start:0,impact,end:durationMs,
      origin:plan.vertices[0],target:plan.mark||plan.vertices.at(-1),vertices:plan.vertices,cells:plan.cells,
      ...(plan.mark?{mark:plan.mark,rays:[{cells:[plan.vertices[0],...plan.cells],tone:'jade'}]}:{}),
      hits:hits.map(h=>({uid:h.uid,damage:h.damage,absorbed:h.absorbed||0,cell:h.cell})),moves:[]}]};
  }
  return Object.freeze({supports,plans,selected,place,resolve,pairKey,choose,selectionPlan,timeline,clear:O.clear,reconcileEquipment:O.reconcileEquipment,finish:O.finish});
});
