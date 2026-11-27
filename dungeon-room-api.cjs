'use strict';

// Multiplayer dungeon lobby only. No raid ticket, quiz, combat, or reward logic
// belongs here: those systems have separate authoritative state machines.
const crypto = require('node:crypto');
const { playerRepository, raidRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');
const {streamDungeonRoom} = require('./dungeon-room-stream.cjs');
const {LAYOUT_VERSION,CURRENT_LAYOUT_VERSION,supportedVersion} = require('./dungeon-map-generator.cjs');
const {roomMap,startExplorationMembers,moveOnMap,moveRouteOnMap} = require('./dungeon-movement.cjs');
const {trustedRaidPlayerSnapshot}=require('./raid-authority.cjs');
const {initialClock,projectClock} = require('./dungeon-battle-clock.cjs');
const {initialEnemies,advanceWorld,ENEMY_AI_VERSION} = require('./dungeon-enemy-ai.cjs');
const {pendingPublic} = require('./dungeon-enemy-combat.cjs');
const {strikeEnemy,recordedMax}=require('./dungeon-player-combat.cjs');
const Skills=require('./dungeon-skill-combat.cjs');
const QuizCredit=require('./dungeon-quiz-credit.cjs');
const QuizErrorRefund=require('./dungeon-quiz-error-refund.cjs');
const {staminaFor,clampStamina}=require('./dungeon-stamina-rules.cjs');
const Objectives=require('./dungeon-objectives.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const Portal=require('./dungeon-portal-readiness.cjs');
const Rescue=require('./dungeon-team-rescue.cjs');
const Victory=require('./dungeon-victory-reward.cjs');
const ManualProgress=require('./dungeon-manual-progression.cjs');
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
const publicRoom=(roomId,room,at=Date.now(),viewerUid='')=>({
  id:roomId,mode:'dungeon',version:room.version,revision:room.revision,
  status:room.status,mapVersion:room.mapVersion??LAYOUT_VERSION,
  visibility:room.visibility==='public'?'public':'private',code:room.code,
  hostUid:room.hostUid,createdAtMs:room.createdAtMs,
  assembledAtMs:room.assembledAtMs||0,
  // Only reveal this player's trusted server kill ledger to their client.
  // The cumulative totals let an SSE skip multiple revisions without
  // losing XP animations; other teammates' mastery stays private.
  ...(viewerUid&&hasMember(room,viewerUid)?{
    manualProgressSession:room.manualProgressSession||room.assembledAtMs||0,
    manualExp:{[viewerUid]:room.manualExp?.[viewerUid]||{}}
  }:{}),
  expiresAtMs:room.expiresAtMs,maxMembers:MAX_MEMBERS,
  battleClock:projectClock(room,at),
  dungeonProgress:Objectives.publicProgress(room.dungeonProgress),
  dungeonArena:room.dungeonArena==='boss'?'boss':'exploration',
  bossEncounter:Boss.publicEncounter(room.bossEncounter),
  bossPortalReady:Portal.validRoom(room)?
    Portal.project(room,roomMap(room,roomId),at):null,
  enemyAiVersion:room.enemyAiVersion||null,
  // Presentational snapshots expose only the current NPC action state,
  // never the secret map seed or server-side patrol/decision internals.
  ...(room.weaponObjects?{weaponObjects:room.weaponObjects}:{}),
  enemies:Array.isArray(room.enemies)?room.enemies.map(e=>({
    id:e.id,name:e.name,kind:e.kind,position:e.position,
    realm:e.realm||ManualProgress.REALM,
    realmStage:e.realmStage||ManualProgress.STAGE,
    ...(e.kind==='boss'?{footprint:2,phase:Boss.phase(e.battleHealth,recordedMax(e)),
      shield:Math.max(0,Number(e.shield)||0),shieldMax:Boss.SHIELD_MAX,
      exposedUntilTick:e.exposedUntilTick||0,
      lastTeamHit:e.lastTeamHit||null}:{}),
    intent:e.intent,targetUid:e.targetUid||null,
    lastActionTick:e.lastActionTick,cadence:e.cadence,
    battleHealth:Number.isSafeInteger(e.battleHealth)?e.battleHealth:recordedMax(e),
    battleMaxHealth:recordedMax(e),
    attack:pendingPublic(e.attack),
    lastAttack:e.lastAttack?{
      tick:e.lastAttack.tick,kind:e.lastAttack.kind,
      label:e.lastAttack.label,damage:e.lastAttack.damage,
      cells:e.lastAttack.cells,hits:e.lastAttack.hits
    }:null
  })):[],
  members:Object.fromEntries(Object.entries(membersOf(room)).map(([id,member])=>
    [id,{...member,
      ...(room.status==='assembled'?{explorationStamina:staminaFor(member)}:{}),
      online:memberOnline(member,at)}]))
});
const safeName=(value,uid)=>{
  const name=String(value||'').trim().slice(0,32);
  return name||('修士'+String(uid).slice(0,8));
};
const REALM_TIERS=Object.freeze([
  [1868,'渡劫'],[1268,'大乘'],[788,'合體'],[428,'煉虛'],
  [188,'化神'],[68,'元嬰'],[28,'金丹'],[6,'築基'],[0,'凡人']
]);
const dungeonTrialVitals=(player,uid)=>{
  // Identical trusted HP calculation and artifact exclusion as tactical PvE.
  const user={...player,artifactSystem:{...(player?.artifactSystem||{}),equipped:{}}};
  const trusted=trustedRaidPlayerSnapshot(user,uid,{});
  return {battleMaxHealth:trusted.maxHp,battleAttack:trusted.atk};
};
const makeMember=(uid,name,at,player={})=>{
  const score=trainingAccess.score(player);
  const realm=REALM_TIERS.find(([threshold])=>score>=threshold)?.[1]||'凡人';
  return {uid,name,joinedAtMs:at,ready:false,realm,accessScore:score,
    dungeonAdmin:player?.isAdmin===true,heartbeatAtMs:at};
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
      if(!['create','join-code','join-public','list-public','quick','set-visibility','get','reconnect','leave','ready','kick','disband','start','cancel-start','subscribe','heartbeat','get-map','move','move-route','strike','skill','loadout','quiz-credit','quiz-error-refund','activate-portal','enter-boss','boss-ready','boss-guard','rescue','claim-boss-reward','claim-manual-exp','recent-victories','clock'].includes(action))
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
      const respond=(roomId,room)=>res.json({ok:true,roomId:roomId||null,room:room?publicRoom(roomId,room,at,uid):null});
      // A member may already be exploring when this version is deployed or
      // may gain/lose administrator permissions while a room stays active.
      // Revalidate the Firebase A flag on reconnect/get/stream-open, then
      // publish one C revision. Regular movement incurs no extra A read.
      const refreshAdmin=async(roomId,room)=>{
        if(!room||!hasMember(room,uid)||!sessionRoom(room,at))return room;
        const user=await resolveA().db.collection('users').doc(uid).get();
        const privileged=user.exists&&user.data()?.isAdmin===true;
        const member=membersOf(room)[uid];
        const migration=room.status==='assembled'&&user.exists&&
          (!Number.isSafeInteger(member.battleMaxHealth)||
           member.battleMaxHealth===100)?
          dungeonTrialVitals(user.data(),uid):null;
        const needVitals=Boolean(migration&&migration.battleMaxHealth!==
          (member.battleMaxHealth||100));
        if(member.dungeonAdmin===privileged&&
            (!privileged||member.explorationStamina===10)&&!needVitals)
          return room;
        const ref=db.collection(ROOMS).doc(roomId);
        return db.runTransaction(async tx=>{
          const snap=await tx.get(ref),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid)||!sessionRoom(current,at))return current;
          const existing=membersOf(current)[uid];
          const vitals=migration&&
            (!Number.isSafeInteger(existing.battleMaxHealth)||
              existing.battleMaxHealth===100)&&
            migration.battleMaxHealth!==(existing.battleMaxHealth||100)?
            migration:null;
          if(existing.dungeonAdmin===privileged&&
              (!privileged||existing.explorationStamina===10)&&!vitals)
            return current;
          const previousMax=Math.max(1,existing.battleMaxHealth||100);
          const previousHp=Math.max(0,Math.min(previousMax,
            existing.battleHealth??previousMax));
          const nextMember={...existing,dungeonAdmin:privileged,
            explorationStamina:privileged?10:clampStamina(existing.explorationStamina),
            ...(vitals?{...vitals,battleHealth:Math.round(
              previousHp/previousMax*vitals.battleMaxHealth)}:{})};
          const members={...current.members,[uid]:nextMember};
          const revision=current.revision+1;
          tx.update(ref,{members,revision});
          return {...current,members,revision};
        });
      };
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
              mapVersion:CURRENT_LAYOUT_VERSION,mapSeed,
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
        const room=outcome?.room?await refreshAdmin(outcome.id,outcome.room):null;
        return respond(outcome?.id,room);
      }
      if(action==='recent-victories'){
        // Read-only personal victory discovery. Does not require an active
        // room or a still-connected party, and never exposes the full archive.
        const rewards=await Victory.recent(resolveA().db,db,uid);
        return res.json({ok:true,rewards});
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
          const time=clock(),delta=advanceWorld(current,roomMap(current,roomId),time);
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
        if(!supportedVersion(current.mapVersion??LAYOUT_VERSION))
          throw err('副本地圖版本尚未支援',409);
        return res.json({ok:true,roomId,map:roomMap(current,roomId)});
      }
      if(action==='subscribe'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        let current=snap.data();
        if(!hasMember(current,uid))throw err('你不是此副本的隊員',403);
        if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
        current=await refreshAdmin(roomId,current);
        return streamDungeonRoom({req,res,ref:roomRef,uid,initialRoom:current,
          project:(id,room,at)=>publicRoom(id,room,at,uid),
          isActive:room=>sessionRoom(room,clock()),clock,logger,
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
          const battleDelta=current.status==='assembled'?
            advanceWorld(current,roomMap(current,roomId),at):null;
          if(!shouldTouch&&!shouldRenew&&!battleDelta)return current;
          const codeRef=db.collection(CODES).doc(current.code);
          const codeSnap=shouldRenew?await tx.get(codeRef):null;
          if(shouldRenew&&(!codeSnap?.exists||codeSnap.data()?.roomId!==roomId||
              codeSnap.data()?.status!=='active'))
            throw err('房間代碼已失效，請重新建立隊伍',409);
          const expiresAtMs=shouldRenew?at+LOBBY_TTL_MS:current.expiresAtMs;
          // Merge health changes BEFORE writing heartbeat: otherwise the
          // stale member copy could overwrite a committed hit or timestamp.
          const evolved=battleDelta?.members||membersOf(current);
          const members=shouldTouch?{...evolved,
            [uid]:{...evolved[uid],heartbeatAtMs:at}}:evolved;
          const {members:_damageMembers,...world}=battleDelta||{};
          const next={...current,...world,members,expiresAtMs,
            revision:current.revision+1};
          tx.update(roomRef,{...world,members,expiresAtMs,revision:next.revision});
          if(shouldRenew)tx.set(codeRef,{roomId,status:'active',expiresAtMs});
          return next;
        });
        // Heartbeats acknowledge the request without echoing a potentially
        // stale room: the snapshot stream is the source of state updates.
        return res.json({ok:true,roomId,revision:updated.revision,
          heartbeatAtMs:Number(membersOf(updated)[uid]?.heartbeatAtMs)||0});
      }
      if(action==='claim-manual-exp'){
        // A receipt may need recovery after a disconnect, a closed lobby,
        // or a failed cross-project request. Only C's server-owned ledger
        // for this authenticated UID is accepted as evidence.
        const snap=await roomRef.get();
        const archived=snap.exists?null:
          await db.collection(Victory.ARCHIVES).doc(roomId).get();
        const room=snap.exists?snap.data():
          archived?.exists?archived.data():null;
        if(!room)throw err('找不到副本經驗紀錄',404);
        const result=await ManualProgress.claim(resolveA().db,roomId,room,uid);
        return res.json({ok:true,roomId,manualProgress:result});
      }
      if(action==='get'){
        const snap=await roomRef.get();
        if(!snap.exists)throw err('副本房間不存在',404);
        const room=snap.data();
        if(!hasMember(room,uid))throw err('你不是此副本的隊員',403);
        if(!sessionRoom(room,at))throw err('副本房間已關閉或過期',410);
        if(room.manualExp?.[uid]){
          try{await ManualProgress.claim(resolveA().db,roomId,room,uid);}
          catch(error){logger.warn?.('[Dungeon manual XP retry]',error.message);}
        }
        return respond(roomId,await refreshAdmin(roomId,room));
      }
      if(action==='move'||action==='move-route'){
        // Both tap-to-walk and one-step keyboard movement use the same
        // per-tile server validation. Route paths are bounded and atomic.
        // No client-selected destination, stamina or collision is trusted.
        const {dx,dy,step,vectors}=req.body||{};
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))
            throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')
            throw err('請先完成全隊集結',409);
          const map=roomMap(current,roomId);
          // Settle due server ticks (including earned passive stamina) BEFORE
          // checking the movement cost; otherwise a zero-stamina member could
          // remain stuck when their SSE briefly disconnects.
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const outcome=action==='move-route'?
            moveRouteOnMap(evolved,uid,map,{vectors,step}):
            moveOnMap(evolved,uid,map,{dx,dy,step});
          if(outcome.duplicate&&!battleDelta)return current;
          const next={...evolved,members:outcome.members,revision:current.revision+1};
          tx.update(roomRef,{...(battleDelta||{}),members:next.members,
            revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='strike'){
        // Firestore transaction serializes both players' hits against one NPC.
        const {enemyId,seq}=req.body||{};
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')throw err('請先完成全隊集結',409);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const outcome=strikeEnemy(evolved,uid,map,{enemyId,seq});
          if(outcome.duplicate&&!battleDelta)return current;
          const progress=outcome.duplicate?evolved.dungeonProgress:
            Objectives.combatProgress(evolved,outcome.enemies,uid);
          const bossEncounter=outcome.duplicate?evolved.bossEncounter:
            Boss.onDefeat(evolved,outcome.enemies,uid);
          const next={...evolved,members:outcome.members,enemies:outcome.enemies,
            ...(progress?{dungeonProgress:progress}:{}),
            ...(bossEncounter?{bossEncounter}:{}),
            revision:current.revision+1};
          const saveVictory=evolved.bossEncounter?.status==='fighting'&&
            bossEncounter?.status==='defeated'?
            await Victory.prepareArchive(tx,db,roomId,next,at):null;
          tx.update(roomRef,{...(battleDelta||{}),members:next.members,
            enemies:next.enemies,
            ...(progress!==evolved.dungeonProgress?{dungeonProgress:progress}:{}),
            ...(bossEncounter!==evolved.bossEncounter?{bossEncounter}:{}),
            revision:next.revision});
          saveVictory?.();
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='skill'||action==='loadout'){
        // Manuscript progress belongs to Firebase A (playerRepository),
        // while cooperative room state belongs to Firebase C. These cannot
        // participate in one cross-database transaction: read the trusted A
        // snapshot first, then atomically authorize/calculate the room in C.
        const manualSnap=await resolveA().db.collection('tacticalManuals').doc(uid).get();
        const record=manualSnap.exists?manualSnap.data():null;
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')throw err('請先完成全隊集結',409);
          // Client-side skill lists, upgrades and combat stats are never trusted.
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const outcome=action==='skill'?
            Skills.castSkill(evolved,uid,map,record,{
              skillId:req.body?.skillId,target:req.body?.target,seq:req.body?.seq,
              moveSword:req.body?.moveSword===true,first:req.body?.first??null
            }):Skills.switchLoadout(evolved,uid,record,req.body?.index);
          if(outcome.duplicate&&!battleDelta)return current;
          const mastery=action==='skill'&&!outcome.duplicate?
            ManualProgress.recordKills(evolved,outcome,uid,req.body?.skillId):null;
          if(mastery?.award){
            outcome.members={...outcome.members,[uid]:{
              ...outcome.members[uid],
              lastSkill:{...outcome.members[uid].lastSkill,
                manualMastery:mastery.award}
            }};
          }
          const progress=action==='skill'&&!outcome.duplicate?
            Objectives.combatProgress(evolved,outcome.enemies,uid):
            evolved.dungeonProgress;
          const bossEncounter=action==='skill'&&!outcome.duplicate?
            Boss.onDefeat(evolved,outcome.enemies,uid):evolved.bossEncounter;
          const next={...evolved,members:outcome.members,
            ...(outcome.weaponObjects?{weaponObjects:outcome.weaponObjects}:{}),
            ...(mastery?{
              manualExp:mastery.ledger,
              // Mid-session migration: retain the original session even if
              // an older room is later disbanded and clears assembledAtMs.
              manualProgressSession:evolved.manualProgressSession||
                evolved.assembledAtMs
            }:{}),
            ...(action==='skill'?{enemies:outcome.enemies}:{}),
            ...(progress?{dungeonProgress:progress}:{}),
            ...(bossEncounter?{bossEncounter}:{}),
            revision:current.revision+1};
          const saveVictory=action==='skill'&&
            evolved.bossEncounter?.status==='fighting'&&
            bossEncounter?.status==='defeated'?
            await Victory.prepareArchive(tx,db,roomId,next,at):null;
          tx.update(roomRef,{...(battleDelta||{}),members:next.members,
            ...(outcome.weaponObjects?{weaponObjects:next.weaponObjects}:{}),
            ...(mastery?{manualExp:next.manualExp,
              manualProgressSession:next.manualProgressSession}:{}),
            ...(action==='skill'?{enemies:next.enemies}:{}),
            ...(progress!==evolved.dungeonProgress?{dungeonProgress:progress}:{}),
            ...(bossEncounter!==evolved.bossEncounter?{bossEncounter}:{}),
            revision:next.revision});
          saveVictory?.();
          return next;
        });
        if(action==='skill'&&updated.manualExp?.[uid]){
          try{await ManualProgress.claim(resolveA().db,roomId,updated,uid);}
          catch(error){logger.warn?.('[Dungeon manual XP pending retry]',error.message);}
        }
        return respond(roomId,updated);
      }
      if(action==='activate-portal'){
        // Only the shared C room can open the key portal, even if two
        // teammates request it simultaneously on different Node instances.
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')throw err('請先完成集結',409);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const result=Objectives.activate(evolved,uid,map);
          if(result.duplicate&&!battleDelta)return current;
          const next={...evolved,dungeonProgress:result.progress,
            revision:current.revision+1};
          tx.update(roomRef,{...(battleDelta||{}),
            dungeonProgress:result.progress,revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='enter-boss'||action==='boss-ready'){
        // Legacy "enter-boss" is only a YES vote, never a one-player
        // shortcut. All votes and the world transition serialize on C.
        const ready=action==='enter-boss'?true:req.body?.ready;
        if(typeof ready!=='boolean')throw err('請傳入正確的首領準備狀態',400);
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本房間已關閉或過期',410);
          if(current.status!=='assembled')throw err('副本尚未出發',409);
          if(current.dungeonArena==='boss'&&current.bossEncounter?.version===Boss.VERSION){
            if(ready)return current; // safe retry after transition
            throw err('全隊已進入首領戰，不能再取消準備',409);
          }
          const map=roomMap(current,roomId);
          const delta=advanceWorld(current,map,at);
          const evolved={...current,...(delta||{})};
          const outcome=Portal.vote(evolved,uid,map,at,ready,roomId);
          if(!outcome.changed&&!delta)return current;
          const next={...outcome.room,revision:current.revision+1};
          tx.update(roomRef,{
            ...(delta||{}),members:next.members,
            bossPortalReady:next.bossPortalReady,
            ...(outcome.transitioned?{
              dungeonArena:'boss',bossEncounter:next.bossEncounter,
              enemies:next.enemies,battleAppliedTick:next.battleAppliedTick,
              battleAppliedAtMs:next.battleAppliedAtMs
            }:{}),
            revision:next.revision
          });
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='quiz-credit'){
        // The graded receipt belongs to Firebase A. Never accept a claimed
        // correctness, reward, or signed-looking payload from the browser.
        const questionId=req.body?.questionId;
        const snapA=await resolveA().db.collection('dungeonQuizStates').doc(uid).get();
        const graded=snapA.exists?snapA.data():null;
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本已結束或房間已過期',410);
          if(current.status!=='assembled')throw err('副本尚未開始',409);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const result=QuizCredit.credit(evolved,uid,graded,questionId,roomId);
          if(result.duplicate&&!battleDelta)return current;
          const next={...evolved,members:result.members,revision:current.revision+1};
          tx.update(roomRef,{...(battleDelta||{}),members:next.members,
            revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='quiz-error-refund'){
        // A-side approved-report proof is read only by the authenticated
        // server. The C receipt and stamina update are one transaction:
        // parallel retries from multiple devices can never pay twice.
        const questionId=req.body?.questionId;
        const snapA=await resolveA().db.collection('dungeonQuizStates').doc(uid).get();
        const report=snapA.exists?snapA.data():null;
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at)||current.status!=='assembled')
            throw err('副本已結束或房間已過期',410);
          const verified=QuizErrorRefund.calculate(current,uid,report,
            questionId,roomId);
          const receiptRef=db.collection(QuizErrorRefund.RECEIPTS)
            .doc(verified.receiptId);
          const receipt=await tx.get(receiptRef);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          if(receipt.exists&&!battleDelta)return current;
          const evolved={...current,...(battleDelta||{})};
          if(receipt.exists){
            tx.update(roomRef,{...(battleDelta||{}),
              revision:current.revision+1});
            return {...evolved,revision:current.revision+1};
          }
          const member=evolved.members[uid];
          const after=staminaFor(member);
          const granted=Math.min(QuizCredit.MAX_STAMINA-after,
            verified.nominal);
          const refunded=Array.isArray(member.quizErrorRefunds)?
            member.quizErrorRefunds.filter(id=>typeof id==='string'):[];
          const members={...evolved.members,[uid]:{...member,
            explorationStamina:after+granted,
            quizErrorRefunds:[...refunded.filter(id=>id!==questionId),
              questionId].slice(-128),
            lastQuizErrorRefund:{questionId,
              granted,nominal:verified.nominal}}};
          tx.set(receiptRef,{uid,roomId,
            session:verified.session,questionId,
            granted,nominal:verified.nominal,createdAtMs:at});
          tx.update(roomRef,{...(battleDelta||{}),
            members,revision:current.revision+1});
          return {...evolved,members,revision:current.revision+1};
        });
        return respond(roomId,updated);
      }
      if(action==='boss-guard'){
        // Guard strength, range, duration, cost and the next action sequence
        // are all verified in the server-owned C-room transaction.
        const {targetUid,seq}=req.body||{};
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本已結束或房間已過期',410);
          if(current.status!=='assembled')throw err('副本尚未開始',409);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const out=Boss.guard(evolved,uid,map,{targetUid,seq});
          if(out.duplicate&&!battleDelta)return current;
          const next={...evolved,members:out.members,revision:current.revision+1};
          tx.update(roomRef,{...(battleDelta||{}),members:next.members,
            revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='rescue'){
        // Rescue is a single C transaction, including any pending attacks.
        const {targetUid,seq}=req.body||{};
        const updated=await db.runTransaction(async tx=>{
          const snap=await tx.get(roomRef),current=snap.exists?snap.data():null;
          if(!current||!hasMember(current,uid))
            throw err('你不是此副本的隊員',403);
          if(!sessionRoom(current,at))throw err('副本已結束或房間已過期',410);
          if(current.status!=='assembled')throw err('副本尚未開始',409);
          const map=roomMap(current,roomId);
          const battleDelta=advanceWorld(current,map,at);
          const evolved={...current,...(battleDelta||{})};
          const out=Rescue.help(evolved,uid,map,{targetUid,seq});
          if(out.duplicate&&!battleDelta)return current;
          const next={...evolved,members:out.members,revision:current.revision+1};
          tx.update(roomRef,{...(battleDelta||{}),
            members:out.members,revision:next.revision});
          return next;
        });
        return respond(roomId,updated);
      }
      if(action==='claim-boss-reward'){
        // Durable C victory proof survives room closure, expiration and
        // teammates leaving. Older active rooms without an archive still
        // use the stage-16 witness during the valid session.
        const archived=await db.collection(Victory.ARCHIVES).doc(roomId).get();
        let witness;
        if(archived.exists){
          witness=archived.data();
          Victory.verifiedArchive(roomId,witness,uid);
        }else{
          const snap=await roomRef.get();
          witness=snap.exists?snap.data():null;
          if(!witness||!hasMember(witness,uid))
            throw err('找不到這位修士的副本勝利紀錄',403);
          if(!sessionRoom(witness,at))
            throw err('舊版副本已逾期，且沒有可恢復的勝利存檔',410);
        }
        try{await ManualProgress.claim(resolveA().db,roomId,witness,uid);}
        catch(error){logger.warn?.('[Dungeon archived manual XP pending]',error.message);}
        const reward=await Victory.claim(resolveA().db,roomId,witness,uid,at);
        return res.json({ok:true,roomId,reward});
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
        let manualByUid=null,rosterKey=null;
        if(action==='start'){
          const preflight=await roomRef.get(),found=preflight.exists?preflight.data():null;
          if(!found||found.hostUid!==uid||!hasMember(found,uid))
            throw err('只有隊長能決定副本出發',403);
          if(!sessionRoom(found,at))throw err('隊伍已關閉或過期',409);
          // Gather authoritative player manuscripts from A. If the roster
          // changes before C commits, the transaction refuses a stale start.
          const ids=Object.keys(membersOf(found)).sort();
          rosterKey=ids.join('|');
          const records=await Promise.all(ids.map(async id=>{
            const [manual,user]=await Promise.all([
              resolveA().db.collection('tacticalManuals').doc(id).get(),
              resolveA().db.collection('users').doc(id).get()
            ]);
            return {manual:manual.exists?manual.data():null,
              isAdmin:user.exists&&user.data()?.isAdmin===true,
              vitals:user.exists?dungeonTrialVitals(user.data(),id):null};
          }));
          manualByUid=Object.fromEntries(ids.map((id,i)=>[id,records[i]]));
        }
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
            if(Object.keys(membersOf(room)).sort().join('|')!==rosterKey)
              throw err('副本成員名單已變更，請重新開始',409);
            // Spawn positions/energy are committed atomically before anyone
            // can move. Cross-instance clients see one authoritative snapshot.
            const map=roomMap(room,roomId);
            const startingMembers=startExplorationMembers(room,map);
            // The verified A-side snapshot is installed in the committed C
            // room; neither client-side changes nor another player's inputs
            // can inject an equipped skill into the shared room.
            for(const id of Object.keys(startingMembers)){
              startingMembers[id]={...startingMembers[id],
                // Refresh A-side admin privilege at departure. A client cannot
                // grant this by setting any field in a dungeon HTTP request.
                dungeonAdmin:manualByUid[id].isAdmin,
                ...(manualByUid[id].vitals?{
                  ...manualByUid[id].vitals,
                  battleHealth:manualByUid[id].vitals.battleMaxHealth
                }:{}),
                ...Skills.initialCombatLoadout(startingMembers[id],manualByUid[id].manual)};
            }
            const clockState=initialClock(at);
            const objectives=Objectives.spawn(map,initialEnemies(map));
            const enemyState={enemyAiVersion:ENEMY_AI_VERSION,
              enemies:objectives.enemies,dungeonProgress:objectives.progress};
            const next={...room,status:'assembled',assembledAtMs:at,
              dungeonArena:'exploration',bossEncounter:null,
              bossPortalReady:{version:Portal.VERSION,votes:{}},
              ...clockState,...enemyState,members:startingMembers,
              manualProgressSession:at,manualExp:{},
              revision:room.revision+1};
            tx.update(roomRef,{status:next.status,assembledAtMs:at,
              dungeonArena:'exploration',bossEncounter:null,
              bossPortalReady:next.bossPortalReady,
              ...clockState,...enemyState,members:startingMembers,
              manualProgressSession:at,manualExp:{},
              revision:next.revision});
            return next;
          }
          if(room.status==='waiting')return room;
          if(room.status!=='assembled')throw err('隊伍尚未集結',409);
          if(room.dungeonArena==='boss'||
              room.dungeonProgress?.portalStatus==='open'||
              Object.values(membersOf(room)).some(m=>(m.moveSeq||0)>0))
            throw err('隊伍已開始探索，不能取消集結；可離開隊伍結束本次探索',409);
          const members=Object.fromEntries(Object.entries(membersOf(room))
            .map(([key,m])=>{
              const {position,explorationStamina,moveSeq,lastMove,
                battleHealth,battleMaxHealth,downed,lastDamage,
                strikeSeq,lastStrike,skillSeq,lastSkill,dungeonLoadoutIndex,
                dungeonLoadoutNames,dungeonSkillIds,dungeonSkills,dungeonAttack,
                flyingSword,focusCharges,quizCreditSeq,lastQuizCredit,
                rescueSeq,lastRescue,selfRescueCount,allyReviveCount,...previous}=m;
              return [key,{...previous,ready:false}];
            }));
          const clockState={battleClockVersion:null,battleStartedAtMs:null,
            battleAppliedTick:0,battleAppliedAtMs:null,assembledAtMs:null,
            enemyAiVersion:null,enemies:[],dungeonProgress:null,dungeonArena:null,bossEncounter:null,bossPortalReady:null};
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
          const cleared={battleClockVersion:null,battleStartedAtMs:null,
            battleAppliedTick:0,battleAppliedAtMs:null,assembledAtMs:null,
            enemyAiVersion:null,enemies:[],dungeonProgress:null,dungeonArena:null,bossEncounter:null,bossPortalReady:null};
          const next={...room,status:'closed',closedAtMs:at,...cleared,
            revision:room.revision+1};
          tx.update(roomRef,{status:'closed',closedAtMs:at,...cleared,
            revision:next.revision});
          refs.forEach((ref,index)=>{
            if(snaps[index].exists&&snaps[index].data()?.roomId===roomId)
              tx.set(ref,{roomId:null,updatedAtMs:at});
          });
          if(codeSnap.exists&&codeSnap.data()?.roomId===roomId)
            tx.set(codeRef,{roomId,status:'closed',expiresAtMs:room.expiresAtMs});
          return next;
        });
        if(updated.manualExp?.[uid]){
          try{await ManualProgress.claim(resolveA().db,roomId,updated,uid);}
          catch(error){logger.warn?.('[Dungeon disband XP retry]',error.message);}
        }
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
          // Voluntary departure must only remove that player. The surviving
          // party keeps its arena, health, enemies, position, stamina, clock,
          // objectives and boss fight. Otherwise a single player could erase
          // everyone else's progress by clicking "leave".
          // Only the LAST departure ends the run and clears transient state.
          const reset=closed&&room.status==='assembled'?{
            battleClockVersion:null,battleStartedAtMs:null,
            battleAppliedTick:0,battleAppliedAtMs:null,assembledAtMs:null,
            enemyAiVersion:null,enemies:[],dungeonProgress:null,dungeonArena:null,bossEncounter:null,bossPortalReady:null
          }:{};
          const votes={...(room.bossPortalReady?.votes||{})};
          delete votes[uid];
          const portalState=closed?null:
            room.bossPortalReady?{version:Portal.VERSION,votes}:null;
          const updated={...room,revision:room.revision+1,
            status:closed?'closed':room.status,hostUid,members,...reset,
            bossPortalReady:portalState,
            ...(closed?{closedAtMs:at}:{})};
          const codeRef=db.collection(CODES).doc(room.code);
          const codeSnap=closed?await tx.get(codeRef):null; // read before writes
          tx.update(roomRef,{revision:updated.revision,status:updated.status,
            hostUid,members,...reset,bossPortalReady:portalState,
            ...(closed?{closedAtMs:at}:{})});
          tx.set(pointerRef,{roomId:null,updatedAtMs:at});
          if(closed&&codeSnap?.exists&&codeSnap.data()?.roomId===roomId)
            tx.set(codeRef,{roomId,status:'closed',expiresAtMs:room.expiresAtMs});
          return {id:roomId,room:updated};
        });
        if(outcome?.room?.manualExp?.[uid]){
          try{await ManualProgress.claim(resolveA().db,roomId,outcome.room,uid);}
          catch(error){logger.warn?.('[Dungeon departure XP retry]',error.message);}
        }
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
