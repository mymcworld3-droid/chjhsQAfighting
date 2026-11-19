'use strict';

// Stage 16: cooperative boss-portal consent, independent of the lobby ready flag.
// Firestore C is authoritative; browser payloads only contain true/false votes.
// A member must personally stand at the activated portal and remain alive.
// Offline members stop blocking after 60s of missed heartbeats, and join the
// same boss room on reconnect. The final vote is serialized in C.
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive}=require('./dungeon-enemy-combat.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const VERSION=1,ONLINE_GRACE_MS=60000;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const counter=(value)=>Number.isSafeInteger(value)&&value>=0?value:0;
const validRoom=room=>room?.mode==='dungeon'&&room.status==='assembled'&&
  room.dungeonArena==='exploration'&&room.dungeonProgress?.keyAcquired===true&&
  room.dungeonProgress?.portalStatus==='open';
const membersOf=room=>room?.members&&typeof room.members==='object'?
  room.members:{};
const online=(member,at)=>Number.isFinite(Number(member?.heartbeatAtMs))&&
  Number(member.heartbeatAtMs)>0&&Math.max(0,at-Number(member.heartbeatAtMs))<=ONLINE_GRACE_MS;
const near=(member,map)=>member?.position&&map?.portalSite&&
  walkable(map,member.position)&&distance(member.position,map.portalSite)<=1;
function matchingVote(room,uid,map){
  const member=membersOf(room)[uid],vote=room.bossPortalReady?.votes?.[uid];
  if(!member||!vote||vote.session!==room.assembledAtMs||
      !isAlive(member)||!near(member,map))return false;
  return vote.x===member.position.x&&vote.y===member.position.y&&
    vote.moveSeq===counter(member.moveSeq)&&
    vote.allyReviveCount===counter(member.allyReviveCount)&&
    vote.selfRescueCount===counter(member.selfRescueCount);
}
function project(room,map,at){
  if(!validRoom(room))return null;
  const ids=Object.keys(membersOf(room)).sort();
  const requiredUids=ids.filter(uid=>online(room.members[uid],at));
  const readyUids=requiredUids.filter(uid=>matchingVote(room,uid,map));
  const offlineUids=ids.filter(uid=>!requiredUids.includes(uid));
  return {version:VERSION,readyUids,requiredUids,offlineUids,
    readyCount:readyUids.length,requiredCount:requiredUids.length,
    offlineCount:offlineUids.length,
    allReady:requiredUids.length>0&&readyUids.length===requiredUids.length};
}
function vote(room,uid,map,at,ready,roomId=''){
  if(!validRoom(room))throw fail('請先取得密鑰並啟動傳送門',409);
  if(typeof ready!=='boolean')throw fail('首領戰確認狀態無效',400);
  const member=membersOf(room)[uid];
  if(!member)throw fail('你不是此副本的隊員',403);
  if(!Number.isSafeInteger(at)||at<=0)throw fail('伺服器時間無效',503);
  if(ready&&(!isAlive(member)||!near(member,map)))
    throw fail('請先恢復行動能力並站到傳送門或相鄰一格',409);
  const previous=room.bossPortalReady?.votes||{};
  const votes=Object.fromEntries(Object.entries(previous).filter(([id])=>
    Object.prototype.hasOwnProperty.call(room.members,id)));
  const before=matchingVote(room,uid,map);
  if(ready){
    votes[uid]={session:room.assembledAtMs,
      x:member.position.x,y:member.position.y,
      moveSeq:counter(member.moveSeq),
      allyReviveCount:counter(member.allyReviveCount),
      selfRescueCount:counter(member.selfRescueCount)};
  }else{
    delete votes[uid];
  }
  const updatedMembers={...room.members,
    [uid]:{...member,heartbeatAtMs:at}};
  const updated={...room,members:updatedMembers,
    bossPortalReady:{version:VERSION,votes}};
  const state=project(updated,map,at);
  if(ready&&state.allReady){
    // Boss.enter validates the actual key, portal and initiating player again.
    const arrived=Boss.enter(updated,uid,map,at,roomId);
    return {transitioned:!arrived.duplicate,changed:true,
      room:{...arrived.room,bossPortalReady:{version:VERSION,votes:{}}},state:null};
  }
  // The requesting member's heartbeat is refreshed, so this is a real
  // presence update even when their ready flag is unchanged.
  return {transitioned:false,
    changed:ready?!before||Number(member.heartbeatAtMs)!==at:
      Object.prototype.hasOwnProperty.call(previous,uid)||
      Number(member.heartbeatAtMs)!==at,
    room:updated,state};
}
module.exports={VERSION,ONLINE_GRACE_MS,validRoom,online,near,
  matchingVote,project,vote};
