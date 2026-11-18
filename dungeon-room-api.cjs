'use strict';

// Multiplayer dungeon lobby only. No raid ticket, quiz, combat, or reward logic
// belongs here: those systems have separate authoritative state machines.
const crypto = require('node:crypto');
const { playerRepository, raidRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');

const ROOMS='dungeonRooms';
const CODES='dungeonRoomCodes';
const MEMBERSHIPS='dungeonRoomMemberships';
const VERSION=1;
const MAX_MEMBERS=4;
const PUBLIC_SCAN_LIMIT=120;
const PUBLIC_RESULT_LIMIT=24;
const LOBBY_TTL_MS=2*60*60*1000;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const err=(message,status=409)=>Object.assign(new Error(message),{status});
const safeRoomId=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''))?String(value):'';
const safeCode=value=>/^[A-HJ-NP-Z2-9]{6}$/.test(String(value||'').trim().toUpperCase())?String(value).trim().toUpperCase():'';
const makeCode=()=>Array.from({length:6},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const validRoom=(room,at)=>room?.mode==='dungeon'&&room.version===VERSION&&
  room.status==='waiting'&&Number(room.expiresAtMs)>at;
const membersOf=room=>room?.members&&typeof room.members==='object'&&!Array.isArray(room.members)?room.members:{};
const hasMember=(room,uid)=>Object.prototype.hasOwnProperty.call(membersOf(room),uid);
const publicRoom=(roomId,room)=>({
  id:roomId,mode:'dungeon',version:room.version,revision:room.revision,
  status:room.status,visibility:room.visibility==='public'?'public':'private',code:room.code,
  hostUid:room.hostUid,createdAtMs:room.createdAtMs,
  expiresAtMs:room.expiresAtMs,maxMembers:MAX_MEMBERS,
  members:membersOf(room)
});
const safeName=(value,uid)=>{
  const name=String(value||'').trim().slice(0,32);
  return name||('修士'+String(uid).slice(0,8));
};
const makeMember=(uid,name,at)=>({uid,name,joinedAtMs:at,ready:false});
// Public recruitment discloses only safe presentation fields, never codes,
// member identifiers, or complete room state.
function recruitmentCard(roomId,room,at){
  if(!safeRoomId(roomId)||!validRoom(room,at)||room.visibility!=='public'||
      !hasMember(room,room.hostUid))return null;
  const members=Object.values(membersOf(room));
  if(!members.length||members.length>=MAX_MEMBERS)return null;
  return {
    roomId,mode:'dungeon',status:'waiting',joinable:true,
    hostName:safeName(membersOf(room)[room.hostUid]?.name,room.hostUid),
    playerCount:members.length,maxMembers:MAX_MEMBERS,
    readyCount:members.filter(member=>member.ready===true).length,
    createdAtMs:room.createdAtMs,expiresAtMs:room.expiresAtMs
  };
}
async function listPublicRooms(db,at){
  // An equality query and in-process filtering need no composite index.
  const snap=await db.collection(ROOMS).where('status','==','waiting')
    .limit(PUBLIC_SCAN_LIMIT).get();
  return snap.docs.map(row=>recruitmentCard(row.id,row.data(),at)).filter(Boolean)
    .sort((a,b)=>b.playerCount-a.playerCount||b.createdAtMs-a.createdAtMs)
    .slice(0,PUBLIC_RESULT_LIMIT);
}

function createHandler({
  resolveA=()=>playerRepository.resolve(),
  resolveC=()=>raidRepository.resolve(),
  clock=()=>Date.now(),
  codeFactory=makeCode,
  logger=console
}={}){
  return async function dungeonRoomHandler(req,res){
    res.set?.('Cache-Control','no-store');
    const action=String(req.body?.action||'');
    try{
      if(!['create','join-code','join-public','list-public','quick','set-visibility','get','reconnect','leave'].includes(action))
        throw err('未知的副本房間操作',400);
      const uid=await verifyMainIdentity(req,{resolveA});
      const db=resolveC().db,at=clock();
      const pointerRef=db.collection(MEMBERSHIPS).doc(uid);
      const existing=async tx=>{
        const pointerSnap=await tx.get(pointerRef);
        const pointed=safeRoomId(pointerSnap.exists?pointerSnap.data()?.roomId:'');
        if(!pointed)return null;
        const roomSnap=await tx.get(db.collection(ROOMS).doc(pointed));
        const room=roomSnap.exists?roomSnap.data():null;
        return validRoom(room,at)&&hasMember(room,uid)?{id:pointed,room}:null;
      };
      const respond=(roomId,room)=>res.json({ok:true,roomId:roomId||null,room:room?publicRoom(roomId,room):null});
      const addMember=async(tx,roomId,room,name,{reuseExisting=false}={})=>{
        const current=await existing(tx);
        if(current&&current.id!==roomId){
          if(reuseExisting)return current;
          throw err('請先離開目前的副本隊伍',409);
        }
        if(hasMember(room,uid))return {id:roomId,room};
        const members=membersOf(room);
        if(Object.keys(members).length>=MAX_MEMBERS)throw err('副本隊伍已滿四人',409);
        const updated={...room,revision:room.revision+1,
          members:{...members,[uid]:makeMember(uid,name,at)}};
        tx.update(db.collection(ROOMS).doc(roomId),{
          revision:updated.revision,members:updated.members
        });
        tx.set(pointerRef,{roomId,updatedAtMs:at});
        return {id:roomId,room:updated};
      };
      if(action==='list-public')
        return res.json({ok:true,rooms:await listPublicRooms(db,at)});
      if(action==='quick'){
        const current=await db.runTransaction(existing);
        if(current)return respond(current.id,current.room);
        const user=await resolveA().db.collection('users').doc(uid).get();
        if(!user.exists)throw err('玩家資料不存在',404);
        const name=safeName(user.data()?.displayName||user.data()?.name,uid);
        for(const card of await listPublicRooms(db,at)){
          try{
            const joined=await db.runTransaction(async tx=>{
              const snap=await tx.get(db.collection(ROOMS).doc(card.roomId));
              const room=snap.exists?snap.data():null;
              if(!validRoom(room,at)||room.visibility!=='public'||
                  !hasMember(room,room.hostUid))throw err('公開隊伍已停止招募',409);
              return addMember(tx,card.roomId,room,name,{reuseExisting:true});
            });
            return respond(joined.id,joined.room);
          }catch(error){
            if(![404,409].includes(error?.status))throw error;
          }
        }
      }

      if(action==='create'||action==='quick'){
        if(action==='create'&&req.body?.visibility!==undefined&&
            !['public','private'].includes(req.body.visibility))
          throw err('公開狀態無效',400);
        const playerSnap=await resolveA().db.collection('users').doc(uid).get();
        if(!playerSnap.exists)throw err('玩家資料不存在',404);
        const name=safeName(playerSnap.data()?.displayName||playerSnap.data()?.name,uid);
        for(let attempt=0;attempt<10;attempt++){
          const code=safeCode(codeFactory());
          if(!code)throw err('房碼產生失敗',503);
          const roomRef=db.collection(ROOMS).doc(),codeRef=db.collection(CODES).doc(code);
          const outcome=await db.runTransaction(async tx=>{
            const active=await existing(tx);
            if(active)return active;
            const codeSnap=await tx.get(codeRef);
            const previous=codeSnap.exists?codeSnap.data():null;
            if(previous?.status==='active'&&Number(previous.expiresAtMs)>at)return {collision:true};
            const room={
              mode:'dungeon',version:VERSION,revision:1,status:'waiting',
              visibility:action==='quick'||req.body?.visibility==='public'?'public':'private',code,hostUid:uid,createdAtMs:at,
              expiresAtMs:at+LOBBY_TTL_MS,maxMembers:MAX_MEMBERS,
              members:{[uid]:makeMember(uid,name,at)}
            };
            tx.set(roomRef,room);
            tx.set(codeRef,{roomId:roomRef.id,status:'active',expiresAtMs:room.expiresAtMs});
            tx.set(pointerRef,{roomId:roomRef.id,updatedAtMs:at});
            return {id:roomRef.id,room};
          });
          if(!outcome.collision)return respond(outcome.id,outcome.room);
        }
        throw err('暫時無法分配房間代碼，請重試',503);
      }
      if(action==='join-code'){
        const code=safeCode(req.body?.roomCode);
        if(!code)throw err('請輸入正確的六碼房間代碼',400);
        const playerSnap=await resolveA().db.collection('users').doc(uid).get();
        if(!playerSnap.exists)throw err('玩家資料不存在',404);
        const name=safeName(playerSnap.data()?.displayName||playerSnap.data()?.name,uid);
        const codeRef=db.collection(CODES).doc(code);
        const outcome=await db.runTransaction(async tx=>{
          const codeSnap=await tx.get(codeRef);
          const record=codeSnap.exists?codeSnap.data():null;
          const roomId=safeRoomId(record?.roomId);
          if(!roomId||record.status!=='active'||Number(record.expiresAtMs)<=at)
            throw err('找不到可加入的私人副本',404);
          const roomRef=db.collection(ROOMS).doc(roomId);
          const roomSnap=await tx.get(roomRef);
          const room=roomSnap.exists?roomSnap.data():null;
          if(!validRoom(room,at)||room.code!==code)throw err('副本房間已關閉或過期',409);
          return addMember(tx,roomId,room,name);
        });
        return respond(outcome.id,outcome.room);
      }
      if(action==='join-public'){
        const roomId=safeRoomId(req.body?.roomId);
        if(!roomId)throw err('公開副本房間編號無效',400);
        const player=await resolveA().db.collection('users').doc(uid).get();
        if(!player.exists)throw err('玩家資料不存在',404);
        const name=safeName(player.data()?.displayName||player.data()?.name,uid);
        const outcome=await db.runTransaction(async tx=>{
          const snap=await tx.get(db.collection(ROOMS).doc(roomId));
          const room=snap.exists?snap.data():null;
          if(!validRoom(room,at)||room.visibility!=='public'||
              !hasMember(room,room.hostUid))throw err('公開副本隊伍已關閉招募',409);
          return addMember(tx,roomId,room,name);
        });
        return respond(outcome.id,outcome.room);
      }
      if(action==='set-visibility'){
        const roomId=safeRoomId(req.body?.roomId);
        const visibility=req.body?.visibility;
        if(!roomId||!['public','private'].includes(visibility))
          throw err('副本房間或公開狀態無效',400);
        const ref=db.collection(ROOMS).doc(roomId);
        const outcome=await db.runTransaction(async tx=>{
          const snap=await tx.get(ref);
          const room=snap.exists?snap.data():null;
          if(!room||room.hostUid!==uid||!hasMember(room,uid))
            throw err('只有房主可以調整副本招募',403);
          if(!validRoom(room,at))throw err('副本已開始、關閉或過期',409);
          if(room.visibility===visibility)return room;
          const update={...room,visibility,revision:room.revision+1};
          tx.update(ref,{visibility,revision:update.revision});
          return update;
        });
        return respond(roomId,outcome);
      }
      if(action==='reconnect'){
        const outcome=await db.runTransaction(existing);
        return respond(outcome?.id,outcome?.room);
      }
      const roomId=safeRoomId(req.body?.roomId);
      if(!roomId)throw err('副本房間編號無效',400);
      const roomRef=db.collection(ROOMS).doc(roomId);
      if(action==='get'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        const room=snap.data();
        if(!hasMember(room,uid))throw err('你不是此副本的隊員',403);
        if(!validRoom(room,at))throw err('副本房間已關閉或過期',410);
        return respond(roomId,room);
      }
      if(action==='leave'){
        const outcome=await db.runTransaction(async tx=>{
          const roomSnap=await tx.get(roomRef);
          const pointerSnap=await tx.get(pointerRef);
          const room=roomSnap.exists?roomSnap.data():null;
          const pointerRoom=pointerSnap.exists?pointerSnap.data()?.roomId:null;
          if(!room||!hasMember(room,uid)||pointerRoom!==roomId){
            if(!pointerRoom)return null; // idempotent retry after leaving
            throw err('你不是此副本的隊員',403);
          }
          if(room.status!=='waiting')throw err('目前無法離開已開始的副本',409);
          const members={...membersOf(room)};
          delete members[uid];
          const remaining=Object.values(members).sort((a,b)=>a.joinedAtMs-b.joinedAtMs||a.uid.localeCompare(b.uid));
          const closed=!remaining.length;
          const hostUid=room.hostUid===uid?(remaining[0]?.uid||null):room.hostUid;
          const updated={...room,revision:room.revision+1,
            status:closed?'closed':'waiting',hostUid,members,
            ...(closed?{closedAtMs:at}:{})};
          const codeRef=db.collection(CODES).doc(room.code);
          const codeSnap=closed?await tx.get(codeRef):null; // read before writes
          tx.update(roomRef,{revision:updated.revision,status:updated.status,
            hostUid,members,...(closed?{closedAtMs:at}:{})});
          tx.set(pointerRef,{roomId:null,updatedAtMs:at});
          if(closed&&codeSnap?.exists&&codeSnap.data()?.roomId===roomId)
            tx.set(codeRef,{roomId,status:'closed',expiresAtMs:room.expiresAtMs});
          return {id:roomId,room:updated};
        });
        return respond(outcome?.id,outcome?.room);
      }
    }catch(error){
      const status=error?.status||503;
      if(status>=500)logger.error('[Dungeon room]',action,error?.message||error);
      return res.status(status).json({ok:false,error:status>=500?'副本房間暫時無法使用':error.message});
    }
  };
}
function registerDungeonRoomApi(app){app.post('/api/dungeon/room',createHandler());}
module.exports=registerDungeonRoomApi;
module.exports.__test={ROOMS,CODES,MEMBERSHIPS,VERSION,MAX_MEMBERS,LOBBY_TTL_MS,
  safeRoomId,safeCode,validRoom,hasMember,publicRoom,recruitmentCard,listPublicRooms,createHandler};
