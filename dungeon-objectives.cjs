'use strict';
// Stage 14: guardian/key/portal are authoritative C-room objective state.
// No browser or player-account item can grant the shared key.
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const GUARDIAN_ID='guardian-1',GUARDIAN_NAME='鎮鑰玄甲獸',VERSION=1;
const GUARDIAN_HP=360;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function spawn(map,enemies){
  if(!walkable(map,map.guardianSite)||!walkable(map,map.portalSite)||
      !Array.isArray(map.mainRoute)||map.mainRoute.length<17)
    throw fail('副本鑰匙守護區地形有誤',409);
  const occupied=new Set(enemies.map(e=>e.position.x+','+e.position.y));
  const valid=p=>walkable(map,p)&&!occupied.has(p.x+','+p.y)&&
    !map.spawnPads.some(q=>same(p,q));
  // Prefer the pre-generated deepest destination. Extremely rare seed
  // collisions fall back to its immediately preceding corridor cells.
  const position=[map.guardianSite,...map.mainRoute.slice(-17).reverse()]
    .find(valid);
  if(!position)throw fail('守鑰靈獸找不到合法出生點',409);
  const path=map.mainRoute.slice(-17);
  const patrolIndex=Math.max(0,path.findIndex(p=>same(p,position)));
  const guardian={id:GUARDIAN_ID,name:GUARDIAN_NAME,kind:'guardian',
    zone:'guardian',position:{...position},spawn:{...position},
    patrolIndex,patrolDirection:patrolIndex===0?1:-1,
    cadence:3,aggroRange:8,intent:'patrol',targetUid:null,
    lastActionTick:0,attack:null,lastAttack:null,lastAttackTick:0,
    battleHealth:GUARDIAN_HP,battleMaxHealth:GUARDIAN_HP};
  return {enemies:[...enemies,guardian],
    progress:{version:VERSION,guardianId:GUARDIAN_ID,guardianStatus:'alive',
      keyAcquired:false,portalStatus:'sealed',
      defeatedByUid:null,defeatedAtTick:null,
      openedByUid:null,openedAtTick:null}};
}
function combatProgress(room,afterEnemies,uid){
  const progress=room?.dungeonProgress;
  if(progress?.version!==VERSION||progress.guardianStatus!=='alive')
    return progress||null;
  if(!Array.isArray(room.enemies)||!Array.isArray(afterEnemies))
    return progress;
  const before=room.enemies.find(e=>e.id===GUARDIAN_ID);
  if(!before||afterEnemies.some(e=>e.id===GUARDIAN_ID))return progress;
  // Guardian removal was calculated by the existing server-only strike/skill
  // engine in the same C transaction, never asserted by the browser.
  return {...progress,guardianStatus:'defeated',keyAcquired:true,
    portalStatus:'ready',defeatedByUid:uid,
    defeatedAtTick:Number.isSafeInteger(room.battleAppliedTick)?
      room.battleAppliedTick:0};
}
function activate(room,uid,map){
  if(room?.status!=='assembled')throw fail('副本尚未開始',409);
  const member=room.members?.[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  const progress=room.dungeonProgress;
  if(progress?.version!==VERSION)throw fail('本場副本尚未建立守鑰任務，請重新集結',409);
  if(progress.portalStatus==='open')return {duplicate:true,progress};
  if(progress.guardianStatus!=='defeated'||progress.keyAcquired!==true||
      progress.portalStatus!=='ready')
    throw fail('必須先擊敗鎮鑰玄甲獸，取得全隊共享密鑰',409);
  if(!isAlive(member))throw fail('已倒地，不能啟動傳送門',409);
  if(!walkable(map,member.position)||!walkable(map,map.portalSite)||
      distance(member.position,map.portalSite)>1)
    throw fail('請先走到傳送門或相鄰一格，再使用密鑰',409);
  return {duplicate:false,progress:{...progress,portalStatus:'open',
    openedByUid:uid,openedAtTick:Number.isSafeInteger(room.battleAppliedTick)?
      room.battleAppliedTick:0}};
}
function publicProgress(data){
  if(!data||data.version!==VERSION)return null;
  return {version:VERSION,guardianStatus:data.guardianStatus,
    keyAcquired:data.keyAcquired===true,portalStatus:data.portalStatus,
    defeatedByUid:data.defeatedByUid||null,
    defeatedAtTick:data.defeatedAtTick??null,
    openedByUid:data.openedByUid||null,openedAtTick:data.openedAtTick??null};
}
module.exports={GUARDIAN_ID,GUARDIAN_NAME,GUARDIAN_HP,VERSION,
  spawn,combatProgress,activate,publicProgress};
