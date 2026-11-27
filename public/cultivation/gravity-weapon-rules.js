/* Shared authoritative gravity geometry and trigger settlement. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'),require('./weapon-special-objects.js'),require('./new-weapon-drafts.js'));
  else root.QAGravityRules=factory(root.QAWeaponGeometry,root.QAWeaponObjects,root.QANewWeaponDrafts);
})(globalThis,(G,O,D)=>{
  'use strict';
  const supports=sk=>['gravity-strike','gravity-core','gravity-crash'].includes(sk?.kind);
  const p=q=>({x:q.x,y:q.y}),key=G.key,dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const uid=a=>String(a.uid??a.id),position=a=>a.position||a;
  const living=a=>a.hp!==0&&a.battleHealth!==0&&!a.downed;
  const core=(state,owner)=>O.owned(state,owner,'core')[0]||null;
  const skillFor=o=>D.skillAtLevel('gravity-core',o.level,o.refinement);
  function area(board,center,radius){
    const cells=[];
    for(let y=center.y-radius;y<=center.y+radius;y++)for(let x=center.x-radius;x<=center.x+radius;x++){
      const q={x,y};if(dist(center,q)<=radius&&G.open(board,q))cells.push(q);
    }
    return cells;
  }
  function plans(board,origin,sk,state,owner,actors,canLand=()=>true){
    const out={aims:[],cells:[],byAim:{},reason:''},union=new Map(),existing=core(state,owner);
    const others=new Set(O.normalize(state).objects.filter(o=>o.type==='core'&&o.ownerUid!==owner).map(o=>key(o.position)));
    const occupied=q=>actors.some(a=>living(a)&&G.footprint(a).some(c=>key(c)===key(q)));
    const add=(aim,cells,extra={})=>{const plan={origin:p(origin),aim:p(aim),cells,...extra};out.aims.push(p(aim));out.byAim[key(aim)]=plan;for(const c of cells)union.set(key(c),c);};
    if(!supports(sk)||!G.open(board,origin))return out;
    if(sk.kind==='gravity-strike'){
      for(const d of G.CARDINAL){const cells=G.traceRay(board,origin,d,sk.range).cells;for(const aim of cells)add(aim,cells,{direction:p(d)});}
    }else if(sk.kind==='gravity-core'){
      for(const q of area(board,origin,sk.range))if(!occupied(q)&&!others.has(key(q))&&canLand(q))
        add(q,area(board,q,sk.radius),{core:p(q)});
      out.reason='請選擇兩格內未被占用的空地';
    }else{
      if(!existing){out.reason='場上沒有引力星核';return out;}
      const q=existing.position;
      if(dist(origin,q)>sk.range||!G.open(board,q)||others.has(key(q))||actors.some(a=>uid(a)!==owner&&living(a)&&G.footprint(a).some(c=>key(c)===key(q)))||!canLand(q)){
        out.reason='星核超出射程或落點不合法';return out;
      }
      add(q,area(board,q,sk.radius),{core:p(q),landing:p(q)});
    }
    out.cells=[...union.values()];return out;
  }
  function selected(board,origin,sk,state,owner,actors,aim,canLand){
    const g=plans(board,origin,sk,state,owner,actors,canLand);
    return {plan:g.byAim[key(aim)]||null,reason:g.reason||'請選擇合法出拳方向或星核'};
  }
  function place(state,plan,{uid,board,clock,level,refinement}){
    return O.add(state,{type:'core',ownerUid:uid,position:plan.core,board,generatedAt:clock,level,refinement});
  }
  function trigger(state,owner,step,{board,actors,targets,alive,move,apply,canMove=()=>true,forbidden=[]}){
    const result=O.triggerCore(state,owner,step);
    if(!result.triggered)return {...result,beat:null};
    const object=result.object,sk=skillFor(object),center=object.position;
    const blocked=new Set([...forbidden.map(key),...O.normalize(state).objects.filter(o=>o.type==='core').map(o=>key(o.position))]);
    const candidates=targets.filter(alive);
    const moves=G.pullClockwise(board,center,candidates,actors,sk.radius,{forbidden:blocked,canMove});
    // Compute every destination from the same snapshot before committing.
    for(const m of moves)if(m.moved){const e=candidates.find(e=>uid(e)===m.uid);move(e,m.to,m.from);}
    const hits=[];
    for(const m of moves){const e=candidates.find(e=>uid(e)===m.uid);if(!alive(e))continue;
      const cell=G.footprint(e).sort((a,b)=>dist(center,a)-dist(center,b))[0];
      const hit=apply(e,sk.power,cell);if(hit)hits.push({uid:m.uid,cell,...hit});
    }
    return {...result,beat:{core:p(center),cells:area(board,center,sk.radius),moves,hits,remaining:object.remainingTriggers}};
  }
  function attack(plan,sk,enemies,alive,apply,canContinue=()=>true){
    for(const e of enemies){if(!canContinue())break;if(!alive(e))continue;
      const cells=G.footprint(e).filter(c=>plan.cells.some(q=>key(q)===key(c)));
      if(!cells.length)continue;
      const cell=plan.core?cells.sort((a,b)=>dist(plan.core,a)-dist(plan.core,b))[0]:cells[0];
      const d=plan.core?dist(plan.core,cell):0,power=sk.kind==='gravity-crash'?(d<=1?sk.powers.near:d===2?sk.powers.middle:sk.powers.outer):sk.power;
      apply(e,power,cell);
    }
  }
  return Object.freeze({supports,core,skillFor,area,plans,selected,place,trigger,attack,clear:O.clear,endOwnerWindow:O.endOwnerWindow});
});
