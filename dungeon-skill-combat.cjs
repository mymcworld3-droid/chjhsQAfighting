'use strict';
// Stage 11B: deterministic dungeon-only martial arts, independent of tactical
// turns. The server owns loadouts, geometry, stamina, damage and NPC positions.
const Manuals=require('./public/cultivation/manual-rules.js');
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const {maxHealth,MAX_STRIKE_SEQ}=require('./dungeon-player-combat.cjs');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const key=p=>p.x+','+p.y;
const axis=(a,b)=>{
  const dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y);
  return (dx===0)!==(dy===0)?{x:dx,y:dy}:null;
};
const at=(p,dx,dy,n=1)=>({x:p.x+dx*n,y:p.y+dy*n});
const present=(members,enemy)=>Object.values(members).some(m=>isAlive(m)&&same(m.position,enemy));
const occupied=(p,enemies,ignore='')=>enemies.some(e=>e.id!==ignore&&same(e.position,p));
const tile=(map,p)=>walkable(map,p);
const skillOf=(id,record,score)=>{
  const s=Manuals.BY_SKILL[id];
  if(!s||!Manuals.unlocked(record,id)||!Manuals.meetsRealm(s,score))return null;
  return Manuals.skillAtLevel(s,record.skillLevels?.[id]);
};
const loadout=(record,score,index)=>{
  const s=Manuals.normalize(record);
  if(!Number.isInteger(index)||index<0||index>=3)throw fail('技能配置編號無效',400);
  const item=s.loadouts[index],ids=item.skillIds.filter(id=>skillOf(id,s,score));
  return {dungeonLoadoutIndex:index,dungeonLoadoutNames:s.loadouts.map(v=>v.name),
    dungeonSkillIds:ids,dungeonSkills:ids.map(id=>{
      const skill=skillOf(id,s,score);
      return {id,name:skill.name,kind:skill.kind,school:skill.school,
        cost:skill.cost,range:skill.range,description:skill.description};
    })};
};
function attackPower(record){
  // Independent dungeon scale (not the old tactical player's base attack).
  return 30+Math.min(200,Manuals.manualAttackBonus(record));
}
function initialCombatLoadout(member,raw){
  const record=Manuals.normalize(raw),score=member.accessScore||0;
  return {...loadout(record,score,record.activeLoadout),
    dungeonAttack:attackPower(record),flyingSword:null,focusCharges:0,
    skillSeq:0,lastSkill:null};
}
function switchLoadout(room,uid,raw,index){
  const member=room.members?.[uid];
  if(room.status!=='assembled'||!member)throw fail('目前無法切換副本功法',409);
  const setting=loadout(Manuals.normalize(raw),member.accessScore||0,index);
  if(member.dungeonLoadoutIndex===index&&
    JSON.stringify(member.dungeonSkillIds||[])===JSON.stringify(setting.dungeonSkillIds))
    return {duplicate:true,members:room.members};
  return {duplicate:false,members:{...room.members,
    [uid]:{...member,...setting,dungeonAttack:attackPower(raw)}}};
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
  return cells.filter(p=>tile(map,p));
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
function castSkill(room,uid,map,raw,{skillId,target,seq}={}){
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
      same(member.lastSkill.target,target))
    return {duplicate:true,members:room.members,enemies:room.enemies};
  if(seq!==prior+1)throw fail('技能操作已不同步，請重新取得戰場資料',409);
  if(!isAlive(member)||!tile(map,member.position))throw fail('角色倒地或位置無效',409);
  if(!Array.isArray(member.dungeonSkillIds)||
      !member.dungeonSkillIds.includes(skillId))throw fail('此技能尚未裝備於目前配置',403);
  const normalized=Manuals.normalize(raw);
  const sk=skillOf(skillId,normalized,member.accessScore||0);
  if(!sk)throw fail('功法尚未解鎖或修士境界不足',403);
  const cost=member.focusCharges>0&&sk.school==='body'&&sk.kind!=='fist-focus'?
    Math.ceil(sk.cost/2):sk.cost;
  const stamina=Number.isSafeInteger(member.explorationStamina)?
    member.explorationStamina:0;
  if(stamina<cost)throw fail('探索體力不足，無法施放技能',409);
  const origin=member.position;
  if(!tile(map,target))throw fail('目標不能位於牆壁或界外',409);
  const enemies=(room.enemies||[]).map(e=>({...e,position:{...e.position}}));
  const members={...room.members};
  let player={...member},hits=[],cells=[],position=null,sword=member.flyingSword||null;
  const base=Number.isSafeInteger(member.dungeonAttack)&&member.dungeonAttack>=30?
    member.dungeonAttack:attackPower(normalized);
  const damageFor=power=>Math.max(1,Math.round(base*power));
  const healthy=e=>Number.isSafeInteger(e.battleHealth)?
    Math.max(0,e.battleHealth):maxHealth(e.kind);
  const apply=(enemy,power)=>{
    if(!enemy||healthy(enemy)<=0)return;
    const health=healthy(enemy),damage=Math.min(health,damageFor(power));
    enemy.battleHealth=health-damage;enemy.battleMaxHealth=maxHealth(enemy.kind);
    hits.push({enemyId:enemy.id,damage,remainingHealth:enemy.battleHealth,
      defeated:enemy.battleHealth===0});
  };
  const targets=(locations)=>enemies.filter(e=>healthy(e)>0&&locations.some(p=>same(e.position,p)));
  const advance=(object,d,steps,maxDistance=steps)=>{
    let total=0;
    for(let n=0;n<steps&&total<maxDistance;n++){
      const p=forward(object,d,1);
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
    const axial=axis(origin,target);
    if(axial&&!rayTo(map,origin,target,sk.range))
      throw fail('岩壁阻擋劍陣中心',409);
    const rays=beamArray(map,target,sk);
    cells=[target,...rays.flatMap(r=>r.cells)];
    for(const e of targets(cells)){
      if(same(e.position,target)){
        const repeats=sk.orthogonal?8:2;
        const each=(sk.centerPower||sk.power)/repeats;
        for(let i=0;i<repeats;i++)apply(e,each);
      }else if(sk.orthogonal){
        for(const r of rays.filter(r=>r.cells.some(p=>same(p,e.position))))
          apply(e,sk.power);
      }else{
        // Crossed diagonals form two sweeps; a given arm hits once.
        for(const r of rays.filter(r=>r.cells.some(p=>same(p,e.position))))
          apply(e,sk.power);
      }
    }
  }else if(sk.kind==='flying-sword'){
    const start=sword||origin,range=sword?(sk.travel||4):sk.range;
    const trace=rayTo(map,start,target,range);
    if(!trace)throw fail('飛劍只能沿無阻擋的直線移動',409);
    if(!sword&&(occupied(target,enemies)||present(members,target)))
      throw fail('初次召劍請選擇空地',409);
    if(sword){cells=trace;for(const e of targets(trace))apply(e,sk.power);}
    player.flyingSword={...target};
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
    const originEnemy=sk.kind==='fist-chain'?null:null;
    if(sk.kind==='fist-chain'){
      let current={...origin};
      for(let n=0;n<(sk.steps||4);n++){
        const row=front(map,current,d,false);
        if(!row.length)break;
        cells.push(...row);
        for(const e of targets(row)){
          apply(e,sk.power);
          if(healthy(e)>0){
            const moved=advance(e,d,1);
            if(!moved&&sk.collisionPower>0)apply(e,sk.collisionPower);
          }
        }
        const ahead=forward(current,d,1);
        if(!tile(map,ahead)||occupied(ahead,enemies)||present(members,ahead))break;
        current=ahead;
      }
      player.position=current;position=current;
    }else{
      cells=front(map,origin,d,!!sk.tShape);
      for(const e of targets(cells)){
        if(sk.kind==='fist-throw'){
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
  if(sk.kind!=='fist-focus'&&chargeBefore>0)
    player.focusCharges=chargeBefore-1;
  player.explorationStamina=stamina-cost;
  player.skillSeq=seq;
  const result={seq,skillId,skillName:sk.name,target:{...target},
    cost,hits,totalDamage:hits.reduce((a,h)=>a+h.damage,0),
    focusCharges:player.focusCharges||0,
    tick:Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0,
    ...(position?{position}:{})};
  player.lastSkill=result;
  members[uid]=player;
  return {duplicate:false,members,enemies:surviving,result,cells};
}
module.exports={attackPower,initialCombatLoadout,loadout,switchLoadout,
  ray,rayTo,beamArray,castSkill};
