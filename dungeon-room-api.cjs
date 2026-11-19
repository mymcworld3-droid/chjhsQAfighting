'use strict';

// Multiplayer dungeon lobby only. No raid ticket, quiz, combat, or reward logic
// belongs here: those systems have separate authoritative state machines.
const crypto = require('node:crypto');
const { playerRepository, raidRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');
const {streamDungeonRoom} = require('./dungeon-room-stream.cjs');
const {LAYOUT_VERSION,generateDungeonLayout} = require('./dungeon-map-generator.cjs');
const {roomMap,startExplorationMembers,moveOnMap} = require('./dungeon-movement.cjs');
const {initialClock,advanceClock,projectClock} = require('./dungeon-battle-clock.cjs');
const trainingAccess = require('./public/cultivation/training-access-rules.js');

const ROOMS='dungeonRooms';
const CODES='dungeonRoomCodes';
const MEMBERSHIPS='dungeonRoomMemberships';
const VERSION=1;
const MAX_MEMBERS=4;
const PUBLIC_SCAN_LIMIT=120;
const PUBLIC_RESULT_LIMIT=24;
const LOBBY_TTL_MS=2*60*60*1000;
const HEARTBEAT_MIN_MS=12000;
const PRESENCE_STALE_MS=60000;
const RENEW_IF_LESS_THAN_MS=30*60*1000;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const err=(message,status=409)=>Object.assign(new Error(message),{status});
const safeRoomId=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''))?String(value):'';
const safeCode=value=>/^[A-HJ-NP-Z2-9]{6}$/.test(String(value||'').trim().toUpperCase())?String(value).trim().toUpperCase():'';
const makeCode=()=>Array.from({length:6},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const validRoom=(room,at)=>room?.mode==='dungeon'&&room.version===VERSION&&
  room.status==='waiting'&&Number(room.expiresAtMs)>at;
const sessionRoom=(room,at)=>validRoom(room,at)||
  (room?.mode==='dungeon'&&room.version===VERSION&&room.status==='assembled'&&
    Number(room.expiresAtMs)>at);
const membersOf=room=>room?.members&&typeof room.members==='object'&&!Array.isArray(room.members)?room.members:{};
const hasMember=(room,uid)=>Object.prototype.hasOwnProperty.call(membersOf(room),uid);
const memberOnline=(member,at)=>Number(member?.heartbeatAtMs)>0 &&
  Math.max(0,at-Number(member.heartbeatAtMs))<=PRESENCE_STALE_MS;
const publicRoom=(roomId,room,at=Date.now())=>({
  id:roomId,mode:'dungeon',version:room.version,revision:room.revision,
  status:room.status,visibility:room.visibility==='public'?'public':'private',code:room.code,
  hostUid:room.hostUid,createdAtMs:room.createdAtMs,
  assembledAtMs:room.assembledAtMs||0,
  expiresAtMs:room.expiresAtMs,maxMembers:MAX_MEMBERS,
  battleClock:projectClock(room,at),
  members:Object.fromEntries(Object.entries(membersOf(room)).map(([id,member])=>
    [id,{...member,online:memberOnline(member,at)}]))
});
const safeName=(value,uid)=>{
  const name=String(value||'').trim().slice(0,32);
  return name||('修士'+String(uid).slice(0,8));
};
const REALM_TIERS=Object.freeze([
  [1868,'渡劫'],[1268,'大乘'],[788,'合體'],[428,'煉虛'],
  [188,'化神'],[68,'元嬰'],[28,'金丹'],[6,'築基'],[0,'凡人']
]);
const makeMember=(uid,name,at,player={})=>{
  const score=trainingAccess.score(player);
  const realm=REALM_TIERS.find(([threshold])=>score>=threshold)?.[1]||'凡人';
  return {uid,name,joinedAtMs:at,ready:false,realm,accessScore:score,heartbeatAtMs:at};
};
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
  seedFactory=()=>crypto.randomBytes(12).toString('hex'),
  logger=console
}={}){
  return async function dungeonRoomHandler(req,res){
    res.set?.('Cache-Control','no-store');
    const action=String(req.body?.action||'');
    try{
      if(!['create','join-code','join-public','list-public','quick','set-visibility','get','reconnect','leave','ready','kick','disband','start','cancel-start','subscribe','heartbeat','get-map','move','clock'].includes(action))
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
        return sessionRoom(room,at)&&hasMember(room,uid)?{id:pointed,room}:null;
      };
      const respond=(roomId,room)=>res.json({ok:true,roomId:roomId||null,room:room?publicRoom(roomId,room,at):null});
      const addMember=async(tx,roomId,room,name,player,{reuseExisting=false}={})=>{
        const current=await existing(tx);
        if(current&&current.id!==roomId){
          if(reuseExisting)return current;
          throw err('請先離開目前的副本隊伍',409);
        }
        if(hasMember(room,uid))return {id:roomId,room};
        const members=membersOf(room);
        if(Object.keys(members).length>=MAX_MEMBERS)throw err('副本隊伍已滿四人',409);
        const updated={...room,revision:room.revision+1,
          members:{...members,[uid]:makeMember(uid,name,at,player)}};
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
              return addMember(tx,card.roomId,room,name,user.data(),{reuseExisting:true});
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
          const mapSeed=seedFactory();
          if(typeof mapSeed!=='string'||!(/^[a-f0-9]{24}$/i).test(mapSeed))
            throw err('副本地圖種子碼產生失敗',503);
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
              mapVersion:LAYOUT_VERSION,mapSeed,
              members:{[uid]:makeMember(uid,name,at,playerSnap.data())}
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
          return addMember(tx,roomId,room,name,playerSnap.data());
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
          return addMember(tx,roomId,room,name,player.data());
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
      // A shared Firestore cursor makes clock ticks idempotent even if all four
      // participants connect through different Render processes.
      const syncBattleClock=async()=>{
        return db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,clock()))
            throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')
            throw err('副本時鐘尚未啟動',409);
          const time=clock(),delta=advanceClock(current,time);
          if(!delta)return current;
          const next={...current,...delta,revision:current.revision+1};
          tx.update(roomRef,{...delta,revision:next.revision});
          return next;
        });
      };
      if(action==='clock'){
        const result=await syncBattleClock();
        return res.json({ok:true,roomId,clock:projectClock(result,clock())});
      }
      if(action==='get-map'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        const current=snap.data();
        if(!hasMember(current,uid))throw err('你不是此副本的隊員',403);
        if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
        // Phase 5: deterministic, read-only blueprint. Reconnects and all
        // Render instances regenerate the same map from the trusted room seed.
        // Pre-v5 waiting rooms derive a stable fallback from the room ID.
        const seed=current.mapSeed||('legacy:'+roomId);
        if(current.mapVersion!==undefined&&current.mapVersion!==LAYOUT_VERSION)
          throw err('副本地圖版本尚未支援',409);
        return res.json({ok:true,roomId,map:generateDungeonLayout(seed)});
      }
      if(action==='subscribe'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        const current=snap.data();
        if(!hasMember(current,uid))throw err('你不是此副本的隊員',403);
        if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
        return streamDungeonRoom({req,res,ref:roomRef,uid,initialRoom:current,
          project:publicRoom,isActive:room=>sessionRoom(room,clock()),clock,logger,
          onTick:syncBattleClock});
      }
      if(action==='heartbeat'){
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef);
          const current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
          const member=membersOf(current)[uid],last=Number(member.heartbeatAtMs)||0;
          const shouldTouch=last<=0||at-last>=HEARTBEAT_MIN_MS;
          const shouldRenew=Number(current.expiresAtMs)-at<RENEW_IF_LESS_THAN_MS;
          const battleDelta=advanceClock(current,at);
          if(!shouldTouch&&!shouldRenew&&!battleDelta)return current;
          const codeRef=db.collection(CODES).doc(current.code);
          const codeSnap=shouldRenew?await tx.get(codeRef):null;
          if(shouldRenew&&(!codeSnap?.exists||codeSnap.data()?.roomId!==roomId||
              codeSnap.data()?.status!=='active'))
            throw err('房間代碼已失效，請重新建立隊伍',409);
          const expiresAtMs=shouldRenew?at+LOBBY_TTL_MS:current.expiresAtMs;
          const members=shouldTouch?{...membersOf(current),
            [uid]:{...member,heartbeatAtMs:at}}:membersOf(current);
          const next={...current,members,expiresAtMs,...(battleDelta||{}),
            revision:current.revision+1};
          tx.update(roomRef,{members,expiresAtMs,...(battleDelta||{}),revision:next.revision});
          if(shouldRenew)tx.set(codeRef,{roomId,status:'active',expiresAtMs});
          return next;
        });
        // Heartbeats acknowledge the request without echoing a potentially
        // stale room: the snapshot stream is the source of state updates.
        return res.json({ok:true,roomId,revision:updated.revision,
          heartbeatAtMs:Number(membersOf(updated)[uid]?.heartbeatAtMs)||0});
      }
      if(action==='get'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        const room=snap.data();
        if(!hasMember(room,uid))throw err('你不是此副本的隊員',403);
        if(!sessionRoom(room,at))throw err('副本房間已關閉或過期',410);
        return respond(roomId,room);
      }
      if(action==='move'){
        // Movement is server-authoritative and sequential per authenticated
        // player. The client never sends a destination, stamina or position.
        const {dx,dy,step}=req.body||{};
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))
            throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')
            throw err('請先完成全隊集結',409);
          const map=roomMap(current,roomId);
          const outcome=moveOnMap(current,uid,map,{dx,dy,step});
          if(outcome.duplicate)return current;
          const battleDelta=advanceClock(current,at);
          const next={...current,members:outcome.members,...(battleDelta||{}),
            revision:current.revision+1};
          tx.update(roomRef,{members:next.members,...(battleDelta||{}),
            revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='ready'){
        if(typeof req.body?.ready!=='boolean')throw err('準備狀態無效',400);
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),room=snap.exists?snap.data():null;
          if(!room||!hasMember(room,uid))throw err('你不是此副本的隊員',403);
          if(!validRoom(room,at))throw err('隊伍目前不能調整準備狀態',409);
          const members=membersOf(room);
          if(members[uid].ready===req.body.ready)return room;
          const next={...room,revision:room.revision+1,members:{
            ...members,[uid]:{...members[uid],ready:req.body.ready}
          }};
          tx.update(roomRef,{revision:next.revision,members:next.members});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='start'||action==='cancel-start'){
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),room=snap.exists?snap.data():null;
          if(!room||!hasMember(room,uid)||room.hostUid!==uid)
            throw err('只有隊長能決定副本出發',403);
          if(!sessionRoom(room,at))throw err('隊伍已關閉或過期',409);
          if(action==='start'){
            if(room.status==='assembled')return room;
            if(!validRoom(room,at))throw err('隊伍目前無法出發',409);
            const members=Object.values(membersOf(room));
            if(!members.length||members.some(m=>m.ready!==true))
              throw err('請先等待所有隊員準備完成',409);
            // Spawn positions/energy are committed atomically before anyone
            // can move. Cross-instance clients see one authoritative snapshot.
            const map=roomMap(room,roomId);
            const startingMembers=startExplorationMembers(room,map);
            const clockState=initialClock(at);
            const next={...room,status:'assembled',assembledAtMs:at,
              ...clockState,members:startingMembers,revision:room.revision+1};
            tx.update(roomRef,{status:next.status,assembledAtMs:at,
              ...clockState,members:startingMembers,revision:next.revision});
            return next;
          }
          if(room.status==='waiting')return room;
          if(room.status!=='assembled')throw err('隊伍尚未集結',409);
          if(Object.values(membersOf(room)).some(m=>(m.moveSeq||0)>0))
            throw err('隊伍已開始探索，不能取消集結；可離開隊伍結束本次探索',409);
          const members=Object.fromEntries(Object.entries(membersOf(room))
            .map(([key,m])=>[key,{...m,ready:false}]));
          const clockState={battleClockVersion:null,battleStartedAtMs:null,
            battleAppliedTick:0,battleAppliedAtMs:null,assembledAtMs:null};
          const next={...room,status:'waiting',...clockState,members,
            revision:room.revision+1};
          tx.update(roomRef,{status:'waiting',...clockState,members,
            revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='kick'){
        const targetUid=String(req.body?.targetUid||'');
        if(!targetUid||targetUid.length>160||targetUid.includes('/')||/[\x00-\x1f]/.test(targetUid)||targetUid===uid)
          throw err('踢出對象無效',400);
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),room=snap.exists?snap.data():null;
          if(!room||!hasMember(room,uid)||room.hostUid!==uid)
            throw err('只有隊長可以移除隊員',403);
          if(!validRoom(room,at))throw err('隊伍出發後無法移除隊員',409);
          if(!hasMember(room,targetUid))throw err('此玩家已不在隊伍中',404);
          const targetRef=db.collection(MEMBERSHIPS).doc(targetUid);
          const targetSnap=await tx.get(targetRef);
          const members={...membersOf(room)};
          delete members[targetUid];
          const next={...room,members,revision:room.revision+1};
          tx.update(roomRef,{members,revision:next.revision});
          if(targetSnap.exists&&targetSnap.data()?.roomId===roomId)
            tx.set(targetRef,{roomId:null,updatedAtMs:at});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='disband'){
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),room=snap.exists?snap.data():null;
          if(!room||!hasMember(room,uid)||room.hostUid!==uid)
            throw err('只有隊長可以解散隊伍',403);
          if(!sessionRoom(room,at))throw err('隊伍已關閉或過期',409);
          const members=Object.keys(membersOf(room));
          const refs=members.map(member=>db.collection(MEMBERSHIPS).doc(member));
          const snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
          const codeRef=db.collection(CODES).doc(room.code);
          const codeSnap=await tx.get(codeRef);
          const next={...room,status:'closed',closedAtMs:at,revision:room.revision+1};
          tx.update(roomRef,{status:'closed',closedAtMs:at,revision:next.revision});
          refs.forEach((ref,index)=>{
            if(snaps[index].exists&&snaps[index].data()?.roomId===roomId)
              tx.set(ref,{roomId:null,updatedAtMs:at});
          });
          if(codeSnap.exists&&codeSnap.data()?.roomId===roomId)
            tx.set(codeRef,{roomId,status:'closed',expiresAtMs:room.expiresAtMs});
          return next;
        });
        return respond(roomId,updated);
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
          if(!['waiting','assembled'].includes(room.status))throw err('目前無法離開進行中的副本',409);
          const members={...membersOf(room)};
          delete members[uid];
          const remaining=Object.values(members).sort((a,b)=>a.joinedAtMs-b.joinedAtMs||a.uid.localeCompare(b.uid));
          const closed=!remaining.length;
          const hostUid=room.hostUid===uid?(remaining[0]?.uid||null):room.hostUid;
          if(room.status==='assembled')for(const member of Object.values(members))member.ready=false;
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
  safeRoomId,safeCode,validRoom,sessionRoom,hasMember,memberOnline,publicRoom,recruitmentCard,listPublicRooms,makeMember,createHandler,
  HEARTBEAT_MIN_MS,PRESENCE_STALE_MS,RENEW_IF_LESS_THAN_MS};
