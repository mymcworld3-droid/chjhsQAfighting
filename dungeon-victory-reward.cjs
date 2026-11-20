'use strict';
// First-class permanent dungeon victory reward, separate from legacy raids.
// Read Firebase C victory proof, then issue exactly one receipt+reward in
// Firebase A. Across the two Firebases there is no fabricated atomic commit.
const crypto=require('node:crypto');
const Boss=require('./dungeon-boss-battle.cjs');
const ManualDrops=require('./manual-reward-rules.cjs');
const GOLD=120,CULTIVATION=3,RECEIPTS='dungeonVictoryClaims';
const ARCHIVES='dungeonVictoryRecords',INBOXES='dungeonVictoryInbox',MAX_RECENT=16;
const fail=(msg,status=409)=>Object.assign(new Error(msg),{status});
const amount=v=>Number.isFinite(Number(v))?
  Math.max(0,Math.floor(Number(v))):0;
const receiptId=(roomId,session,uid)=>
  crypto.createHash('sha256').update(['dungeon-victory-v1',roomId,session,uid]
    .join('\n')).digest('hex');
function validate(roomId,room,uid){
  if(typeof roomId!=='string'||!roomId||
      room?.mode!=='dungeon'||room.version!==1||
      room.status!=='assembled'||room.dungeonArena!=='boss')
    throw fail('找不到本場有效的首領勝利紀錄');
  if(!room.members||!Object.prototype.hasOwnProperty.call(room.members,uid)||
      room.members[uid]?.uid!==uid)
    throw fail('你不是這場副本的參戰隊員',403);
  const b=room.bossEncounter,p=room.dungeonProgress;
  if(b?.version!==Boss.VERSION||b.status!=='defeated'||
      p?.guardianStatus!=='defeated'||p.keyAcquired!==true||
      p.portalStatus!=='open'||(room.enemies||[]).some(e=>e.id===Boss.ID))
    throw fail('必須先真正擊敗玄炎鎮殿獸，才能領取獎勵');
  if(!Number.isSafeInteger(room.assembledAtMs)||room.assembledAtMs<=0||
      !Number.isSafeInteger(b.enteredAtTick)||b.enteredAtTick<0||
      !Number.isSafeInteger(b.defeatedAtTick)||
      b.defeatedAtTick<b.enteredAtTick||
      !Object.hasOwn(room.members,b.defeatedByUid||''))
    throw fail('首領勝利紀錄不完整，不能發放獎勵');
  return {roomId,session:roomId+':'+room.assembledAtMs,
    uid,partySize:Object.keys(room.members).length,
    defeatedAtTick:b.defeatedAtTick};
}
// Stored in Firebase C at the same moment as the boss's actual death.
// The archive deliberately contains no map seed, battle inventory, quiz
// answers, login tokens or other members' private account fields.
function makeArchive(roomId,room,at=Date.now()){
  const winner=room?.bossEncounter?.defeatedByUid;
  validate(roomId,room,winner);
  const b=room.bossEncounter;
  const record={
    recordVersion:1,roomId,archivedAtMs:at,
    mode:'dungeon',version:1,status:'assembled',
    assembledAtMs:room.assembledAtMs,dungeonArena:'boss',
    dungeonProgress:{guardianStatus:'defeated',keyAcquired:true,
      portalStatus:'open'},
    bossEncounter:{version:Boss.VERSION,status:'defeated',
      enteredAtTick:b.enteredAtTick,defeatedAtTick:b.defeatedAtTick,
      defeatedByUid:b.defeatedByUid},
    enemies:[],
    // Carry the trusted C-side kill totals into an immutable victory proof,
    // so a player can recover uncredited EXP after the room has expired.
    manualProgressSession:room.manualProgressSession||room.assembledAtMs,
    manualExp:room.manualExp||{},
    members:Object.fromEntries(Object.keys(room.members).map(uid=>
      [uid,{uid}]))
  };
  validate(roomId,record,winner);
  return record;
}
function verifiedArchive(roomId,record,uid){
  if(record?.recordVersion!==1||record.roomId!==roomId)
    throw fail('找不到可信的副本結算存檔',409);
  return validate(roomId,record,uid);
}
// Called ONLY on fighting -> defeated transition in a C room transaction.
// Collect all reads before making any writes (Firestore requirement).
async function prepareArchive(tx,db,roomId,room,at=Date.now()){
  const record=makeArchive(roomId,room,at),uids=Object.keys(record.members);
  const refs=uids.map(uid=>db.collection(INBOXES).doc(uid));
  const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
  const archiveRef=db.collection(ARCHIVES).doc(roomId);
  const rows=refs.map((ref,i)=>{
    const previous=Array.isArray(snapshots[i].exists?
      snapshots[i].data()?.recent:null)?snapshots[i].data().recent:[];
    const sanitized=previous.filter(row=>
      row&&typeof row.roomId==='string'&&
      /^[A-Za-z0-9_-]{8,160}$/.test(row.roomId)&&row.roomId!==roomId);
    return {ref,data:{version:1,uid:uids[i],
      recent:[{roomId,assembledAtMs:record.assembledAtMs,
        archivedAtMs:at},...sanitized].slice(0,MAX_RECENT)}};
  });
  return ()=>{
    tx.set(archiveRef,record);
    for(const row of rows)tx.set(row.ref,row.data);
  };
}
// Each user only sees their own recent archived victories. The archive is
// permanent; an inbox is only a bounded discovery index, not the proof.
async function recent(dbA,dbC,uid){
  const snap=await dbC.collection(INBOXES).doc(uid).get();
  const rows=snap.exists&&Array.isArray(snap.data()?.recent)?
    snap.data().recent.slice(0,MAX_RECENT):[];
  const results=[];
  for(const row of rows){
    const roomId=row?.roomId;
    if(!/^[A-Za-z0-9_-]{8,160}$/.test(String(roomId||'')))continue;
    const archive=await dbC.collection(ARCHIVES).doc(roomId).get();
    if(!archive.exists)continue;
    let proof;
    try{proof=verifiedArchive(roomId,archive.data(),uid);}
    catch(_){continue;}
    const receipt=await dbA.collection(RECEIPTS)
      .doc(receiptId(roomId,proof.session,uid)).get();
    const reward=receipt.exists?receipt.data():null;
    results.push({roomId,archivedAtMs:archive.data().archivedAtMs||0,
      defeatedAtTick:proof.defeatedAtTick,
      partySize:proof.partySize,
      claimed:receipt.exists,
      claimedAtMs:reward?.claimedAtMs||0,
      manualDrop:reward?.manualDrop||null,
      gold:GOLD,cultivation:CULTIVATION});
  }
  return results;
}
async function claim(db,roomId,room,uid,now=Date.now()){
  const proof=validate(roomId,room,uid);
  const id=receiptId(roomId,proof.session,uid);
  return db.runTransaction(async tx=>{
    const claimRef=db.collection(RECEIPTS).doc(id);
    const userRef=db.collection('users').doc(uid);
    const manualRef=db.collection('tacticalManuals').doc(uid);
    const [claimed,userSnap,manualSnap]=await Promise.all([
      tx.get(claimRef),tx.get(userRef),tx.get(manualRef)]);
    if(!userSnap.exists)throw fail('玩家資料不存在',404);
    const user=userSnap.data()||{};
    if(user.uid&&user.uid!==uid)throw fail('玩家身分與記錄不符',403);
    if(claimed.exists){
      const prev=claimed.data()||{};
      return {status:'duplicate',awarded:false,gold:prev.gold,
        cultivation:prev.cultivation,manualDrop:prev.manualDrop||null,
        roomId,session:proof.session,claimedAtMs:prev.claimedAtMs};
    }
    const stats=user.stats||{};
    const gold=amount(stats.gold),score=amount(stats.totalScore),
      wins=amount(stats.dungeonBossWins);
    const patch={'stats.gold':gold+GOLD,
      'stats.totalScore':score+CULTIVATION,
      'stats.dungeonBossWins':wins+1};
    // The exact same 30%-with-pity policy is used by 問道試煉;
    // each party member independently receives one verified victory roll.
    const rolled=ManualDrops.roll(null,uid,
      manualSnap.exists?manualSnap.data():null);
    const manualDrop=rolled.drop?
      {id:rolled.drop,name:rolled.dropName}:null;
    const receipt={uid,roomId,session:proof.session,
      bossId:Boss.ID,partySize:proof.partySize,
      defeatedAtTick:proof.defeatedAtTick,
      gold:GOLD,cultivation:CULTIVATION,manualDrop,claimedAtMs:now};
    tx.update(userRef,patch);
    if(rolled.changed)tx.set(manualRef,rolled.state);
    tx.set(claimRef,receipt);
    return {status:'awarded',awarded:true,gold:GOLD,
      cultivation:CULTIVATION,manualDrop,
      goldBalance:patch['stats.gold'],
      cultivationBalance:patch['stats.totalScore'],
      roomId,session:proof.session,claimedAtMs:now};
  });
}
module.exports={GOLD,CULTIVATION,RECEIPTS,ARCHIVES,INBOXES,MAX_RECENT,
  receiptId,validate,makeArchive,verifiedArchive,prepareArchive,recent,claim};
