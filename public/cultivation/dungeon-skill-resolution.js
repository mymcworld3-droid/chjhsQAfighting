/* Shared deterministic dungeon skill resolution. Authorization, sequence
 * validation and trusted account data remain in the server wrapper.
 * A preview works on local snapshots and is never a server command. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(
    require('./flying-sword-path.js'),require('./dungeon-boss-hit.js'),require('./manual-rules.js'));
  else root.QADungeonSkillResolution=factory(root.QAFlyingSwordPath,root.QADungeonBossHit,root.QAManuals);
})(globalThis,(SwordPath,Boss,Manuals)=>{
  'use strict';
  const gravity=()=>typeof module==='object'&&module.exports?require('./gravity-weapon-rules.js'):globalThis.QAGravityRules;
  const time=()=>typeof module==='object'&&module.exports?require('./time-weapon-rules.js'):globalThis.QATimeRules;
  const mirror=()=>typeof module==='object'&&module.exports?require('./mirror-weapon-rules.js'):globalThis.QAMirrorRules;
  const weave=()=>typeof module==='object'&&module.exports?require('./weave-weapon-rules.js'):globalThis.QAWeaveRules;
  const bell=()=>typeof module==='object'&&module.exports?require('./bell-weapon-rules.js'):globalThis.QABellRules;
  const prism=()=>typeof module==='object'&&module.exports?require('./prism-weapon-rules.js'):globalThis.QAPrismRules;
  // Match the room's authoritative dungeon health and stamina contracts.
  const HEALTH=Object.freeze({wolf:500,wisp:440,golem:650,guardian:1200,boss:Boss.HP});
  const maxHealth=kind=>HEALTH[kind]||HEALTH.wolf;
  const recordedMax=enemy=>Number.isSafeInteger(enemy?.battleMaxHealth)&&enemy.battleMaxHealth>0?enemy.battleMaxHealth:maxHealth(enemy?.kind);
  const staminaFor=m=>m?.dungeonAdmin===true?10:Number.isSafeInteger(Number(m?.explorationStamina))?Math.max(0,Math.min(10,Number(m.explorationStamina))):0;
  const staminaAfterCost=(m,c)=>m?.dungeonAdmin===true?10:staminaFor(m)-c;
  const walkable=(map,p)=>!!map&&!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<map.width&&p.y<map.height&&Number(map.tiles[p.y*map.width+p.x])!==0;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const key=p=>p.x+','+p.y;
const axis=(a,b)=>{
  const dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y);
  return (dx===0)!==(dy===0)?{x:dx,y:dy}:null;
};
const at=(p,dx,dy,n=1)=>({x:p.x+dx*n,y:p.y+dy*n});
const present=(members,point)=>Object.values(members).some(m=>same(m.position,point));
// A beast killed earlier in the SAME multi-hit cast is no longer an obstacle.
// Otherwise the first lethal punch leaves a phantom corpse blocking every
// subsequent step of 四步連推, despite being removed when the cast finishes.
const occupied=(p,enemies,ignore='')=>
  enemies.some(e=>e.id!==ignore&&
    (!Number.isSafeInteger(e.battleHealth)||e.battleHealth>0)&&
    Boss.occupies(e,p));
const tile=(map,p)=>walkable(map,p);
function visible(map,a,b){
  if(!tile(map,a)||!tile(map,b))return false;
  let x=a.x,y=a.y;
  const dx=Math.abs(b.x-x),dy=Math.abs(b.y-y);
  const sx=x<b.x?1:-1,sy=y<b.y?1:-1;
  let error=dx-dy;
  while(x!==b.x||y!==b.y){
    const oldX=x,oldY=y,twice=error*2;
    if(twice>-dy){error-=dy;x+=sx;}
    if(twice<dx){error+=dx;y+=sy;}
    if(!tile(map,{x,y}))return false;
    // A diagonal sight ray must not pass through a closed wall corner.
    if(x!==oldX&&y!==oldY&&
        !tile(map,{x:oldX,y})&&!tile(map,{x,y:oldY}))return false;
  }
  return true;
}
// Focus is a six-cast body-technique enhancement, not a cooldown or a
// general-purpose bonus to sword techniques. Keep the eligibility and the
// actual cost together so the client can render the same trusted outcome.
const isFocusEmpowered=(member,skill)=>Number.isSafeInteger(member?.focusCharges)&&
  member.focusCharges>0&&skill?.school==='body'&&skill.kind!=='fist-focus';
const focusCost=(member,skill)=>isFocusEmpowered(member,skill)?
  Math.ceil(skill.cost/2):skill.cost;

// Pure directed ray. Neither a client point nor an NPC can pass a wall.
function ray(map,from,to,range){
  const d=axis(from,to);
  if(!d)return [];
  const out=[];
  for(let i=1;i<=Math.min(range,map.width+map.height);i++){
    const p=at(from,d.x,d.y,i);
    if(!tile(map,p))break;
    out.push(p);
  }
  return out;
}
function rayTo(map,from,to,range){
  const result=ray(map,from,to,range);
  const atIndex=result.findIndex(p=>same(p,to));
  return atIndex<0?null:result.slice(0,atIndex+1);
}
const forward=(origin,d,step,side=0)=>
  ({x:origin.x+d.x*step-d.y*side,y:origin.y+d.y*step+d.x*side});
const front=(map,origin,d,tShape=false)=>{
  const cells=tShape?[forward(origin,d,1)]:[];
  const n=tShape?2:1;
  for(const side of [-1,0,1]){
    const p=forward(origin,d,n,side);
    if(tile(map,p))cells.push(p);
  }
  return cells.filter(p=>tile(map,p)&&visible(map,origin,p));
};
function beamArray(map,center,sk){
  const rays=[];
  for(const [dirs,count] of [
    [[[1,0],[-1,0],[0,1],[0,-1]],sk.orthogonal||0],
    [[[1,1],[1,-1],[-1,1],[-1,-1]],sk.diagonal||0]
  ]){
    if(!count)continue;
    for(const [dx,dy] of dirs){
      const cells=[];
      for(let n=1;n<=count;n++){
        const p=at(center,dx,dy,n);
        if(!tile(map,p)||dx&&dy&&(!tile(map,at(p,-dx,0))||
            !tile(map,at(p,0,-dy))))break;
        cells.push(p);
      }
      if(cells.length)rays.push({cells,dx,dy});
    }
  }
  return rays;
}

function resolveCast(room,uid,map,sk,{target,seq,moveSword=false,base,preview=false,first=null,refinement=0}){
  const member=room.members[uid],skillId=sk.id;
  const empowered=isFocusEmpowered(member,sk);
  const origin=member.position;
  if(!tile(map,target))throw fail('目標不能位於牆壁或界外',409);
  const swordPath=sk.kind==='flying-sword'&&member.flyingSword?
    SwordPath.route({from:member.flyingSword,to:target,
      walkable:p=>tile(map,p),enemies:room.enemies||[]}):null;
  const swordSteps=swordPath?swordPath.length-1:0;
  if(moveSword&&(!swordSteps||swordSteps%2))
    throw fail('飛劍必須沿最短路徑移動正偶數格',409);
  const cost=moveSword?swordSteps/2:focusCost(member,sk);
  const stamina=staminaFor(member);
  if(!preview&&stamina<cost)throw fail('探索體力不足，無法施放技能',409);
  const enemies=(room.enemies||[]).map(e=>({...e,position:{...e.position}}));
  const startingPositions=new Map(enemies.map(e=>[e.id,{...e.position}]));
  const members={...room.members};
  let player={...member},hits=[],cells=[],position=null,chainSteps=[],
    sword=member.flyingSword||null,flightPath=null;
  // Re-derive attack from the latest verified A-side manual snapshot: A can
  // gain manuscript EXP in another session while this C dungeon stays open.
  player.dungeonAttack=base;
  const damageFor=power=>Math.max(1,Math.round(base*power));
  const healthy=e=>Number.isSafeInteger(e.battleHealth)?
    Math.max(0,e.battleHealth):maxHealth(e.kind);
  const tick=Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0;
  // Multi-hit sword arrays are ONE contribution, not eight fake teammates.
  // Remember whether this cast linked to a different player's recent strike.
  const linkedBossHits=new Map();
  const apply=(enemy,power)=>{
    if(!enemy||healthy(enemy)<=0)return;
    const health=healthy(enemy);
    let teamwork=null,damage;
    if(enemy.kind==='boss'){
      if(!linkedBossHits.has(enemy.id))
        linkedBossHits.set(enemy.id,Boss.comboReady(enemy,uid,tick));
      teamwork=Boss.damage(enemy,uid,damageFor(power),tick,linkedBossHits.get(enemy.id));
      damage=teamwork.damage;
    }else{
      damage=Math.min(health,damageFor(power));
      enemy.battleHealth=health-damage;
      enemy.battleMaxHealth=recordedMax(enemy);
    }
    hits.push({enemyId:enemy.id,damage,remainingHealth:enemy.battleHealth,
      defeated:enemy.battleHealth===0,
      ...(teamwork?{shieldDamage:teamwork.shieldDamage,combo:teamwork.combo,
        shieldBroken:teamwork.shieldBroken}:{})});
  };
  const targets=(locations)=>enemies.filter(e=>healthy(e)>0&&
    locations.some(p=>Boss.occupies(e,p)));
  const advance=(object,d,steps,maxDistance=steps)=>{
    if(object.kind==='boss')return 0; // fixed 2x2 boss cannot be knocked aside
    let total=0;
    for(let n=0;n<steps&&total<maxDistance;n++){
      const p=forward(object.position,d,1);
      if(!tile(map,p)||occupied(p,enemies,object.id)||present(members,p))break;
      object.position={...p};total++;
    }
    return total;
  };
  const mirrorSteps=[],mirrorBeats=[];
  let bodyHitStart=0,bodyPositions=new Map(startingPositions);
  const asHit=h=>({uid:h.enemyId,damage:h.damage,absorbed:h.shieldDamage||0,cell:h.cell||enemies.find(e=>e.id===h.enemyId)?.position||origin,part:h.part||0});
  const movesSince=starts=>enemies.filter(e=>starts.has(e.id)&&!same(starts.get(e.id),e.position)).map(e=>({uid:e.id,path:[starts.get(e.id),{...e.position}],style:sk.kind==='fist-throw'?'arc':'slide'}));
  const copy=mirror()?.canCopy(sk)&&mirror().active(room.weaponObjects,uid)?(from,beat)=>{
    const body={source:{...from},cells:(beat.cells||cells).map(q=>({...q})),hits:hits.slice(bodyHitStart).map(asHit),moves:movesSince(bodyPositions)};
    const prior=members[uid];members[uid]={...player,position:{...from}};
    const result=mirror().copyBeat(prism().boardForDungeon(map),from,sk,beat,{
      targets:()=>enemies,alive:e=>healthy(e)>0,covers:Boss.occupies,
      apply:(enemy,power,cell,layer)=>{
        apply(enemy,power);const hit=hits.at(-1);Object.assign(hit,{avatar:true,layer,cell});
        return {damage:hit.damage,absorbed:hit.shieldDamage||0};
      },
      push:(enemy,d,count)=>{if(advance(enemy,d,count))enemy.attack=null;},
      throwTo:(enemy,d)=>{
        if(enemy.kind==='boss')return true;
        const landing=forward(enemy.position,d,-2);
        if(!tile(map,landing)||occupied(landing,enemies,enemy.id)||present(members,landing))return false;
        enemy.position={...landing};enemy.attack=null;return true;
      },outward:bell().outward
    });
    members[uid]=prior;mirrorSteps.push(result);
    mirrorBeats.push({body,shadow:{...result,moves:result.moves.map(m=>({uid:m.uid,path:[m.from,m.to],style:sk.kind==='fist-throw'?'arc':'slide'}))}});
    bodyHitStart=hits.length;bodyPositions=new Map(enemies.map(e=>[e.id,{...e.position}]));return result;
  }:null;
  const mirrorCanSwap=q=>tile(map,q)&&!occupied(q,enemies)&&!Object.entries(members).some(([id,m])=>id!==uid&&same(m.position,q));
  const gravityActors=[...enemies,...Object.entries(members).map(([id,m])=>({...m,uid:id}))];
  const gravitySelection=gravity()?.supports(sk)?gravity().selected(prism().boardForDungeon(map),origin,sk,room.weaponObjects,uid,gravityActors,target):null;
  const gravityPlan=gravitySelection?.plan;
  let gravityBeat=null;
  const timeSelection=time()?.supports(sk)?time().selected(prism().boardForDungeon(map),origin,sk,room.weaponObjects,uid,target):null;
  const timePlan=timeSelection?.plan;
  const mirrorSelection=mirror()?.supports(sk)?mirror().selected(prism().boardForDungeon(map),origin,sk,room.weaponObjects,uid,target,mirrorCanSwap):null;
  const mirrorPlan=mirrorSelection?.plan;
  const selection=weave()?.supports(sk)?weave().selected(prism().boardForDungeon(map),origin,sk,room.weaponObjects,uid,target,first):null;
  const weavePlan=selection?.plan;
  let weaponObjects=null;
  const bellPlan=bell()?.supports(sk)?bell().selected(prism().boardForDungeon(map),origin,sk,target):null;
  let bellSteps=null;
  const prismPlan=prism()?.supports(sk)?prism().selected(prism().boardForDungeon(map),origin,sk,target):null;
  if(gravitySelection){
    if(!gravityPlan)throw fail(gravitySelection.reason,409);
    cells=gravityPlan.cells;
    if(sk.kind==='gravity-core'){
      weaponObjects=gravity().place(room.weaponObjects,gravityPlan,{uid,board:prism().boardForDungeon(map),clock:tick,level:sk.level,refinement});
      const out=gravity().trigger(weaponObjects,uid,tick,{board:prism().boardForDungeon(map),actors:gravityActors,targets:enemies,alive:e=>healthy(e)>0,
        canMove:e=>e.kind!=='boss',move:(e,to)=>{e.position={...to};e.attack=null;},
        apply:(e,power,cell)=>{apply(e,power);const hit=hits.at(-1);hit.cell=cell;return {damage:hit.damage,absorbed:hit.shieldDamage||0};}
      });
      weaponObjects=out.state;gravityBeat=out.beat;
    }else{
      if(gravityPlan.landing){position={...gravityPlan.landing};player.position=position;weaponObjects=gravity().clear(room.weaponObjects,uid,'core');}
      gravity().attack(gravityPlan,sk,enemies,e=>healthy(e)>0,(enemy,power,cell)=>{apply(enemy,power);hits.at(-1).cell=cell;});
      if(copy&&sk.kind==='gravity-strike')copy(origin,{direction:gravityPlan.direction,power:sk.power,layer:1});
    }
  }else if(timeSelection){
    if(!timePlan)throw fail(timeSelection.reason,409);
    cells=timePlan.cells;
    weaponObjects=time().update(room.weaponObjects,timePlan,sk,{uid,board:prism().boardForDungeon(map),clock:tick,level:sk.level,refinement});
    time().resolve(timePlan,enemies,Boss.occupies,e=>healthy(e)>0,(enemy,power,cell,index)=>{apply(enemy,power);Object.assign(hits.at(-1),{cell,rayId:index});});
  }else if(mirrorSelection){
    if(!mirrorPlan)throw fail(mirrorSelection.reason,409);
    cells=mirrorPlan.cells;
    if(mirrorPlan.summon)weaponObjects=mirror().activate(room.weaponObjects,mirrorPlan,{uid,board:prism().boardForDungeon(map),clock:tick,level:sk.level,refinement});
    if(mirrorPlan.landing){player.position={...mirrorPlan.landing};position={...mirrorPlan.landing};}
    mirror().resolve(mirrorPlan,enemies,Boss.occupies,e=>healthy(e)>0,(enemy,power,cell,index,part)=>{
      apply(enemy,power);Object.assign(hits.at(-1),{cell,part:index,avatar:part.avatar});
    });
  }else if(selection){
    if(!weavePlan)throw fail(selection.reason,409);
    cells=weavePlan.cells;
    weaponObjects=weave().place(room.weaponObjects,weavePlan,{uid,board:prism().boardForDungeon(map),clock:tick,level:sk.level,refinement});
    weave().resolve(weavePlan,enemies,Boss.occupies,e=>healthy(e)>0,(enemy,power,cell)=>{
      apply(enemy,power);hits.at(-1).cell=cell;
    });
  }else if(bell()?.supports(sk)){
    if(!bellPlan)throw fail('請選擇合法出拳方向或自身格',409);
    cells=bellPlan.cells;
    bellSteps=bell().resolve(bellPlan,{
      targets:()=>enemies,alive:e=>healthy(e)>0,covers:Boss.occupies,
      apply:(enemy,power,layer,cell)=>{
        apply(enemy,power);
        const hit=hits.at(-1);hit.layer=layer;hit.cell=cell;
        return {damage:hit.damage,absorbed:hit.shieldDamage||0};
      },
      push:(enemy,d)=>{if(advance(enemy,d,1))enemy.attack=null;},
      afterStep:step=>{if(copy)copy(origin,{direction:axis(origin,target),layer:step.layer,power:sk.power});}
    });
  }else if(prism()?.supports(sk)){
    if(!prismPlan)throw fail('請選擇未受阻擋的八方向直線',409);
    cells=prismPlan.cells;
    prism().resolve(prismPlan,sk,enemies.filter(e=>healthy(e)>0),h=>{
      const enemy=enemies.find(e=>e.id===h.uid);if(healthy(enemy)<=0)return null;
      apply(enemy,h.power);const hit=hits.at(-1);hit.rayId=h.rayId;hit.depth=h.depth;hit.cell=h.cell;return hit;
    },Boss.occupies);
  }else if(sk.kind==='fist-focus'){
    if(!same(origin,target))throw fail('蓄勢必須選擇自身格',409);
    player.focusCharges=6;
  }else if(sk.kind==='line'){
    const line=ray(map,origin,target,sk.unlimited?map.width+map.height:sk.range);
    if(!line.some(p=>same(p,target)))throw fail('請選擇同一直線且未被岩壁阻擋的目標',409);
    cells=line;
    for(const e of targets(cells))apply(e,sk.power);
    if(copy)copy(origin,{direction:axis(origin,target),layer:1,power:sk.power});
    // Forced displacement is processed from farthest first to avoid overlaps.
    if(sk.pushToEdge){
      const d=axis(origin,target);
      for(const e of targets(cells).sort((a,b)=>distance(origin,b.position)-distance(origin,a.position))){
        const goal={...e.position};
        advance(e,d,map.width+map.height);
        if(!same(goal,e.position))e.attack=null;
      }
    }
  }else if(sk.kind==='sword-array'){
    if(distance(origin,target)>sk.range)throw fail('劍陣中心超出技能範圍',409);
    // The center must be visible by a 4-connected open corridor.
    if(!visible(map,origin,target))
      throw fail('岩壁阻擋劍陣中心',409);
    const rays=beamArray(map,target,sk);
    cells=[target,...rays.flatMap(r=>r.cells)];
    for(const e of targets(cells)){
      if(Boss.occupies(e,target)){
        // The center receives only beams that can actually traverse the map.
        // A missing ray never becomes a free bonus hit through stone walls.
        const repeats=sk.orthogonal?rays.length:
          new Set(rays.map(r=>Math.sign(r.dx*r.dy))).size;
        const each=(sk.centerPower||sk.power)/(sk.orthogonal?8:2);
        for(let i=0;i<repeats;i++)apply(e,each);
      }else if(sk.orthogonal){
        for(const r of rays.filter(r=>r.cells.some(p=>Boss.occupies(e,p))))
          apply(e,sk.power);
      }else{
        // Crossed diagonals form two sweeps; a given arm hits once.
        for(const r of rays.filter(r=>r.cells.some(p=>Boss.occupies(e,p))))
          apply(e,sk.power);
      }
    }
  }else if(sk.kind==='flying-sword'){
    if(occupied(target,enemies)||present(members,target))
      throw fail('飛劍落點必須是空地',409);
    if(!moveSword&&(distance(origin,target)<1||distance(origin,target)>2))
      throw fail('召劍只能指定玩家曼哈頓距離兩格內的空地',409);
    if(sword){
      if(!swordSteps)throw fail('飛劍找不到通往目標的最短路徑',409);
      flightPath=swordPath.map(p=>({...p}));
      cells=flightPath.slice(1);
      const power=moveSword?(member.flyingSwordBalanceVersion===2?member.flyingSwordPower:sk.movePower):sk.power;
      for(const e of targets(cells))apply(e,power);
    }else{
      if(moveSword)throw fail('飛劍尚未召喚',409);
      flightPath=[{...origin},{...target}];
    }
    player.flyingSword={...target};
    if(!moveSword){player.flyingSwordPower=sk.movePower;player.flyingSwordBalanceVersion=2;}
  }else if(sk.kind==='dash-cleave'){
    const path=rayTo(map,origin,target,sk.range);
    if(!path||path.some(p=>occupied(p,enemies)||present(members,p)))
      throw fail('突進路線必須是連續直線空地',409);
    const d=axis(origin,target);
    player.position={...target};position={...target};
    cells=front(map,target,d,!!sk.tShape);
    if(copy){
      const times=sk.hits||1;
      for(let i=0;i<times;i++){
        for(const e of targets(cells))apply(e,sk.power/times);
        copy(target,{direction:d,power:sk.power/times,layer:i+1});
      }
    }else for(const e of targets(cells)){
      const times=sk.hits||1;
      for(let i=0;i<times;i++)apply(e,sk.power/times);
    }
  }else if(['fist-sweep','fist-throw','fist-chain'].includes(sk.kind)){
    const d=axis(origin,target);
    if(!d||distance(origin,target)!==1)
      throw fail('請選擇相鄰的上下左右方向',409);
    if(sk.kind==='fist-chain'){
      let current={...origin};
      for(let n=0;n<(sk.steps||4);n++){
        const row=front(map,current,d,false);
        if(!row.length)break;
        cells.push(...row);
        // Preserve the true four ordered impacts for the client's original
        // 問道試煉 step-by-step animation, rather than one final-coordinate
        // jump. Everything here is computed on the authoritative server.
        const starts=new Map(enemies.map(e=>[e.id,{...e.position}]));
        const hitStart=hits.length,from={...current};
        for(const e of targets(row)){
          apply(e,sk.power);
          if(healthy(e)>0){
            const moved=advance(e,d,1);
            if(moved)e.attack=null;
            if(!moved&&sk.collisionPower>0)apply(e,sk.collisionPower);
          }
        }
        if(copy)copy(current,{direction:d,power:sk.power,layer:n+1,cells:row});
        const ahead=forward(current,d,1);
        const canStep=tile(map,ahead)&&!occupied(ahead,enemies)&&
          !present(members,ahead);
        if(canStep)current=ahead;
        chainSteps.push({step:n+1,origin:from,target:forward(from,d,1),
          cells:row.map(p=>({...p})),
          hits:hits.slice(hitStart).map(h=>({...h})),
          visualMoves:enemies.filter(e=>!same(starts.get(e.id),e.position))
            .slice(0,12).map(e=>({enemyId:e.id,
              from:{...starts.get(e.id)},to:{...e.position}})),
          position:{...current}});
        if(!canStep)break;
      }
      player.position=current;position=current;
    }else{
      cells=front(map,origin,d,!!sk.tShape);
      for(const e of targets(cells)){
        if(sk.kind==='fist-throw'){
          if(e.kind==='boss'){apply(e,sk.power);continue;}
          const landing=forward(e.position,d,-2);
          if(!tile(map,landing)||occupied(landing,enemies,e.id)||
              present(members,landing))continue;
          e.position={...landing};e.attack=null;
          apply(e,sk.power);
        }else{
          apply(e,sk.power);
          if(healthy(e)>0&&sk.push){
            if(advance(e,d,sk.push))e.attack=null;
          }
        }
      }
      if(copy)copy(origin,{direction:d,power:sk.power,layer:1});
    }
  }else throw fail('此技能尚未支援即時副本，請選擇其他功法',409);
  // The client cannot create damage, revive defeated enemies, or set focus.
  if(mirrorBeats.length&&sk.kind==='dash-cleave'&&position&&!same(origin,position))
    mirrorBeats[0].body.moves.unshift({uid,path:[{...origin},{...position}],style:'dash'});
  if(mirrorBeats.length&&sk.kind==='fist-chain')for(const [i,step] of chainSteps.entries())
    if(mirrorBeats[i]&&!same(step.origin,step.position))mirrorBeats[i].body.moves.push({uid,path:[step.origin,step.position],style:'slide'});
  const mirrorTimeline=mirrorPlan?mirror().timeline(sk,mirror().baseBeats(mirrorPlan,sk,uid,hits.map(asHit),
    position&&!same(origin,position)?[{uid,path:[{...origin},{...position}],style:'swap'}]:[])):
    mirrorBeats.length&&!bellPlan?mirror().timeline(sk,mirrorBeats):null;
  const surviving=enemies.filter(e=>healthy(e)>0);
  const chargeBefore=Math.max(0,Math.min(6,member.focusCharges||0));
  if(empowered)player.focusCharges=chargeBefore-1;
  player.explorationStamina=staminaAfterCost(member,cost);
  player.skillSeq=seq;
  // Small, bounded visual payload: the shared SSE already transports the
  // last resolved skill, so all clients see the same ground-level impact
  // trace without trusting browser-supplied damage or affected squares.
  if(mirrorSteps.length)cells=[...new Map([...cells,...mirrorSteps.flatMap(s=>s.cells)].map(p=>[key(p),p])).values()];
  const seen=new Set();
  const effectCells=(sk.kind==='fist-focus'?[origin]:cells)
    .filter(p=>tile(map,p)&&!seen.has(key(p))&&seen.add(key(p)))
    .slice(0,weavePlan||mirrorSteps.length?map.width*map.height:bellPlan?80:72).map(p=>({x:p.x,y:p.y}));
  const visualMoves=enemies.filter(e=>startingPositions.has(e.id)&&
    !same(startingPositions.get(e.id),e.position)).slice(0,12).map(e=>({
      enemyId:e.id,from:{...startingPositions.get(e.id)},to:{...e.position}
    }));
  const result={seq,skillId,skillName:moveSword?'移動飛劍':sk.name,
    moveSword:Boolean(moveSword),origin:{...origin},target:{...target},
    ...(flightPath?{path:flightPath}:{}),
    cost,hits,visualMoves,...(chainSteps.length?{chainSteps}:{}),
    ...(mirrorSteps.length?{mirrorSteps}:{}),
    ...(gravityPlan?{gravityPlan,...(gravityBeat?{gravityBeat}:{}),weaponTimeline:gravity().timeline(gravityPlan,sk,hits,{uid,beat:gravityBeat})}:{}),
    ...(timePlan?{timePlan,weaponTimeline:time().timeline(timePlan,sk,hits)}:{}),
    ...(mirrorPlan?{mirrorPlan}:{}),
    ...(mirrorTimeline?{weaponTimeline:mirrorTimeline}:{}),
    ...(weavePlan?{first:first?{x:first.x,y:first.y}:null,weavePlan,weaponTimeline:weave().timeline(weavePlan,sk,hits.map(h=>({uid:h.enemyId,damage:h.damage,absorbed:h.shieldDamage||0,cell:h.cell})))}:{}),
    ...(bellSteps?{bellSteps,weaponTimeline:bell().timeline(bellPlan,sk,bellSteps,null,mirrorSteps)}:{}),
    ...(prismPlan?{prismRays:prismPlan.rays,weaponTimeline:prism().timeline(prismPlan,sk,hits)}:{}),
    totalDamage:hits.reduce((a,h)=>a+h.damage,0),
    focusCharges:player.focusCharges||0,
    focusBefore:chargeBefore,focusEmpowered:empowered,
    focusActivated:sk.kind==='fist-focus',visualVersion:prismPlan||bellPlan||weavePlan||mirrorTimeline||timePlan||gravityPlan?2:1,effectCells,
    tick:Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0,
    ...(position?{position}:{})};
  player.lastSkill=result;
  members[uid]=player;
  return {duplicate:false,members,enemies:surviving,result,cells,...(weaponObjects?{weaponObjects}:{})};
}
function previewPlan(room,uid,map,skill){
  const plan={aims:[],cells:[],byAim:{},exact:false};
  const member=room?.members?.[uid],from=member?.position;
  if(!from||room.status!=='assembled'||member.downed||member.battleHealth===0||!tile(map,from)||!skill)return plan;
  const catalog=Manuals.BY_SKILL[skill.id];
  if(!catalog||!member.dungeonSkillIds?.includes(skill.id))return plan;
  // Older room snapshots omit refinement. Do not pretend their damage
  // is exact; fresh snapshots include the authoritative refinement level.
  const sk=Manuals.skillAtLevel(catalog,skill.level,skill.refinement||0);
  const base=Number.isSafeInteger(member.dungeonAttack)&&member.dungeonAttack>0?member.dungeonAttack:member.battleAttack||30;
  plan.exact=Number.isInteger(skill.refinement)&&Number.isSafeInteger(member.dungeonAttack)&&member.dungeonAttack>0;
  if(weave()?.supports(sk)){
    const geometry=weave().plans(prism().boardForDungeon(map),from,sk,room.weaponObjects,uid);
    plan.aims=geometry.aims;plan.cells=geometry.cells;plan.reason=geometry.reason;plan.pairs=geometry.pairs;plan.byPair={};
    const scheme=(target,first=null)=>{
      const out=resolveCast(room,uid,map,sk,{target,first,seq:(member.skillSeq||0)+1,base,preview:true,refinement:skill.refinement||0});
      return {aim:target,first,cells:out.cells,path:[],cost:out.result.cost,valid:staminaFor(member)>=out.result.cost,hits:out.result.hits,landings:[],totalDamage:out.result.totalDamage,weaponObjects:out.weaponObjects,weavePlan:out.result.weavePlan,weaponTimeline:out.result.weaponTimeline};
    };
    for(const q of Object.values(geometry.byAim))plan.byAim[key(q.aim)]=scheme(q.aim);
    for(const pair of geometry.pairs)plan.byPair[weave().pairKey(pair.first,pair.second)]=scheme(pair.second,pair.first);
    return plan;
  }
  const candidates=[];
  const prismGeometry=prism()?.supports(sk)?prism().plans(prism().boardForDungeon(map),from,sk):null;
  if(gravity()?.supports(sk)){
    const geometry=gravity().plans(prism().boardForDungeon(map),from,sk,room.weaponObjects,uid,[...(room.enemies||[]),...Object.entries(room.members).map(([id,m])=>({...m,uid:id}))]);
    candidates.push(...geometry.aims);plan.reason=geometry.reason;
  }else if(time()?.supports(sk)){
    const geometry=time().plans(prism().boardForDungeon(map),from,sk,room.weaponObjects,uid);
    candidates.push(...geometry.aims);plan.reason=geometry.reason;
  }else if(mirror()?.supports(sk)){
    const geometry=mirror().plans(prism().boardForDungeon(map),from,sk,room.weaponObjects,uid,q=>tile(map,q)&&!occupied(q,room.enemies||[])&&!Object.entries(room.members).some(([id,m])=>id!==uid&&same(m.position,q)));
    candidates.push(...geometry.aims);plan.reason=geometry.reason;
  }else if(bell()?.supports(sk))candidates.push(...bell().plans(prism().boardForDungeon(map),from,sk).aims);
  else if(prismGeometry)candidates.push(...Object.values(prismGeometry.byDirection).map(p=>p.aims[0]));
  else if(sk.kind==='fist-focus')candidates.push({...from});
  else if(sk.kind==='line'||sk.kind==='dash-cleave'){
    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
      candidates.push(...ray(map,from,{x:from.x+dx,y:from.y+dy},sk.unlimited?map.width+map.height:sk.range));
    }
  }else if(['fist-sweep','fist-throw','fist-chain'].includes(sk.kind)){
    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]])candidates.push({x:from.x+dx,y:from.y+dy});
  }else{
    const range=sk.kind==='flying-sword'?2:sk.range;
    for(let y=Math.max(0,from.y-range);y<=Math.min(map.height-1,from.y+range);y++)
      for(let x=Math.max(0,from.x-range);x<=Math.min(map.width-1,from.x+range);x++)
        if(distance(from,{x,y})<=range)candidates.push({x,y});
  }
  const union=new Map();
  for(const target of candidates){
    if(!tile(map,target))continue;
    let out;
    try{out=resolveCast(room,uid,map,sk,{target,seq:(member.skillSeq||0)+1,base,preview:true,refinement:skill.refinement||0});}
    catch(e){if(e.status===409)continue;throw e;}
    const {result}=out,cells=[...new Map(out.cells.map(p=>[key(p),{x:p.x,y:p.y}])).values()];
    const path=result.path||[from,...(result.chainSteps||[]).map(s=>s.position)];
    const scheme={aim:{...target},cells,path:path.map(p=>({...p})),cost:result.cost,valid:staminaFor(member)>=result.cost,
      hits:result.hits,landings:result.visualMoves.map(m=>m.to),position:result.position,
      totalDamage:result.totalDamage,...(result.gravityPlan?{gravityPlan:result.gravityPlan,gravityBeat:result.gravityBeat,weaponTimeline:result.weaponTimeline,weaponObjects:out.weaponObjects||room.weaponObjects||null}:{}),...(result.timePlan?{timePlan:result.timePlan,weaponObjects:out.weaponObjects||room.weaponObjects||null,weaponTimeline:result.weaponTimeline}:{}),...(result.mirrorSteps?{mirrorSteps:result.mirrorSteps,weaponTimeline:result.weaponTimeline}:{}),...(result.mirrorPlan?{mirrorPlan:result.mirrorPlan,weaponObjects:out.weaponObjects||room.weaponObjects||null,weaponTimeline:result.weaponTimeline}:{}),...(result.bellSteps?{bellSteps:result.bellSteps,weaponTimeline:result.weaponTimeline}:{}),...(result.prismRays?{rays:result.prismRays,weaponTimeline:result.weaponTimeline}:{})};
    if(result.position&&path.length===1)scheme.path.push({...result.position});
    const aliases=prismGeometry?.byAim[key(target)]?.aims||[target];
    for(const aim of aliases){plan.aims.push({...aim});plan.byAim[key(aim)]={...scheme,aim:{...aim}};}
    for(const p of cells)union.set(key(p),p);
  }
  plan.cells=[...union.values()];return plan;
}
const RANGE=2,DAMAGE=30,DIRECTIONS=[[0,-1],[1,0],[0,1],[-1,0]];
const playerStrikeDamage=member=>
  // Initial/switch-loadout values come from verified A-side manuscript state.
  // The trial includes this bonus even when no technique is equipped.
  Number.isSafeInteger(member?.dungeonAttack)&&member.dungeonAttack>0?
    member.dungeonAttack:
    Number.isSafeInteger(member?.battleAttack)&&member.battleAttack>0?
      member.battleAttack:DAMAGE;
function strikeLine(map,origin,enemy){
  // Select the shortest legal cardinal ray that intersects the requested
  // creature, including all four cells of the 2x2 boss. Stone blocks rays.
  let best=null;
  for(const [dx,dy] of DIRECTIONS){
    const cells=[];
    for(let n=1;n<=RANGE;n++){
      const p={x:origin.x+dx*n,y:origin.y+dy*n};
      if(!walkable(map,p))break;
      cells.push(p);
      if(Boss.occupies(enemy,p)){
        if(!best||n<best.distance)best={cells:[],distance:n,dx,dy};
        break;
      }
    }
  }
  if(!best)return null;
  const cells=[];
  for(let n=1;n<=RANGE;n++){
    const p={x:origin.x+best.dx*n,y:origin.y+best.dy*n};
    if(!walkable(map,p))break;
    cells.push(p);
  }
  return cells;
}

function resolveBasic(room,uid,cells){
  const damageAmount=playerStrikeDamage(room.members[uid]);
  const tick=Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0;
  const updated=[],hits=[];
  for(const enemy of room.enemies){
    if(!cells.some(p=>Boss.occupies(enemy,p))){
      updated.push(enemy);continue;
    }
    const health=Number.isSafeInteger(enemy.battleHealth)?
      Math.max(0,Math.min(recordedMax(enemy),enemy.battleHealth)):
      recordedMax(enemy);
    if(!health){updated.push(enemy);continue;}
    const copy={...enemy};
    const teamwork=enemy.kind==='boss'?
      Boss.damage(copy,uid,damageAmount,tick,Boss.comboReady(enemy,uid,tick)):null;
    const remaining=teamwork?copy.battleHealth:Math.max(0,health-damageAmount);
    if(!teamwork){
      copy.battleHealth=remaining;
      copy.battleMaxHealth=recordedMax(enemy);
    }
    const hit={enemyId:enemy.id,damage:teamwork?.damage??Math.min(health,damageAmount),
      remainingHealth:remaining,defeated:remaining===0,
      ...(teamwork?{shieldDamage:teamwork.shieldDamage,combo:teamwork.combo,
        shieldBroken:teamwork.shieldBroken}:{})};
    hits.push(hit);
    if(remaining>0)updated.push(copy);
  }

  return {updated,hits};
}
function basicPreviewPlan(room,uid,map){
  const result={aims:[],cells:[],byAim:{},byEnemy:{},exact:true};
  const member=room?.members?.[uid],from=member?.position;
  if(!from||room.status!=='assembled'||member.downed||member.battleHealth===0||member.dungeonSkillIds?.length||!tile(map,from))return result;
  const union=new Map();
  for(const [dx,dy] of DIRECTIONS)for(const p of ray(map,from,{x:from.x+dx,y:from.y+dy},RANGE))union.set(key(p),p);
  result.cells=[...union.values()];
  for(const enemy of room.enemies||[]){
    if(enemy.battleHealth===0)continue;
    const cells=strikeLine(map,from,enemy);if(!cells)continue;
    const {hits}=resolveBasic(room,uid,cells);
    if(!hits.some(h=>h.enemyId===enemy.id))continue;
    const scheme={aim:{...enemy.position},cells,path:[],landings:[],hits,cost:2,valid:staminaFor(member)>=2,totalDamage:hits.reduce((n,h)=>n+h.damage,0)};
    result.byEnemy[enemy.id]=scheme;
    for(const p of Boss.cells(enemy))if(union.has(key(p))){
      result.aims.push({...p});result.byAim[key(p)]=scheme;
    }
  }
  return result;
}
return Object.freeze({resolveCast,previewPlan,basicPreviewPlan,resolveBasic,strikeLine,playerStrikeDamage,ray,rayTo,visible,beamArray,isFocusEmpowered,focusCost});
});
