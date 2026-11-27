/* Pure versioned, battle-local special-object state.
 * No rewards, commands or actor mutations here. Call only from authorized
 * skill resolution in later phases. Firestore-compatible plain JSON maps. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./weapon-geometry.js'),require('./manual-rules.js'),require('./new-weapon-drafts.js'));
  else root.QAWeaponObjects=factory(root.QAWeaponGeometry,root.QAManuals,root.QANewWeaponDrafts);
})(globalThis,(G,Manuals,Drafts)=>{
  'use strict';
  const definitions=Object.freeze({
    mark:Object.freeze({weaponId:'sword-weave',skillId:'weave-mark',limit:3,positionMode:'fixed'}),
    mirror:Object.freeze({weaponId:'body-mirror',skillId:'mirror-summon',limit:1,positionMode:'point-symmetric'}),
    echo:Object.freeze({weaponId:'sword-time',skillId:'time-slash',limit:2,positionMode:'fixed'}),
    core:Object.freeze({weaponId:'body-gravity',skillId:'gravity-core',limit:1,positionMode:'fixed'})
  });
  const integer=n=>Number.isSafeInteger(n)&&n>=0;
  const validPoint=p=>integer(p?.x)&&integer(p?.y);
  const validOwner=v=>typeof v==='string'&&v.length>0&&v.length<=256;
  const point=p=>({x:p.x,y:p.y});
  const empty=()=>({version:1,nextSequence:1,objects:[]});
  const identity=(owner,sequence)=>'weapon-object:'+sequence+':'+owner;
  function normalize(raw){
    if(raw?.version!==1||!Array.isArray(raw.objects))return empty();
    let max=0;const seen=new Set(),groups=new Map();
    for(const o of raw.objects.slice(0,4096)){
      if(!o||!Object.hasOwn(definitions,o.type)||!validOwner(o.ownerUid)||!integer(o.sequence)||o.sequence<1||o.sequence>=Number.MAX_SAFE_INTEGER)continue;
      const d=definitions[o.type],id=identity(o.ownerUid,o.sequence);
      if(seen.has(id)||o.id!==id||o.weaponId!==d.weaponId||o.skillId!==d.skillId||o.active!==true||!integer(o.generatedAt))continue;
      if(d.positionMode==='fixed'&&!validPoint(o.position))continue;
      const row={id,type:o.type,ownerUid:o.ownerUid,weaponId:d.weaponId,skillId:d.skillId,positionMode:d.positionMode,sequence:o.sequence,
        generatedAt:o.generatedAt,level:Manuals.skillLevel(o.level),refinement:Manuals.refinement(o.refinement),active:true,
        remainingTriggers:o.type==='core'?Math.min(Drafts.BY_SKILL['gravity-core'].maxTriggers,integer(o.remainingTriggers)?o.remainingTriggers:0):0,
        lastTrigger:integer(o.lastTrigger)?o.lastTrigger:null,exhaustedAt:integer(o.exhaustedAt)?o.exhaustedAt:null};
      if(d.positionMode==='fixed')row.position=point(o.position);
      if(row.type==='core'&&row.remainingTriggers===0&&row.exhaustedAt===null)continue;
      seen.add(id);max=Math.max(max,o.sequence);
      const group=JSON.stringify([o.ownerUid,o.type]);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(row);
    }
    const objects=[];
    for(const group of groups.values()){
      group.sort((a,b)=>a.sequence-b.sequence);
      // Keep oldest identity for duplicate marks, then apply FIFO capacity.
      const rows=group[0].type==='mark'?group.filter((o,i)=>group.findIndex(q=>G.key(q.position)===G.key(o.position))===i):group;
      objects.push(...rows.slice(-definitions[group[0].type].limit));
    }
    objects.sort((a,b)=>a.sequence-b.sequence||(a.id<b.id?-1:a.id>b.id?1:0));
    return {version:1,nextSequence:Math.max(max+1,integer(raw.nextSequence)&&raw.nextSequence>=1?raw.nextSequence:1),objects};
  }
  function owned(state,ownerUid,type){return normalize(state).objects.filter(o=>o.ownerUid===ownerUid&&(!type||o.type===type));}
  function add(state,{type,ownerUid,position,generatedAt,level=1,refinement=0,board,occupied=()=>false}={}){
    const s=normalize(state);
    if(!Object.hasOwn(definitions,type)||!validOwner(ownerUid)||!integer(generatedAt)||s.nextSequence>=Number.MAX_SAFE_INTEGER)throw new RangeError('invalid special object');
    const d=definitions[type],fixed=d.positionMode==='fixed';
    if(fixed&&(!board||!validPoint(position)||!G.open(board,position)))throw new RangeError('invalid special object position');
    if(type==='core'&&occupied(position))throw new RangeError('core requires empty tile');
    const old=s.objects.filter(o=>o.ownerUid===ownerUid&&o.type===type);
    if(type==='mark'&&old.some(o=>G.key(o.position)===G.key(position)))return s;
    const sequence=s.nextSequence,object={id:identity(ownerUid,sequence),type,ownerUid,weaponId:d.weaponId,skillId:d.skillId,positionMode:d.positionMode,
      sequence,generatedAt,level:Manuals.skillLevel(level),refinement:Manuals.refinement(refinement),active:true,
      remainingTriggers:type==='core'?Drafts.BY_SKILL['gravity-core'].maxTriggers:0,lastTrigger:null,exhaustedAt:null,
      ...(fixed?{position:point(position)}:{})};
    const remove=new Set(old.slice(0,Math.max(0,old.length-d.limit+1)).map(o=>o.id));
    return {version:1,nextSequence:sequence+1,objects:[...s.objects.filter(o=>!remove.has(o.id)),object]};
  }
  function location(object,board,ownerPosition){
    if(!object?.active)return null;
    if(object.positionMode==='point-symmetric')return board&&G.inside(board,ownerPosition)?G.mirror(board,ownerPosition):null;
    return validPoint(object.position)?point(object.position):null;
  }
  function clear(state,ownerUid,type){
    const s=normalize(state);return {...s,objects:s.objects.filter(o=>o.ownerUid!==ownerUid||type&&o.type!==type)};
  }
  function reconcileEquipment(state,ownerUid,weaponIds){
    const s=normalize(state),allowed=new Set(Array.isArray(weaponIds)?weaponIds:[]);
    return {...s,objects:s.objects.filter(o=>o.ownerUid!==ownerUid||allowed.has(o.weaponId))};
  }
  // 'step' is an authoritative monotonically increasing logical event ordinal,
  // not a client timestamp. Repeated or stale steps must never trigger twice.
  // Callers must map a whole enemy round to ONE step in later phases.
  function triggerCore(state,ownerUid,step){
    const s=normalize(state),core=s.objects.find(o=>o.ownerUid===ownerUid&&o.type==='core');
    if(!integer(step)||!core||step<core.generatedAt||core.remainingTriggers===0||core.lastTrigger!==null&&step<=core.lastTrigger)return {state:s,triggered:false,object:null};
    const remainingTriggers=core.remainingTriggers-1;
    const object={...core,remainingTriggers,lastTrigger:step,exhaustedAt:remainingTriggers===0?step:null};
    return {state:{...s,objects:s.objects.map(o=>o.id===core.id?object:o)},triggered:true,object};
  }
  // Exhaustion preserves the fifth trigger's core until the owner's turn end.
  function endOwnerWindow(state,ownerUid,step){
    const s=normalize(state);if(!integer(step))return s;
    return {...s,objects:s.objects.filter(o=>o.ownerUid!==ownerUid||o.type!=='core'||o.exhaustedAt===null||step<o.exhaustedAt)};
  }
  function finish(state){return {...normalize(state),objects:[]};}
  return Object.freeze({definitions,empty,normalize,owned,add,location,clear,reconcileEquipment,triggerCore,endOwnerWindow,finish});
});
