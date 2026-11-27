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
        for(const aim of cells)add(aim,parts,{suppressed:!!shadow&&!G.open(board,shadow)});
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
  // Each original attack beat generates exactly one independent mirror beat.
  // Do not mirror actual body hit cells: an obstacle on the body side must
  // not erroneously truncate a clear reflected attack on the opposite side.
  const copyKinds=new Set(['line','dash-cleave','fist-sweep','fist-throw','fist-chain','bell-strike','bell-shock','bell-echo','gravity-strike']);
  const canCopy=sk=>sk?.school==='body'&&!sk.noMirrorCopy&&copyKinds.has(sk.kind);
  const opposite=d=>d?{x:-d.x||0,y:-d.y||0}:null;
  function copyGeometry(board,origin,sk,beat){
    const source=G.mirror(board,origin),d=opposite(beat.direction);
    const part={source,cells:[],direction:d,layer:beat.layer||1,power:beat.power*.3,suppressed:!G.open(board,source)};
    if(part.suppressed)return part;
    if(['line','bell-strike','gravity-strike'].includes(sk.kind)){
      if(d)part.cells=G.traceRay(board,source,d,sk.range).cells;
    }else if(['dash-cleave','fist-sweep','fist-throw','fist-chain'].includes(sk.kind)){
      if(d){
        const tShape=sk.kind!=='fist-chain'&&sk.tShape,row=tShape?2:1;
        const cells=[-1,0,1].map(side=>({x:source.x+d.x*row-d.y*side,y:source.y+d.y*row+d.x*side}));
        if(tShape)cells.unshift({x:source.x+d.x,y:source.y+d.y});
        part.cells=cells.filter(q=>G.segment(board,source,q).valid);
      }
    }else{
      const cells=sk.kind==='bell-echo'?G.squareRing(board,source,beat.layer):G.squareArea(board,source,sk.radius);
      part.cells=cells.filter(q=>G.segment(board,source,q).valid);
    }
    return part;
  }
  // All mutations use callbacks to authoritative owner/target state. A copy
  // never invokes cast, spends resources, creates objects or changes owner
  // position. Fixed bosses preserve the existing displacement exceptions.
  function copyBeat(board,origin,sk,beat,{targets,alive,covers,apply,push,throwTo,outward,canContinue=()=>true}){
    const part=copyGeometry(board,origin,sk,beat),hits=[],moves=[],seen=new Set();
    const pos=e=>e.position||e,id=e=>String(e.uid??e.id);
    const candidates=targets().filter(alive).map(enemy=>({enemy,cell:part.cells.find(q=>covers(enemy,q))})).filter(h=>h.cell);
    if(sk.push||sk.kind==='fist-chain'||sk.kind.startsWith('bell-')&&sk.kind!=='bell-strike')
      candidates.sort((a,b)=>Math.abs(pos(b.enemy).x-part.source.x)+Math.abs(pos(b.enemy).y-part.source.y)-Math.abs(pos(a.enemy).x-part.source.x)-Math.abs(pos(a.enemy).y-part.source.y)||(id(a.enemy)<id(b.enemy)?-1:id(a.enemy)>id(b.enemy)?1:0));
    for(const {enemy,cell} of candidates){
      if(!canContinue())break;
      const uid=id(enemy);
      if(seen.has(uid)||!alive(enemy))continue;
      seen.add(uid);
      const before=p(pos(enemy));
      if(sk.kind==='fist-throw'&&!throwTo(enemy,part.direction))continue;
      const hit=apply(enemy,part.power,cell,part.layer);
      if(hit)hits.push({...hit,uid,cell:p(cell)});
      if(alive(enemy)){
        const bellPush=sk.kind==='bell-shock'||sk.kind==='bell-echo';
        const count=bellPush||sk.kind==='fist-chain'?1:sk.push||0;
        const d=bellPush?outward(part.source,enemy):part.direction;
        if(count&&d){
          push(enemy,d,count);
          if(sk.kind==='fist-chain'&&alive(enemy)&&same(before,pos(enemy))&&sk.collisionPower>0){
            const collision=apply(enemy,sk.collisionPower*.3,p(pos(enemy)),part.layer);
            if(collision)hits.push({...collision,uid,cell:p(pos(enemy)),collision:true});
          }
        }
      }
      if(!same(before,pos(enemy)))moves.push({uid,from:before,to:p(pos(enemy))});
    }
    return {...part,hits,moves};
  }
  // V2 presentation consumes committed, per-beat hits and movement only.
  // Two attack origins share the same impact; sequential displacements on
  // one target within that beat are stitched into a single legal route.
  function mergeMoves(moves){
    const byUid=new Map();
    for(const m of moves){
      if(!m.path||m.path.length<2)continue;
      const old=byUid.get(m.uid);
      if(!old)byUid.set(m.uid,{uid:m.uid,path:m.path.map(p),style:m.style||'slide'});
      else if(same(old.path.at(-1),m.path[0]))old.path.push(...m.path.slice(1).map(p));
      else old.path.push(...m.path.map(p));
    }
    return [...byUid.values()];
  }
  function baseBeats(plan,sk,uid,hits,moves=[]){
    const bodyPart=plan.parts.find(q=>!q.avatar),shadowPart=plan.parts.find(q=>q.avatar);
    const byAvatar=avatar=>hits.filter(h=>Boolean(plan.parts[h.part]?.avatar)===avatar);
    const body={source:bodyPart?.source||plan.origin,cells:bodyPart?.cells||[],hits:byAvatar(false),moves};
    const shadow=plan.shadow?{source:shadowPart?.source||plan.shadow,cells:shadowPart?.cells||[],hits:byAvatar(true),moves:[],suppressed:plan.suppressed===true}:null;
    return [{body,shadow}];
  }
  function timeline(sk,beats){
    const count=Math.max(1,beats.length),chain=sk.kind==='fist-chain',strike=sk.kind==='mirror-strike'||sk.kind==='line'||sk.kind==='gravity-strike';
    const durationMs=chain?600:sk.kind==='mirror-summon'?400:sk.kind==='mirror-swap'?420:count>1?460:['mirror-strike','gravity-strike'].includes(sk.kind)?280:350;
    const width=Math.floor(durationMs/count),segments=[];
    for(const [index,beat] of beats.entries()){
      const start=index*width,end=index===count-1?durationMs:(index+1)*width;
      const impact=start+Math.max(1,Math.round((end-start)*.50));
      const moveList=mergeMoves([...(beat.body?.moves||[]),...(beat.shadow?.moves||[])]);
      for(const [avatar,part] of [[false,beat.body],[true,beat.shadow]]){
        if(!part)continue;
        const radial=sk.kind==='mirror-summon'||sk.kind==='mirror-swap';
        const cells=part.cells||[];
        segments.push({kind:strike?'ray':radial?'shock':'domain',tone:avatar?'violet':'ice',mirror:true,mirrorAvatar:avatar,
          ...(sk.kind==='gravity-strike'?{gravity:'strike'}:{}),mirrorSummon:sk.kind==='mirror-summon',mirrorSuppressed:part.suppressed===true,
          start,impact,end,origin:p(part.source),target:p(cells.at(-1)||part.source),radius:radial?1:0,cells:cells.map(p),
          ...(strike&&cells.length?{rays:[{cells:[p(part.source),...cells.map(p)],tone:avatar?'violet':'ice'}]}:{}),
          hits:(part.hits||[]).map(h=>({uid:h.uid,damage:h.damage,absorbed:h.absorbed||0,cell:p(h.cell||part.source)})),
          moves:avatar?[]:moveList});
      }
    }
    return {version:2,durationMs,segments};
  }
  // Battle-local identity, dynamically derived coordinates, no stored actor.
  function reconcile(state,uid,weaponIds){return O.reconcileEquipment(state,uid,weaponIds);}
  return Object.freeze({supports,active,location,plans,selected,activate,resolve,canCopy,copyGeometry,copyBeat,baseBeats,timeline,mergeMoves,clear:O.clear,reconcileEquipment:reconcile,finish:O.finish});
});
