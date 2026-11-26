'use strict';
// Stage 11B: deterministic dungeon-only martial arts, independent of tactical
// turns. The server owns loadouts, geometry, stamina, damage and NPC positions.
const Manuals=require('./public/cultivation/manual-rules.js');
const SwordPath=require('./public/cultivation/flying-sword-path.js');
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const {maxHealth,recordedMax,MAX_STRIKE_SEQ}=require('./dungeon-player-combat.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const {staminaFor,staminaAfterCost}=require('./dungeon-stamina-rules.cjs');
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
const skillOf=(id,record,score)=>{
  const s=Manuals.BY_SKILL[id];
  if(!s||!Manuals.unlocked(record,id))return null;
  return Manuals.skillAtLevel(s,record.skillLevels?.[id],Manuals.refinementFor(record.books?.[s.manualId]));
};
const describeDungeonSkill=skill=>{
  if(skill.kind==='fist-focus')
    return '立即凝聚六層蓄勢。接下來六次成功施放的體修攻擊，體力消耗減半並向上取整；每次耗一層。副本中沒有回合或冷卻時間限制。';
  if(skill.kind==='flying-sword')
    return String(skill.description||'')+'副本中沒有回合或冷卻時間限制。';
  return String(skill.description||'');
};
const loadout=(record,score,index,member=null)=>{
  const s=Manuals.normalize(record);
  if(!Number.isInteger(index)||index<0||index>=3)throw fail('技能配置編號無效',400);
  const item=s.loadouts[index];
  const weaponMode=Array.isArray(s.weaponIds);
  const ids=(weaponMode?s.equipped:item.skillIds).filter(id=>skillOf(id,s,score));
  return {dungeonLoadoutIndex:weaponMode?0:index,
    dungeonLoadoutNames:weaponMode?[]:s.loadouts.map(v=>v.name),
    dungeonWeaponIds:weaponMode?[...s.weaponIds]:[],
    dungeonSkillIds:ids,dungeonSkills:ids.map(id=>{
      const skill=skillOf(id,s,score);
      const preview=Manuals.singleHitDamage(attackPower(s,member),skill);
      return {id,weaponId:skill.manualId,name:skill.name,kind:skill.kind,school:skill.school,
        cost:skill.cost,range:skill.range,level:skill.level,
        singleHitDamage:preview.damage||preview.potential||0,
        ...(preview.center!==undefined?{centerHitDamage:preview.center}:{}),
        description:describeDungeonSkill(skill)};
    })};
};
function attackPower(record,member=null){
  // A dungeon is a 築基 trial: the server's trusted combat attack should
  // match the real trial, not the obsolete fixed 30-point dungeon scale.
  // Manuscript bonuses are re-read from A before each cast; any legacy
  // member without a trusted snapshot keeps its original fallback.
  const trusted=Number.isSafeInteger(member?.battleAttack)&&
    member.battleAttack>0?member.battleAttack:30;
  return trusted+Math.min(200,Manuals.manualAttackBonus(record));
}
function initialCombatLoadout(member,raw){
  const record=Manuals.normalize(raw),score=member.accessScore||0;
  return {...loadout(record,score,record.activeLoadout,member),
    dungeonAttack:attackPower(record,member),flyingSword:null,focusCharges:0,
    skillSeq:0,lastSkill:null};
}
function switchLoadout(room,uid,raw,index){
  if(Array.isArray(raw?.weaponIds))
    throw fail('多人副本戰鬥中不可切換、裝備或卸下武器',409);
  const member=room.members?.[uid];
  if(room.status!=='assembled'||!member)throw fail('目前無法切換副本功法',409);
  const setting=loadout(Manuals.normalize(raw),member.accessScore||0,index,member);
  if(member.dungeonLoadoutIndex===index&&
    JSON.stringify(member.dungeonSkillIds||[])===JSON.stringify(setting.dungeonSkillIds))
    return {duplicate:true,members:room.members};
  return {duplicate:false,members:{...room.members,
    [uid]:{...member,...setting,dungeonAttack:attackPower(raw,member)}}};
}
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
function castSkill(room,uid,map,raw,{skillId,target,seq,moveSword=false}={}){
  if(typeof skillId!=='string'||!Manuals.BY_SKILL[skillId])
    throw fail('功法技能無效',400);
  if(!target||!Number.isSafeInteger(target.x)||!Number.isSafeInteger(target.y)||
      !Number.isSafeInteger(seq)||seq<1||seq>MAX_STRIKE_SEQ)
    throw fail('技能目標或操作序號無效',400);
  if(room.status!=='assembled')throw fail('隊伍尚未開始探索',409);
  const member=room.members?.[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  const prior=Number.isSafeInteger(member.skillSeq)?member.skillSeq:0;
  if(seq===prior&&member.lastSkill?.skillId===skillId&&
      member.lastSkill.moveSword===Boolean(moveSword)&&
      same(member.lastSkill.target,target))
    return {duplicate:true,members:room.members,enemies:room.enemies};
  if(seq!==prior+1)throw fail('技能操作已不同步，請重新取得戰場資料',409);
  if(!isAlive(member)||!tile(map,member.position))throw fail('角色倒地或位置無效',409);
  if(moveSword&&(skillId!=='flight-summon'||!member.flyingSword))
    throw fail('沒有可控制的飛劍',409);
  if(!moveSword&&(!Array.isArray(member.dungeonSkillIds)||
      !member.dungeonSkillIds.includes(skillId)))throw fail('此技能尚未裝備於目前配置',403);
  const normalized=Manuals.normalize(raw);
  const sk=skillOf(skillId,normalized,member.accessScore||0);
  if(!sk)throw fail('武器技能尚未解鎖',403);
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
  if(stamina<cost)throw fail('探索體力不足，無法施放技能',409);
  const enemies=(room.enemies||[]).map(e=>({...e,position:{...e.position}}));
  const startingPositions=new Map(enemies.map(e=>[e.id,{...e.position}]));
  const members={...room.members};
  let player={...member},hits=[],cells=[],position=null,chainSteps=[],
    sword=member.flyingSword||null,flightPath=null;
  // Re-derive attack from the latest verified A-side manual snapshot: A can
  // gain manuscript EXP in another session while this C dungeon stays open.
  const base=attackPower(normalized,member);
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
  if(sk.kind==='fist-focus'){
    if(!same(origin,target))throw fail('蓄勢必須選擇自身格',409);
    player.focusCharges=6;
  }else if(sk.kind==='line'){
    const line=ray(map,origin,target,sk.unlimited?map.width+map.height:sk.range);
    if(!line.some(p=>same(p,target)))throw fail('請選擇同一直線且未被岩壁阻擋的目標',409);
    cells=line;
    for(const e of targets(cells))apply(e,sk.power);
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
      const power=moveSword?(member.flyingSwordPower||sk.power):sk.power;
      for(const e of targets(cells))apply(e,power);
    }else{
      if(moveSword)throw fail('飛劍尚未召喚',409);
      flightPath=[{...origin},{...target}];
    }
    player.flyingSword={...target};
    if(!moveSword)player.flyingSwordPower=sk.power;
  }else if(sk.kind==='dash-cleave'){
    const path=rayTo(map,origin,target,sk.range);
    if(!path||path.some(p=>occupied(p,enemies)||present(members,p)))
      throw fail('突進路線必須是連續直線空地',409);
    const d=axis(origin,target);
    player.position={...target};position={...target};
    cells=front(map,target,d,!!sk.tShape);
    for(const e of targets(cells)){
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
    }
  }else throw fail('此技能尚未支援即時副本，請選擇其他功法',409);
  // The client cannot create damage, revive defeated enemies, or set focus.
  const surviving=enemies.filter(e=>healthy(e)>0);
  const chargeBefore=Math.max(0,Math.min(6,member.focusCharges||0));
  if(empowered)player.focusCharges=chargeBefore-1;
  player.explorationStamina=staminaAfterCost(member,cost);
  player.skillSeq=seq;
  // Small, bounded visual payload: the shared SSE already transports the
  // last resolved skill, so all clients see the same ground-level impact
  // trace without trusting browser-supplied damage or affected squares.
  const seen=new Set();
  const effectCells=(sk.kind==='fist-focus'?[origin]:cells)
    .filter(p=>tile(map,p)&&!seen.has(key(p))&&seen.add(key(p)))
    .slice(0,72).map(p=>({x:p.x,y:p.y}));
  const visualMoves=enemies.filter(e=>startingPositions.has(e.id)&&
    !same(startingPositions.get(e.id),e.position)).slice(0,12).map(e=>({
      enemyId:e.id,from:{...startingPositions.get(e.id)},to:{...e.position}
    }));
  const result={seq,skillId,skillName:moveSword?'移動飛劍':sk.name,
    moveSword:Boolean(moveSword),origin:{...origin},target:{...target},
    ...(flightPath?{path:flightPath}:{}),
    cost,hits,visualMoves,...(chainSteps.length?{chainSteps}:{}),
    totalDamage:hits.reduce((a,h)=>a+h.damage,0),
    focusCharges:player.focusCharges||0,
    focusBefore:chargeBefore,focusEmpowered:empowered,
    focusActivated:sk.kind==='fist-focus',visualVersion:1,effectCells,
    tick:Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0,
    ...(position?{position}:{})};
  player.lastSkill=result;
  members[uid]=player;
  return {duplicate:false,members,enemies:surviving,result,cells};
}
module.exports={attackPower,initialCombatLoadout,loadout,switchLoadout,
  isFocusEmpowered,focusCost,ray,rayTo,visible,beamArray,castSkill};
