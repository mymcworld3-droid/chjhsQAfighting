'use strict';
// First-class permanent dungeon victory reward, separate from legacy raids.
// Read Firebase C victory proof, then issue exactly one receipt+reward in
// Firebase A. Across the two Firebases there is no fabricated atomic commit.
const crypto=require('node:crypto');
const Boss=require('./dungeon-boss-battle.cjs');
const GOLD=120,CULTIVATION=3,RECEIPTS='dungeonVictoryClaims';
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
async function claim(db,roomId,room,uid,now=Date.now()){
  const proof=validate(roomId,room,uid);
  const id=receiptId(roomId,proof.session,uid);
  return db.runTransaction(async tx=>{
    const claimRef=db.collection(RECEIPTS).doc(id);
    const userRef=db.collection('users').doc(uid);
    const [claimed,userSnap]=await Promise.all([tx.get(claimRef),tx.get(userRef)]);
    if(!userSnap.exists)throw fail('玩家資料不存在',404);
    const user=userSnap.data()||{};
    if(user.uid&&user.uid!==uid)throw fail('玩家身分與記錄不符',403);
    if(claimed.exists){
      const prev=claimed.data()||{};
      return {status:'duplicate',awarded:false,gold:prev.gold,
        cultivation:prev.cultivation,roomId,session:proof.session,
        claimedAtMs:prev.claimedAtMs};
    }
    const stats=user.stats||{};
    const gold=amount(stats.gold),score=amount(stats.totalScore),
      wins=amount(stats.dungeonBossWins);
    const patch={'stats.gold':gold+GOLD,
      'stats.totalScore':score+CULTIVATION,
      'stats.dungeonBossWins':wins+1};
    const receipt={uid,roomId,session:proof.session,
      bossId:Boss.ID,partySize:proof.partySize,
      defeatedAtTick:proof.defeatedAtTick,
      gold:GOLD,cultivation:CULTIVATION,claimedAtMs:now};
    tx.update(userRef,patch);
    tx.set(claimRef,receipt);
    return {status:'awarded',awarded:true,gold:GOLD,
      cultivation:CULTIVATION,goldBalance:patch['stats.gold'],
      cultivationBalance:patch['stats.totalScore'],
      roomId,session:proof.session,claimedAtMs:now};
  });
}
module.exports={GOLD,CULTIVATION,RECEIPTS,receiptId,validate,claim};
