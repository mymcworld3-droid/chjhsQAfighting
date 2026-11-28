const WeaponObjects=require('./public/cultivation/weapon-special-objects.js');
'use strict';
const Visual=require('./public/cultivation/question-visual-engine.js');

const crypto=require('node:crypto');
const Rules=require('./public/cultivation/tactical-rules.js');
const Manuals=require('./public/cultivation/manual-rules.js');
const AnswerBonus=require('./public/cultivation/answer-cultivation-bonus.js');
const WeaponDungeons=require('./public/cultivation/weapon-dungeon-rules.js');
const WeaponDungeonRewards=require('./weapon-dungeon-rewards.cjs');
const RealmGate=require('./realm-dungeon-gate.cjs');
const TrainingAccess=require('./public/cultivation/training-access-rules.js');
const Knowledge=require('./public/cultivation/knowledge-points.js');
const SoloLearning=require('./public/cultivation/solo-learning-rules.js');
const AdaptiveRules=require('./public/cultivation/adaptive-learning-rules.js');
const Growth=require('./public/cultivation/nascent-growth.js');
const {recordEvent}=require('./public/cultivation/quest-rules.js');
const {trustedRaidPlayerSnapshot}=require('./raid-authority.cjs');
const StudyScope=require('./trial-tower-scope.cjs');
const {playerRepository,raidRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const {FieldValue}=require('./storage-values.cjs');
const {read:readSoloReceipt}=require('./solo-question-receipt.cjs');
const soloBank=require('./bank-catalog.cjs').createBankCatalog(require('node:path').join(__dirname,'public'));
// New server-only documents share the player repository so answers, rewards and
// stamina commit atomically under the existing Firestore/D1 adapter.
const ROOMS='tacticalBattleRooms',PLAYERS='tacticalBattlePlayers',MANUALS='tacticalManuals';
const error=(message,status=409)=>Object.assign(new Error(message),{status});
const roomId=value=>/^arena-[a-f0-9]{16}$/.test(String(value))?String(value):'';
const requestId=value=>/^[A-Za-z0-9_-]{8,100}$/.test(String(value))?String(value):'';
const copy=v=>JSON.parse(JSON.stringify(v));
const exists=s=>s?.exists?s.data():null;
// Keep the legacy pointer for older clients, but resume each mode independently.
const currentRoomId=(pointer,mode)=>pointer?.roomIds?.[mode]||(mode==='weapon-dungeon'?null:pointer?.roomId);
const roomChannel=s=>s?.weaponDungeon?'weapon-dungeon':s?.mode;
// Legacy in-progress battles had snapshot weapon multipliers; remove them once.
function disarm(s){
  if(!s)return s;
  WeaponDungeons.restoreTerrain(s);
  for(const a of s.actors||[]){
    const w=a.weapon;
    if(w&&!a.bot){
      const n=Number(w.realm),mult=Number.isFinite(n)?1+.025*Math.max(0,Math.min(9,Math.floor(n))):1;
      if(mult>1){a.atk=Math.max(1,Math.round(a.atk/mult));if(a.baseAtk)a.baseAtk=Math.max(1,Math.round(a.baseAtk/mult));}
    }
    delete a.weapon;
  }
  delete s.weaponRewards;
  // D1 could store old array-of-array effects. A resumed room can now be
  // written to either backend without losing those existing animations.
  for(const event of s.events||[]){
    const animation=event.animation;
    for(const key of ['rays','cuts']){
      if(animation?.[key]?.some(Array.isArray))
        animation[key]=animation[key].map(line=>Array.isArray(line)?{cells:line}:line);
    }
  }
  return s;
}
function member(s,uid){const a=s?.actors?.find(a=>a.uid===uid&&!a.bot);if(!a)throw error('你不是此戰場的參戰玩家',403);return a;}
function publicQuestion(q){return q?{
  id:q.id,q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,
  learningTopic:q.learningTopic||q.topic,learningDifficulty:q.difficulty||'easy',
  meta:q.meta||{},...(q.adaptive?{adaptive:q.adaptive}:{}),
  ...Knowledge.metadata(q,q.subject)
}:null;}
const seenSpecies=pointer=>[...new Set((Array.isArray(pointer?.bestiary?.seen)?pointer.bestiary.seen:[]).filter(id=>Number.isInteger(id)&&!!Rules.MONSTERS[id]))];
function ensureIntroductions(s,uid,pointer){
  if(s.mode!=='pve'||Array.isArray(s.pendingIntroductions?.[uid]))return false;
  const seen=new Set(seenSpecies(pointer));s.pendingIntroductions||={};
  s.pendingIntroductions[uid]=[...new Set(s.actors.filter(a=>a.bot&&Rules.MONSTERS[a.species]&&!seen.has(a.species)).map(a=>a.species))];
  return true;
}
function snapshot(s,uid){
  if(!s)return null;member(s,uid);
  const out=disarm(copy(s));delete out.pending;delete out.reviews;delete out.receipts;delete out.answerStamina;delete out.questionRefunds;
  // Only the requesting player's manual progress and loot are public.
  delete out.manualApplied;delete out.manualAppliedExp;
  if(out.manualExp)out.manualExp=out.manualExp[uid]?{[uid]:out.manualExp[uid]}:{};
  if(out.manualKills)out.manualKills=out.manualKills[uid]?{[uid]:out.manualKills[uid]}:{};
  if(out.manualDrops)out.manualDrops=out.manualDrops[uid]?{[uid]:out.manualDrops[uid]}:{};
  out.newEnemies=s.mode==='pve'?[...(s.pendingIntroductions?.[uid]||[])]:[];delete out.pendingIntroductions;
  out.question=s.status==='active'&&(s.quizRound||s.turnUid===uid)?publicQuestion(s.pending?.[uid]):null;
  // Slot 1 can finish before slot 0; do not surface it through ordinary
  // room-state polling until the first question is committed.
  out.questionFollowup=s.status==='active'&&(s.quizRound||s.turnUid===uid)&&!!s.pending?.[uid]
    ?publicQuestion(s.pendingFollowup?.[uid]):null;
  delete out.pendingFollowup;delete out.reviewHistory;
  for(const event of out.events||[]){
    for(const key of ['rays','cuts']){
      if(Array.isArray(event.animation?.[key]))
        event.animation[key]=event.animation[key].map(line=>line.cells);
    }
  }
  out.serverNowMs=Date.now();
  out.review=s.reviews?.[uid]||null;
  out.actors=out.actors.map(a=>{delete a.knowledgeScope;return a;});
  return out;
}
function withProgress(s,uid,user){
  const out=snapshot(s,uid);if(user)out.progress={stats:user.stats||{},questProgress:user.questProgress||null,tacticalTrialV1:user.tacticalTrialV1||null};return out;
}
function patchedUser(user,patch){
  const next={...user,stats:{...(user.stats||{})}};
  for(const [key,value]of Object.entries(patch))if(key.startsWith('stats.'))next.stats[key.slice(6)]=value;else next[key]=value;
  return next;
}
function manualLoadout(manualRecord,trainingAccessScore){
  const normalized=Manuals.weaponize(manualRecord);
  const {equipped,skillLevels,weaponIds}=normalized;
  const manualSkills=[...equipped];
  const manualSkillLevels=Object.fromEntries(manualSkills.filter(id=>skillLevels[id])
    .map(id=>[id,skillLevels[id]]));
  const manualRefinements=Object.fromEntries(Object.entries(normalized.books).map(([id,row])=>[id,Manuals.refinementFor(row)]).filter(([,n])=>n));
  return {trainingAccessScore,manualSkills,manualSkillLevels,manualRefinements,
    manualWeaponIds:[...weaponIds],manualWeaponMode:true,manualRulesVersion:2};
}
// Previously running PvE rooms survive deployments. A pre-weapon actor
// lacks manualWeaponMode, so the client would keep drawing the obsolete
// attack/movement wheel even when the client and CSS were the newest build.
// Upgrade only its weapon metadata; never recreate the actor or reset progress.
function needsWeaponSlotUpgrade(actor){
  return actor&&(!actor.manualWeaponMode||
    !Array.isArray(actor.manualWeaponIds)||actor.manualWeaponIds.length!==2||actor.manualRulesVersion!==2);
}
function upgradeLegacyRoomWeapons(room,uid,user,manualRecord){
  if(room?.mode!=='pve'||room.status!=='active'||!user)return false;
  const actor=room.actors?.find(a=>a.uid===uid&&!a.bot);
  if(!needsWeaponSlotUpgrade(actor))
    return false;
  const loadout=manualLoadout(manualRecord,TrainingAccess.score(user));
  // Old active rooms could have an authorized skill preset that is no longer
  // the user's current equipment. Keep those already-authorized casts until
  // the room ends, instead of silently revoking skills mid-fight.
  const oldSkills=Array.isArray(actor.manualSkills)?actor.manualSkills.filter(
    id=>Manuals.BY_SKILL[id]):[];
  const legacyBooks=[...new Set(oldSkills.map(id=>Manuals.BY_SKILL[id].manualId))];
  const preserveLegacy=oldSkills.some(id=>!loadout.manualSkills.includes(id))&&
    legacyBooks.length>0&&legacyBooks.length<=2;
  const equipped=preserveLegacy?[
    ...legacyBooks,...Array.from({length:2-legacyBooks.length},()=>null)
  ]:loadout.manualWeaponIds;
  const available=preserveLegacy?oldSkills:loadout.manualSkills;
  const levels=preserveLegacy?actor.manualSkillLevels||{}:loadout.manualSkillLevels;
  actor.manualWeaponMode=true;actor.manualRulesVersion=2;
  actor.manualWeaponIds=[...equipped];
  actor.manualSkills=[...available];
  actor.manualSkillLevels={...levels};
  actor.manualRefinements={...loadout.manualRefinements};
  actor.trainingAccessScore=loadout.trainingAccessScore;
  delete actor.manualLoadoutName;
  delete actor.manualLoadoutIndex;
  if(room.pveMetrics)room.pveMetrics.loadout=[...available];
  return true;
}
function playerActor(user,uid,selection,catalog,manualRecord){
  const trusted=trustedRaidPlayerSnapshot({...user,artifactSystem:{...(user.artifactSystem||{}),equipped:{}}},uid,catalog),type=trusted.goldenCore?.type||'none';
  const branch=Rules.savedBranch(user,type).id;
  const manualAttackBonus=Manuals.manualAttackBonus(manualRecord);
  return {...trusted,...manualLoadout(manualRecord,TrainingAccess.score(user)),
    atk:trusted.atk+manualAttackBonus,
    baseAtk:trusted.baseAtk+manualAttackBonus,
    manualAttackBonus,
    // Do not raise enemy scaling along with the new manuscript attack bonus.
    enemyScaleAttack:trusted.atk,core:type,branch,gender:user.storyProgressV1?.gender==='female'?'female':'male',shield:0};
}
function trialProgress(raw,seed){
  return {version:1,seed:/^[a-f0-9]{32}$/.test(raw?.seed)?raw.seed:seed,
    stage:Math.max(1,Math.min(1000000,Rules.num(raw?.stage)||1)),best:Rules.num(raw?.best)};
}
function attachScopes(s,actors){
  for(const a of s.actors){const trusted=actors.find(p=>p.uid===a.uid);if(trusted)a.knowledgeScope=trusted.knowledgeScope;}
  s.pending={};s.reviews={};return s;
}
function rewardFor(s,a,user){
  if(s.status!=='finished'||s.finishReason==='forfeit'&&s.actors.reduce((n,p)=>n+(p.answered||0),0)<2)return null;
  const win=s.winner===a.team,draw=s.winner==='draw';
  if(s.mode==='pve'){
    if(!win||!['hp','objective'].includes(s.finishReason)||a.correct<=0)return null;
    const gold=s.trial
      ?150+Math.min(500,Rules.num(s.trial.stage-1)*25)
      :150+Rules.MAPS.findIndex(m=>m.id===s.map)*100;
    return {gold,cultivation:2+Growth.cultivation(user,'solo'),win};
  }
  if(s.actors.filter(p=>!p.bot).reduce((n,p)=>n+p.answered,0)<2)return null;
  return {gold:win?500:draw?250:200,cultivation:win?5+Growth.cultivation(user,'battle'):draw?2:0,win,draw};
}
// Legacy rooms kept kill counts and their idempotent receipts. Modern rooms
// keep accumulated XP so different beast realms reward different amounts.
// Each room tracks how much was already applied to prevent replay rewards.
function applyManualKills(s,uid,raw){
  const next=Manuals.normalize(raw);
  let changed=false;
  function applyLedger(ledgerName,appliedName,multiplier){
    const seen=s[ledgerName]?.[uid]||{},applied=s[appliedName]?.[uid]||{};
    for(const [id,total] of Object.entries(seen)){
      if(!Manuals.BY_BOOK[id]||!next.books[id])continue;
      const current=Math.max(0,Math.trunc(Number(total)||0));
      const previous=Math.max(0,Math.trunc(Number(applied[id])||0));
      if(current<=previous)continue;
      next.books[id].exp=Math.min(Manuals.MAX_EXP,
        next.books[id].exp+(current-previous)*multiplier);
      s[appliedName]||={};s[appliedName][uid]||={};s[appliedName][uid][id]=current;
      changed=true;
    }
  }
  applyLedger('manualKills','manualApplied',Manuals.EXP_PER_KILL);
  applyLedger('manualExp','manualAppliedExp',1);
  return {state:next,changed};
}
async function saveManualKills(tx,db,s,uid){
  if(!s.manualKills?.[uid]&&!s.manualExp?.[uid])return;
  const ref=db.collection(MANUALS).doc(uid);
  const applied=applyManualKills(s,uid,exists(await tx.get(ref)));
  if(applied.changed)tx.set(ref,applied.state);
}
const rollManualDrop=require('./manual-reward-rules.cjs').roll;
function manualResponse(record,user,gold=Rules.num(user.stats?.gold)){
  // Use the same authoritative, artifact-free attack snapshot as a new
  // tactical trial. Browser projections may omit timed attack modifiers.
  const combatUser={...user,artifactSystem:{...(user.artifactSystem||{}),equipped:{}}};
  const battleAttack=trustedRaidPlayerSnapshot(combatUser,String(user.uid||''),{}).atk+
    Manuals.manualAttackBonus(record);
  // The existing PvE progression automatically determines the NEXT stage.
  // Reveal only this numeric stage, not room seeds or selectable difficulties.
  const trialStage=Math.max(1,Math.min(1000000,Rules.num(user.tacticalTrialV1?.stage)||1));
  const state=Manuals.publicState(record,TrainingAccess.score(user));
  return {...state,library:Manuals.sortedOwnedWeapons(state.library,state.weaponIds),gold,battleAttack,trialStage};
}
// Release gift: ensure each authoritative admin owns one of the six new
// weapons. Never add copies/refinement to an existing weapon. Ordinary GETs
// stay read-only; the transaction rechecks the role and ownership on retry.
const adminReleaseBooks=()=>Manuals.RELEASE_NEW_WEAPONS?
  Manuals.DEVELOPMENT_BOOKS.filter(book=>Object.hasOwn(Manuals.BY_BOOK,book.id)):[];
function needsAdminReleaseGift(user,record){
  return user?.isAdmin===true&&adminReleaseBooks().some(book=>!Object.hasOwn(record?.books||{},book.id));
}
async function manualsState(db,uid){
  const userRef=db.collection('users').doc(uid),manualRef=db.collection(MANUALS).doc(uid);
  const [player,record]=await Promise.all([userRef.get(),manualRef.get()]);
  const user=exists(player);if(!user)throw error('玩家資料不存在',404);
  const raw=exists(record);
  if(!needsAdminReleaseGift(user,raw))return manualResponse(raw,user);
  return db.runTransaction(async tx=>{
    const [latestPlayer,latestManual]=await Promise.all([tx.get(userRef),tx.get(manualRef)]);
    const currentUser=exists(latestPlayer),currentRaw=exists(latestManual);
    if(!currentUser)throw error('玩家資料不存在',404);
    if(!needsAdminReleaseGift(currentUser,currentRaw))return manualResponse(currentRaw,currentUser);
    const next=Manuals.normalize(currentRaw);
    for(const book of adminReleaseBooks()){
      if(!Object.hasOwn(next.books,book.id))next.books[book.id]={exp:0};
    }
    tx.set(manualRef,next);
    return manualResponse(next,currentUser);
  });
}
async function chooseSchool(db,uid,input){
  const school=String(input?.school||'');
  if(!['sword','body'].includes(school))throw error('請選擇劍修或體修',400);
  return db.runTransaction(async tx=>{
    const ref=db.collection(MANUALS).doc(uid);
    const [user,record]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(ref)]);
    if(!exists(user))throw error('玩家資料不存在',404);
    const next=Manuals.normalize(exists(record));next.school=school;
    if(!next.starterClaimed){
      const starter=Manuals.starterFor(school);
      next.books[starter]||={exp:0};next.starterClaimed=true;
      const introductory=Manuals.BY_BOOK[starter].skills[0];
      if(!next.equipped.length){
        await assertLoadoutUnlocked(tx,db,uid);
        next.equipped.push(introductory.id);
      }
    }
    next.loadouts[next.activeLoadout].skillIds=[...next.equipped];
    tx.set(ref,next);return manualResponse(next,exists(user));
  });
}
async function equipManualSkills(db,uid,input){
  const ids=input?.skillIds;
  if(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)
    throw error('最多裝備三個不重複的功法技能',400);
  return db.runTransaction(async tx=>{
    const ref=db.collection(MANUALS).doc(uid);
    const [user,record]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(ref)]);
    if(!exists(user))throw error('玩家資料不存在',404);
    if(Array.isArray(exists(record)?.weaponIds))
      throw error('新版武器裝備請從兩個武器欄選擇，技能依武器等級自動解鎖',400);
    const next=Manuals.normalize(exists(record));
    if(ids.some(id=>!Manuals.unlocked(next,id)))throw error('不能裝備功法等級尚未解鎖的技能',403);
    if(new Set(ids.map(id=>Manuals.BY_SKILL[id].moveId)).size!==ids.length)
      throw error('相同招式只能裝備一次，請選擇其所屬功法',400);
    await assertLoadoutUnlocked(tx,db,uid);
    next.equipped=[...ids];next.loadouts[next.activeLoadout].skillIds=[...ids];tx.set(ref,next);
    return manualResponse(next,exists(user));
  });
}

// Room pointers and room state are read in the same transaction as the write,
// so opening a battle and changing its loadout cannot race each other.
async function assertLoadoutUnlocked(tx,db,uid){
  const pointer=exists(await tx.get(db.collection(PLAYERS).doc(uid)))||{};
  const ids=[...new Set([pointer.roomId,...Object.values(pointer.roomIds||{})].filter(Boolean))];
  const rooms=await Promise.all(ids.map(id=>tx.get(db.collection(ROOMS).doc(id))));
  if(rooms.some(s=>{const room=exists(s);return room&&(room.status==='active'||room.status==='waiting'&&room.createdAtMs>Date.now()-15*60000)&&room.actors?.some(a=>a.uid===uid);}))
    throw error('戰鬥進行中，請先結束戰鬥或離場再更換配置',409);
}

// A weapon can change during SOLO PvE without costing a turn. Multiplayer
// dungeon and PvP are locked while underway. Read all affected room records
// before the first write, so saved weapons and the live actor stay atomic.
async function weaponEditableRooms(tx,db,uid){
  const pointer=exists(await tx.get(db.collection(PLAYERS).doc(uid)))||{};
  const ids=[...new Set([pointer.roomId,...Object.values(pointer.roomIds||{})].filter(Boolean))];
  const rooms=await Promise.all(ids.map(id=>tx.get(db.collection(ROOMS).doc(id))));
  if(rooms.some(s=>{
    const room=exists(s);
    return room?.mode==='pvp'&&room.status==='active'&&
      room.actors?.some(a=>a.uid===uid);
  }))throw error('多人鬥法進行中，不可更換武器',409);
   // Before matchmaking completes, PvP is not yet in progress. Updating its
  // waiting actor is essential: the joined opponent must see the latest gear.
  return rooms.map(s=>exists(s)).filter(room=>
    ((room?.mode==='pve'&&room.status==='active')||
      (room?.mode==='pvp'&&room.status==='waiting'))&&
    room.actors?.some(a=>a.uid===uid));
}

async function assertDungeonWeaponEditable(playerDb,uid){
  // Dungeon membership/rooms are in project C, whereas weapon ownership
  // lives in project A. A C-room read is required; reading A silently fails.
  const dungeonDb=playerDb?.records instanceof Map?playerDb:raidRepository.resolve().db;
  const pointer=exists(await dungeonDb.collection('dungeonRoomMemberships').doc(uid).get());
  if(!pointer?.roomId)return;
  const room=exists(await dungeonDb.collection('dungeonRooms').doc(pointer.roomId).get());
  // The dungeon membership pointer outlives expired and completed rooms.
  // Only an actually usable, in-progress dungeon locks equipped weapons.
  const active=room?.mode==='dungeon'&&room.version===1&&
    room.status==='assembled'&&Number(room.expiresAtMs)>Date.now()&&
    room.bossEncounter?.status!=='defeated'&&
    room.members&&Object.hasOwn(room.members,uid);
  if(active)
    throw error('多人副本進行中，不可裝備或卸下武器；請先離開本次副本。',409);
}
async function updateLoadout(db,uid,input){
  const index=input?.index;
  if(!Number.isInteger(index)||index<0||index>2)throw error('配置不存在',400);
  if(Object.hasOwn(input||{},'weaponId')&&index>=2)throw error('每人最多裝備兩把武器',400);
  const name=input?.name;
  if(name!==undefined&&(typeof name!=='string'||!name.trim()||Array.from(name.trim()).length>20))throw error('配置名稱須為 1 至 20 個字',400);
  const ids=input?.skillIds;
  if(ids!==undefined&&(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length))throw error('最多裝備三個不重複的功法技能',400);
  return db.runTransaction(async tx=>{
    const ref=db.collection(MANUALS).doc(uid);
    const [userSnap,record]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(ref)]);
    const user=exists(userSnap);if(!user)throw error('玩家資料不存在',404);
    if(Array.isArray(exists(record)?.weaponIds)&&index>=2)throw error('每人最多裝備兩把武器',400);
    if(Object.hasOwn(input||{},'weaponId')){
      const weaponId=input.weaponId;
      if(weaponId!==null&&(typeof weaponId!=='string'||!Manuals.BY_BOOK[weaponId]))
        throw error('選取的武器不存在',400);
      const modern=Manuals.weaponize(exists(record));
      if(weaponId&&!modern.books[weaponId])throw error('尚未獲得這件武器',403);
      if(weaponId&&modern.weaponIds.some((id,i)=>i!==index&&id===weaponId))
        throw error('同一種武器不能重複裝備',400);
      await assertDungeonWeaponEditable(db,uid);
      const editableRooms=await weaponEditableRooms(tx,db,uid);
      const weaponIds=[...modern.weaponIds];
      weaponIds[index]=weaponId;
      const saved=Manuals.normalize({...modern,weaponIds});
      const projection=manualLoadout(saved,TrainingAccess.score(user));
      for(const room of editableRooms){
        const actor=room.actors.find(a=>a.uid===uid);
        if(!actor)continue;
        actor.manualSkills=[...projection.manualSkills];
        actor.manualSkillLevels={...projection.manualSkillLevels};
        actor.manualRefinements={...projection.manualRefinements};
        actor.manualWeaponIds=[...projection.manualWeaponIds];
        if(room.weaponObjects)room.weaponObjects=WeaponObjects.reconcileEquipment(room.weaponObjects,uid,actor.manualWeaponIds);
        actor.manualWeaponMode=true;actor.manualRulesVersion=2;
        delete actor.manualLoadoutIndex;
        delete actor.manualLoadoutName;
        if(room.mode==='pve'&&room.pveMetrics)
          room.pveMetrics.loadout=[...projection.manualSkills];
        room.revision++;room.updatedAtMs=Date.now();
        tx.set(db.collection(ROOMS).doc(room.id),room);
      }
      tx.set(ref,saved);
      return manualResponse(saved,user);
    }
    if(Array.isArray(exists(record)?.weaponIds))
      throw error('新版武器配置由武器等級決定技能，請改用 weaponId',400);
    const next=Manuals.normalize(exists(record));
    const chosen=ids===undefined?next.loadouts[index].skillIds:ids;
    if(chosen.some(id=>!Manuals.unlocked(next,id)))throw error('不能裝備功法等級尚未解鎖的技能',403);
    if(new Set(chosen.map(id=>Manuals.BY_SKILL[id].moveId)).size!==chosen.length)throw error('相同招式只能裝備一次，請選擇其所屬功法',400);
    if(input?.apply===true||(ids!==undefined&&index===next.activeLoadout))await assertLoadoutUnlocked(tx,db,uid);
    if(name!==undefined)next.loadouts[index].name=name.trim();
    next.loadouts[index].skillIds=[...chosen];
    if(input?.apply===true){next.activeLoadout=index;next.equipped=[...chosen];}
    else if(index===next.activeLoadout)next.equipped=[...chosen];
    tx.set(ref,next);return manualResponse(next,user);
  });
}

async function upgradeManual(db,uid,input){
  const {bookId,targetLevel,expectedGold}=input||{};
  if(typeof bookId!=='string'||!Object.hasOwn(Manuals.BY_BOOK,bookId)||
    !Number.isInteger(targetLevel)||targetLevel<2)throw error('功法升級資料無效',400);
  if(targetLevel>Manuals.MAX_GOLD_LEVEL)
    throw error('功法 Lv. 10 之後只能透過 PvE 功法擊殺累積 EXP 升級',403);
  const userRef=db.collection('users').doc(uid),manualRef=db.collection(MANUALS).doc(uid);
  return db.runTransaction(async tx=>{
    const [userSnap,record]=await Promise.all([tx.get(userRef),tx.get(manualRef)]);
    const user=exists(userSnap);if(!user)throw error('玩家資料不存在',404);
    const state=Manuals.normalize(exists(record)),book=state.books[bookId];
    if(!book)throw error('尚未取得此功法',403);
    if(Manuals.levelForExp(book.exp)>=targetLevel)return manualResponse(state,user);
    const quote=Manuals.upgradeQuote(book.exp),gold=Rules.num(user.stats?.gold);
    if(!quote)throw error('功法 Lv. 10 之後只能透過 PvE 功法擊殺累積 EXP 升級',403);
    if(quote.targetLevel!==targetLevel)throw error('請先提升至下一級');
    if(expectedGold!==quote.gold)throw error('升級費用已更新，請先同步功法',409);
    if(gold<quote.gold)throw error('靈石不足');
    book.exp=quote.targetExp;
    tx.set(manualRef,state);tx.update(userRef,{'stats.gold':gold-quote.gold});
    return manualResponse(state,user,gold-quote.gold);
  });
}

async function upgradeSkill(db,uid,input){
  const {skillId,targetLevel,expectedGold}=input||{};
  if(typeof skillId!=='string'||!Object.hasOwn(Manuals.BY_SKILL,skillId)||
    !Number.isInteger(targetLevel)||targetLevel<2||targetLevel>Manuals.MAX_SKILL_LEVEL)
    throw error('技能升級資料無效',400);
  const userRef=db.collection('users').doc(uid),manualRef=db.collection(MANUALS).doc(uid);
  return db.runTransaction(async tx=>{
    const [userSnap,record]=await Promise.all([tx.get(userRef),tx.get(manualRef)]);
    const user=exists(userSnap);if(!user)throw error('玩家資料不存在',404);
    const state=Manuals.normalize(exists(record)),skill=Manuals.BY_SKILL[skillId];
    if(!Manuals.unlocked(state,skillId))throw error('尚未解鎖此功法技能',403);
    const level=Manuals.skillLevel(state.skillLevels[skillId]);
    if(level>=targetLevel)return manualResponse(state,user);
    const quote=Manuals.skillUpgradeQuote(level),gold=Rules.num(user.stats?.gold);
    if(quote.targetLevel!==targetLevel)throw error('請先提升至下一級');
    if(expectedGold===undefined)throw error('升級介面已更新，請重新整理頁面',409);
    if(expectedGold!==quote.gold)throw error('升級費用已更新，請先同步功法',409);
    if(gold<quote.gold)throw error('靈石不足');
    state.skillLevels[skillId]=targetLevel;
    tx.set(manualRef,state);tx.update(userRef,{'stats.gold':gold-quote.gold});
    return manualResponse(state,user,gold-quote.gold);
  });
}

async function settle(tx,db,s,userOverrides={}){
  const updates={};if(s.status!=='finished')return updates;
  const people=s.actors.filter(a=>!a.bot&&!s.rewarded.includes(a.uid));
  const [users,pointers,manualRecords]=await Promise.all([
    Promise.all(people.map(a=>tx.get(db.collection('users').doc(a.uid)))),
    Promise.all(people.map(a=>tx.get(db.collection(PLAYERS).doc(a.uid)))),
    Promise.all(people.map(a=>tx.get(db.collection(MANUALS).doc(a.uid))))
  ]);
  people.forEach((a,i)=>{
    const u=userOverrides[a.uid]||exists(users[i]);if(!u)return;const reward=rewardFor(s,a,u);
    s.rewarded.push(a.uid);s.rewards||={};s.rewards[a.uid]=reward||{gold:0,cultivation:0,win:s.winner===a.team};
    const patch={};
    const pointer=exists(pointers[i]),campaign=pointer?.trial;
    let gatePointer=pointer,weaponCleared=false;
    const manualRef=db.collection(MANUALS).doc(a.uid);
    if(s.mode==='pve'&&s.trial?.layoutVersion>=3&&s.winner===a.team&&s.finishReason==='objective'&&['transport','sealing','defense'].includes(s.objective?.type)){
      const used=Object.keys(s.manualUsed?.[a.uid]||{}).filter(id=>Manuals.BY_BOOK[id]).slice(0,3);
      if(used.length){s.manualExp||={};s.manualExp[a.uid]||={};for(const id of used)s.manualExp[a.uid][id]=(s.manualExp[a.uid][id]||0)+Math.max(1,Math.floor(Manuals.expForBeast(s.trial.stage)/5));}
    }
    const mastered=applyManualKills(s,a.uid,exists(manualRecords[i]));
    let manualChanged=mastered.changed;
    const manuals=mastered.state;
    const cleared=s.mode==='pve'&&!s.weaponDungeon&&s.trial&&s.winner===a.team&&['hp','objective'].includes(s.finishReason)&&currentRoomId(pointer,'pve')===s.id&&
       campaign?.seed===s.trial.seed&&campaign.stage===s.trial.stage;
    if(cleared){
      const next={...campaign,stage:Math.min(1000000,campaign.stage+1),best:Math.max(campaign.best||0,campaign.stage)};
      patch.tacticalTrialV1=next;s.nextStage=next.stage;
      tx.set(db.collection(PLAYERS).doc(a.uid),{...pointer,trial:next});
      if(reward){const dropped=rollManualDrop(s,a.uid,manuals);manualChanged=manualChanged||dropped.changed;}
    }
    if(s.weaponDungeon&&s.winner===a.team&&['hp','objective'].includes(s.finishReason)&&
       currentRoomId(pointer,'weapon-dungeon')===s.id&&
       s.actors.some(enemy=>enemy.bot&&enemy.weaponDungeonLord&&!Rules.alive(enemy))){
      const dungeon=WeaponDungeons.progress(pointer?.weaponDungeonV1,s.updatedAtMs);
      const index=s.weaponDungeon.difficulty;
      const before=WeaponDungeons.progressFor(dungeon,s.weaponDungeon.id||WeaponDungeons.ID).unlocked;
      const clearedProgress=WeaponDungeons.recordClear(dungeon,s.weaponDungeon.id||WeaponDungeons.ID,index);
      gatePointer={...pointer,weaponDungeonV1:dungeon};weaponCleared=true;
      tx.set(db.collection(PLAYERS).doc(a.uid),gatePointer);
      const drop=WeaponDungeonRewards.roll(s,a.uid,manuals);manualChanged=manualChanged||!!drop;
      s.weaponDungeonResult={cleared:true,difficulty:index,unlocked:clearedProgress.unlocked,newlyUnlocked:clearedProgress.unlocked>before?clearedProgress.unlocked:null,tickets:dungeon.tickets,drop};
    }else if(s.weaponDungeon&&currentRoomId(pointer,'weapon-dungeon')===s.id){
      const dungeon=WeaponDungeons.progress(pointer?.weaponDungeonV1,s.updatedAtMs);
      const progress=WeaponDungeons.progressFor(dungeon,s.weaponDungeon.id||WeaponDungeons.ID);
      s.weaponDungeonResult={cleared:false,difficulty:s.weaponDungeon.difficulty,unlocked:progress.unlocked,newlyUnlocked:null,tickets:dungeon.tickets,drop:null};
    }
    if(manualChanged)tx.set(manualRef,manuals);
    if(reward)patch['stats.gold']=Rules.num(u.stats?.gold)+reward.gold;
    if(reward||weaponCleared)Object.assign(patch,RealmGate.patch(u.stats,Rules.num(u.stats?.totalScore)+(reward?.cultivation||0),gatePointer));
    if(reward&&s.mode==='pvp'){
      patch.questProgress=recordEvent(u.questProgress,'battle');
      patch['stats.battleMatches']=Rules.num(u.stats?.battleMatches)+1;
      const field=reward.win?'battleWins':reward.draw?'battleDraws':'battleLosses';patch['stats.'+field]=Rules.num(u.stats?.[field])+1;
    }
    if(Object.keys(patch).length){tx.update(db.collection('users').doc(a.uid),patch);updates[a.uid]=patchedUser(u,patch);}
  });
  return updates;
}
async function readRoom(tx,db,id,uid){
  if(!roomId(id))throw error('戰場代碼無效',400);
  const s=disarm(exists(await tx.get(db.collection(ROOMS).doc(id))));if(!s)throw error('戰場不存在',404);member(s,uid);return s;
}
async function weaponDungeonState(db,uid,now=Date.now(),{allowHidden=false}={}){
  return db.runTransaction(async tx=>{
    const ref=db.collection(PLAYERS).doc(uid);
    const [saved,user]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(uid))]);
    if(!exists(user))throw error('玩家資料不存在',404);
    const pointer=exists(saved)||{},progress=WeaponDungeons.progress(pointer.weaponDungeonV1,now);
    const id=currentRoomId(pointer,'weapon-dungeon');
    const room=id?exists(await tx.get(db.collection(ROOMS).doc(id))):null;
    tx.set(ref,{...pointer,weaponDungeonV1:progress});
    const {byDungeon,...publicProgress}=progress;
    const visibleDungeons=WeaponDungeons.catalog(progress,{allowHidden});
    const visibleIds=new Set(visibleDungeons.map(d=>d.id));
    const visibleProgress=Object.fromEntries(Object.entries(byDungeon||{}).filter(([id])=>visibleIds.has(id)));
    return {...publicProgress,...(Object.keys(visibleProgress).length?{byDungeon:visibleProgress}:{}),dungeonId:WeaponDungeons.ID,name:WeaponDungeons.NAME,dailyTickets:3,maxTickets:5,
      difficulties:WeaponDungeons.DIFFICULTIES.map(d=>({...d,locked:d.index>progress.unlocked,nextRealm:WeaponDungeons.lowerRealm(d.name),lowerRealm:WeaponDungeons.lowerRealm(d.name)})),
      dungeons:visibleDungeons.map(d=>({...d,rewardPools:WeaponDungeonRewards.previewPools(WeaponDungeons.WEAPON_REALMS,d.id)})),
      rewardPools:WeaponDungeonRewards.previewPools(WeaponDungeons.WEAPON_REALMS),
      active:room?.status==='active'&&room.weaponDungeon&&visibleIds.has(room.weaponDungeon.id||WeaponDungeons.ID)?{roomId:room.id,dungeonId:room.weaponDungeon.id||WeaponDungeons.ID,difficulty:room.weaponDungeon.difficulty}:null};
  });
}
async function start(db,uid,selection={},now=Date.now(),{allowHidden=false}={}){
  const weapon=selection.activity==='weapon-dungeon';
  if(weapon&&(selection.mode==='pvp'||selection.code))throw error('武器副本僅限單人挑戰',400);
  const dungeonChoice=weapon?WeaponDungeons.selection(selection,{allowHidden}):null;
  const startRequest=weapon?requestId(selection.requestId):'';
  if(weapon&&!startRequest)throw error('副本挑戰識別碼無效',400);
  if(weapon&&selection.retryFromRoomId!=null&&selection.resumeRoomId!=null)throw error('續戰與再次挑戰不可同時指定',400);
  const mode=selection.mode==='pvp'?'pvp':'pve',channel=weapon?'weapon-dungeon':mode,map=Rules.mapFor(selection.map).id;
  const code=String(selection.code||'').trim().toLowerCase().replace(/^arena-/,'');
  if(code&&!/^[a-f0-9]{16}$/.test(code))throw error('請輸入完整的 16 碼戰場代碼',400);
  const wanted=code?'arena-'+code:'';
  let candidates=[];
  if(mode==='pvp'&&!wanted){
    // One time-field index works on both Firestore and D1. Expired waiting
    // rooms cannot permanently occupy the front of a status-only query.
    const found=await db.collection(ROOMS).where('createdAtMs','>',now-15*60000).orderBy('createdAtMs','desc').limit(80).get();
    candidates=found.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.status==='waiting'&&s.mode==='pvp'&&s.map===map).sort((a,b)=>a.id.localeCompare(b.id));
  }
  const newId='arena-'+crypto.randomBytes(8).toString('hex'),seed=crypto.randomBytes(16).toString('hex');
  return db.runTransaction(async tx=>{
    const pointerRef=db.collection(PLAYERS).doc(uid),userRef=db.collection('users').doc(uid);
    const [pointerSnap,userSnap,catalogSnap,manualSnap]=await Promise.all([
      tx.get(pointerRef),tx.get(userRef),tx.get(db.collection('gameConfig').doc('artifactCatalogV1')),
      tx.get(db.collection(MANUALS).doc(uid))]);
    const user=exists(userSnap);if(!user||user.uid&&user.uid!==uid)throw error('玩家資料不存在',404);
    const pointer=exists(pointerSnap)||{},priorId=currentRoomId(pointer,channel);
    const dungeonProgress=weapon?WeaponDungeons.progress(pointer.weaponDungeonV1,now):null;
    const receipt=weapon?(pointer.weaponDungeonStarts||[]).find(row=>row.requestId===startRequest):null;
    if(receipt){
      if((receipt.dungeonId||WeaponDungeons.ID)!==dungeonChoice.id||receipt.difficulty!==dungeonChoice.difficulty)throw error('挑戰識別碼已用於另一個難度',409);
      const replay=exists(await tx.get(db.collection(ROOMS).doc(receipt.roomId)));
      if(!replay||roomChannel(replay)!==channel)throw error('原挑戰紀錄已失效',409);
      return snapshot(replay,uid);
    }
    if(weapon&&dungeonChoice.difficulty>WeaponDungeons.progressFor(dungeonProgress,dungeonChoice.id).unlocked)throw error('請先通過前一個難度',403);
    const stored=priorId?exists(await tx.get(db.collection(ROOMS).doc(priorId))):null;
    // A legacy account may only have roomId. The first weapon dungeon must
    // retain that unfinished trial before replacing the legacy last-room pointer.
    const legacyId=pointer.roomId!==priorId&&!Object.values(pointer.roomIds||{}).includes(pointer.roomId)?pointer.roomId:null;
    const legacy=legacyId?exists(await tx.get(db.collection(ROOMS).doc(legacyId))):null;
    const prior=roomChannel(stored)===channel?disarm(stored):null;
    // Resume is never permission to spend a ticket on a replacement room.
    if(weapon&&selection.resumeRoomId!=null&&(prior?.status!=='active'||prior.id!==selection.resumeRoomId))throw error('原副本已結束或變更，請返回秘境重新選擇',409);
    // A settlement retry may only spend a ticket against the exact finished room.
    if(weapon&&selection.retryFromRoomId!=null&&(prior?.status!=='finished'||prior.id!==selection.retryFromRoomId||prior.weaponDungeon?.difficulty!==dungeonChoice.difficulty||(prior.weaponDungeon?.id||WeaponDungeons.ID)!==dungeonChoice.id))throw error('原結算已失效，請返回秘境重新選擇',409);
    // Preserve an unfinished legacy trial when first entering PvP (and vice versa).
    const roomIds={...pointer.roomIds,...(legacy?{[roomChannel(legacy)]:legacy.id}:{}),...(stored?{[roomChannel(stored)]:stored.id}:{})};
    const campaign=trialProgress(pointer.trial,seed);
    if(prior?.status==='active'){
      if(weapon&&((prior.weaponDungeon.id||WeaponDungeons.ID)!==dungeonChoice.id||prior.weaponDungeon.difficulty!==dungeonChoice.difficulty))throw error('已有進行中的武器副本，請先完成或離場',409);
      // Resume old unfinished trials without moving actors or discarding a question.
      let changed=false;
      if(prior.mode==='pve'&&!prior.trial){
        prior.trial={version:1,seed:campaign.seed,stage:campaign.stage,layoutVersion:0,title:Rules.mapFor(prior.map).name};
        changed=true;tx.set(pointerRef,{...pointer,trial:campaign});
      }
      changed=upgradeLegacyRoomWeapons(prior,uid,user,exists(manualSnap))||changed;
      changed=ensureIntroductions(prior,uid,pointer)||changed;
      if(changed)tx.set(db.collection(ROOMS).doc(prior.id),prior);
      return snapshot(prior,uid);
    }
    const candidate=wanted||candidates.find(s=>!s.actors.some(a=>a.uid===uid)&&(!prior||s.id<prior.id))?.id;
    const target=candidate?exists(await tx.get(db.collection(ROOMS).doc(candidate))):null;
    if(wanted&&(!target||target.mode!=='pvp'||target.status!=='waiting'||target.createdAtMs<now-15*60000))throw error('此戰場已開始或已失效');
    const a=playerActor(user,uid,selection,exists(catalogSnap)||{},exists(manualSnap));
    if(mode==='pvp'&&a.trainingAccessScore<6)throw error('築基期解鎖鬥法論道');
    let s;
    if(target&&target.status==='waiting'&&!target.actors.some(p=>p.uid===uid)&&target.createdAtMs>now-15*60000){
      s=Rules.join(target,a,now);s.actors.find(p=>p.uid===uid).knowledgeScope=a.knowledgeScope;
      // Keep the existing lower-realm nascent-soul suppression rule.
      for(const p of s.actors){const other=s.actors.find(o=>o.uid!==p.uid);if((other.trainingAccessScore||other.totalScore||0)<68){
        if(p.baseAtk)p.atk=p.baseAtk;if(p.baseMaxHp){p.hp=p.maxHp=p.baseMaxHp;}
      }}
    }else if(prior?.status==='waiting')return snapshot(prior,uid);
    else{
      const retry=mode==='pve'&&!weapon&&prior?.trial?.seed===campaign.seed&&prior.trial.stage===campaign.stage&&prior.winner!=='player';
      if(weapon&&dungeonProgress.tickets<1)throw error('武器副本券不足，每日補發 3 張至 5 張',403);
      const trial=weapon?{seed,stage:dungeonChoice.stage,layoutVersion:4,weaponDungeon:dungeonChoice}:
        {...campaign,layoutVersion:retry?(prior.trial.layoutVersion??1):4};
      s=attachScopes(Rules.create({id:newId,mode,map:retry&&trial.layoutVersion===0?prior.map:map,players:[a],trial:mode==='pve'?trial:null,now}),[a]);
      // Actor construction deliberately limits public combat fields.
      s.actors[0].baseAtk=a.baseAtk;s.actors[0].baseMaxHp=a.baseMaxHp;s.actors[0].trainingAccessScore=a.trainingAccessScore;
    }
    if(s.mode==='pvp'&&s.actors.length===2){const p=s.actors.find(p=>p.uid===uid);p.baseAtk=a.baseAtk;p.baseMaxHp=a.baseMaxHp;p.trainingAccessScore=a.trainingAccessScore;}
    ensureIntroductions(s,uid,pointer);
    if(prior?.status==='waiting'&&prior.id!==s.id)tx.set(db.collection(ROOMS).doc(prior.id),Rules.forfeit(prior,uid,now));
    tx.set(db.collection(ROOMS).doc(s.id),s);tx.set(pointerRef,{...pointer,roomId:s.id,roomIds:{...roomIds,[channel]:s.id},...(mode==='pve'&&!weapon?{trial:campaign}:{}),
      ...(weapon?{weaponDungeonV1:{...dungeonProgress,tickets:dungeonProgress.tickets-1},
        weaponDungeonStarts:[...(pointer.weaponDungeonStarts||[]),{requestId:startRequest,roomId:s.id,dungeonId:dungeonChoice.id,difficulty:dungeonChoice.difficulty}].slice(-32)}:{})});
    const preferences={['tacticalPreferences.'+a.core]:a.branch,...(mode==='pve'&&!weapon?{tacticalTrialV1:campaign}:{})};
    tx.update(userRef,preferences);return snapshot(s,uid);
  });
}
async function state(db,uid,now=Date.now(),mode=''){
  if(mode&&!['pve','pvp','weapon-dungeon'].includes(mode))throw error('戰場模式無效',400);
  const pointer=exists(await db.collection(PLAYERS).doc(uid).get()),id=mode?currentRoomId(pointer,mode):pointer?.roomId;if(!id)return null;
  // No write for ordinary reads. Only an expired PvP turn requires a transaction.
  const stored=disarm(exists(await db.collection(ROOMS).doc(id).get()));if(!stored||mode&&roomChannel(stored)!==mode)return null;
  member(stored,uid);
  // Persist the two-weapon projection before returning a resumed old room.
  // A display-only conversion would fail as soon as the player casts a skill.
  if(stored.status==='active'&&stored.mode==='pve'&&
      needsWeaponSlotUpgrade(member(stored,uid))){
    return db.runTransaction(async tx=>{
      const current=await readRoom(tx,db,stored.id,uid);
      const [userSnap,manualSnap]=await Promise.all([
        tx.get(db.collection('users').doc(uid)),
        tx.get(db.collection(MANUALS).doc(uid))]);
      const upgraded=upgradeLegacyRoomWeapons(current,uid,
        exists(userSnap),exists(manualSnap));
      ensureIntroductions(current,uid,pointer);
      if(upgraded)tx.set(db.collection(ROOMS).doc(current.id),current);
      return snapshot(current,uid);
    });
  }
  if(stored.status==='active')ensureIntroductions(stored,uid,pointer);
  if(stored.status==='waiting'&&stored.createdAtMs<now-15*60000)return command(db,uid,{roomId:stored.id,type:'leave',requestId:crypto.randomUUID()},now);
  if(stored.status==='finished')return withProgress(stored,uid,exists(await db.collection('users').doc(uid).get()));
  if(stored.status!=='active'||stored.mode!=='pvp'||!((stored.deadlineMs&&now>=stored.deadlineMs)||(stored.answerDeadlineMs&&now>=stored.answerDeadlineMs&&stored.actors.some(a=>a.questions<2&&!a.quizExpired))))return snapshot(stored,uid);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,stored.id,uid),s=Rules.expire(raw,now);
    let updates={};if(s!==raw){if(!s.quizRound)delete s.pending?.[raw.turnUid];updates=await settle(tx,db,s);tx.set(db.collection(ROOMS).doc(s.id),s);}return withProgress(s,uid,updates[uid]);
  });
}
async function acknowledgeEnemy(db,uid,input){
  const species=Number(input.species);if(!Number.isInteger(species)||!Rules.MONSTERS[species])throw error('妖獸種類無效',400);
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,input.roomId,uid),pointerRef=db.collection(PLAYERS).doc(uid),pointer=exists(await tx.get(pointerRef));
    if(s.mode!=='pve'||currentRoomId(pointer,roomChannel(s))!==s.id||!s.actors.some(a=>a.bot&&a.species===species))throw error('這不是目前試煉出現的妖獸');
    ensureIntroductions(s,uid,pointer);const seen=seenSpecies(pointer),pending=s.pendingIntroductions[uid];
    if(!pending.includes(species)){
      if(seen.includes(species))return snapshot(s,uid);
      throw error('這種妖獸沒有待閱讀的介紹');
    }
    s.pendingIntroductions[uid]=pending.filter(id=>id!==species);
    tx.set(db.collection(ROOMS).doc(s.id),s);
    tx.set(pointerRef,{...pointer,bestiary:{version:1,seen:[...new Set([...seen,species])].sort((a,b)=>a-b)}});
    return snapshot(s,uid);
  });
}
async function command(db,uid,input,now=Date.now()){
  const id=requestId(input.requestId);if(!id)throw error('行動識別碼無效',400);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,input.roomId,uid);
    if(raw.mode==='pve'&&raw.status==='active'&&
        needsWeaponSlotUpgrade(member(raw,uid))){
      const [userSnap,manualSnap]=await Promise.all([
        tx.get(db.collection('users').doc(uid)),
        tx.get(db.collection(MANUALS).doc(uid))]);
      upgradeLegacyRoomWeapons(raw,uid,exists(userSnap),exists(manualSnap));
    }
    if(raw.receipts?.some(r=>r.uid===uid&&r.id===id))return raw.status==='finished'?withProgress(raw,uid,exists(await tx.get(db.collection('users').doc(uid)))):snapshot(raw,uid);
    const expired=input.type==='leave'?raw:Rules.expire(raw,now);
    if(expired!==raw){const updates=await settle(tx,db,expired);tx.set(db.collection(ROOMS).doc(expired.id),expired);return withProgress(expired,uid,updates[uid]);}
    if(input.type!=='leave'&&Number(input.revision)!==raw.revision&&!(raw.quizRound&&Number.isInteger(input.actionRevision)&&input.actionRevision===raw.actionRevision))throw error('戰場已更新，請重新選擇行動');
    let s=input.type==='leave'?Rules.forfeit(raw,uid,now):Rules.apply(raw,uid,input,now);
    if(s.turn!==raw.turn||input.type==='leave'){delete s.pending?.[uid];delete s.pendingFollowup?.[uid];}
    s.receipts=[...(s.receipts||[]),{uid,id}].slice(-48);
    const updates=s.status==='finished'?await settle(tx,db,s):(await saveManualKills(tx,db,s,uid),{});
    tx.set(db.collection(ROOMS).doc(s.id),s);return withProgress(s,uid,updates[uid]);
  });
}
// Switching a saved preset is free; it is not an attack or a turn.
// Persist both the trusted manual selection and the live actor atomically.
async function switchBattleLoadout(db,uid,input,now=Date.now()){
  const index=input?.index,request=requestId(input?.requestId);
  if(!Number.isInteger(index)||index<0||index>2)throw error('配置不存在',400);
  if(!request)throw error('配置切換識別碼無效',400);
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,input.roomId,uid);
    if(s.mode!=='pve')throw error('只有問道試煉期間可以切換配置',403);
    if(s.receipts?.some(receipt=>receipt.uid===uid&&receipt.id===request))return snapshot(s,uid);
    if(s.status!=='active')throw error('目前不是進行中的戰鬥');
    const userRef=db.collection('users').doc(uid),manualRef=db.collection(MANUALS).doc(uid);
    const [userSnap,manualSnap]=await Promise.all([tx.get(userRef),tx.get(manualRef)]);
    const user=exists(userSnap);if(!user||user.uid&&user.uid!==uid)throw error('玩家資料不存在',404);
    if(Array.isArray(exists(manualSnap)?.weaponIds))
      throw error('新版武器沒有主武器，請直接選擇想施放的武器技能',409);
    const manuals=Manuals.normalize(exists(manualSnap)),preset=manuals.loadouts[index];
    const ids=preset.skillIds;
    if(ids.some(skillId=>!Manuals.unlocked(manuals,skillId)))throw error('此配置包含尚未解鎖的功法技能',403);
    if(new Set(ids.map(skillId=>Manuals.BY_SKILL[skillId].moveId)).size!==ids.length)
      throw error('同一招式不可重複裝備',400);
    const actor=member(s,uid);
    const levels=Object.fromEntries(ids.filter(skillId=>manuals.skillLevels[skillId])
      .map(skillId=>[skillId,manuals.skillLevels[skillId]]));
    actor.manualSkills=[...ids];actor.manualSkillLevels=levels;
    if(s.weaponObjects)s.weaponObjects=WeaponObjects.reconcileEquipment(s.weaponObjects,uid,ids.map(id=>Manuals.BY_SKILL[id]?.manualId).filter(Boolean));
    actor.manualRefinements=manualLoadout(manuals,TrainingAccess.score(user)).manualRefinements;
    actor.manualLoadoutName=preset.name;actor.manualLoadoutIndex=index;
    // HP, stamina, position, focus, cooldown legacy data and action counts survive.
    if(s.pveMetrics&&s.mode==='pve')s.pveMetrics.loadout=[...ids];
    s.revision++;s.updatedAtMs=now;
    s.receipts=[...(s.receipts||[]),{uid,id:request}].slice(-48);
    manuals.activeLoadout=index;manuals.equipped=[...ids];
    tx.set(manualRef,manuals);
    tx.set(db.collection(ROOMS).doc(s.id),s);
    return snapshot(s,uid);
  });
}
async function prepareQuestion(db,uid,id,now=Date.now(),requestedSlot=0){
  if(!roomId(id))throw error('戰場代碼無效',400);
  const batchSlot=requestedSlot===1?1:0;
  // Use the live, server-verified choices from the SAME profile/settings as
  // regular solo practice. The old raid scope discarded selected upper-grade
  // chapters, ignored bank mode, and persisted after scope changes.
  const [roomSnap,userSnap]=await Promise.all([
    db.collection(ROOMS).doc(id).get(),db.collection('users').doc(uid).get()
  ]);
  let s=disarm(exists(roomSnap)),a=member(s,uid);
  const user=exists(userSnap);if(!user)throw error('玩家資料不存在',404);
  const study=StudyScope.snapshot(user),scopeKey=StudyScope.key(study);
  if(!study.level)throw error('請先設定修習年級');
  // Old questions from a previous selection must not be handed out. Clear
  // both slots atomically if either one belongs to a different saved scope.
  const outdated=[s.pending?.[uid],s.pendingFollowup?.[uid]].some(
    q=>q&&q.scopeKey!==scopeKey);
  if(outdated){
    s=await db.runTransaction(async tx=>{
      const current=await readRoom(tx,db,id,uid);
      const freshUser=exists(await tx.get(db.collection('users').doc(uid)));
      if(!freshUser)throw error('玩家資料不存在',404);
      if(StudyScope.key(StudyScope.snapshot(freshUser))!==scopeKey)
        throw error('修習範圍已更新，請重新取得題目');
      if([current.pending?.[uid],current.pendingFollowup?.[uid]].some(q=>q&&q.scopeKey!==scopeKey)){
        delete current.pending?.[uid];delete current.pendingFollowup?.[uid];
        tx.set(db.collection(ROOMS).doc(id),current);
      }
      return current;
    });
    a=member(s,uid);
  }
  Rules.canAnswer(s,uid,now);
  if(a.questions+batchSlot>=Rules.LIMITS.questions)throw error('此輪剩餘題數不足');
  const pending=batchSlot===1?s.pendingFollowup?.[uid]:s.pending?.[uid];
  if(!s.quizRound&&a.stamina>=Rules.LIMITS.stamina&&!pending)
    throw error('請先使用體力，或結束回合');
  const choice=StudyScope.pick(study,user,a.answered+batchSlot);
  // Match main solo's selected-bank subject-specific adaptive difficulty
  // rather than averaging an unrelated subject's learning history.
  if(study.mode==='bank'){
    const normalized={英語閱讀:'英文',數學A:'數學',數學B:'數學',數學甲:'數學',數學乙:'數學',
      地球科學:'地科',自然科學:'自然'};
    const bankSubject=normalized[choice.subject]||choice.subject;
    choice.difficulty=AdaptiveRules.generalDifficulty(user.stats,bankSubject);
  }
  return {roomId:id,turn:s.turn,quizRound:s.quizRound||0,index:a.answered,batchSlot,
    subject:choice.subject,topic:choice.specificTopic,bankSource:choice.bankSource||'',
    adaptiveScope:choice.adaptiveScope||null,
    adaptivePending:[s.pending?.[uid]?.adaptive,s.pendingFollowup?.[uid]?.adaptive]
      .filter(Boolean).map(x=>({scopeId:x.scopeId,conceptId:x.conceptId,facetId:x.facetId})),
    difficulty:choice.difficulty,level:choice.level,scopeKey,
    // Either parallel slot may finish first. Exclude its stored stem from
    // the other slot's candidate pool, including file-bank selections.
    history:[...(s.questionHistory||[]),
      ...(batchSlot===1&&s.pending?.[uid]?[s.pending[uid].q]:[]),
      ...(batchSlot===0&&s.pendingFollowup?.[uid]?[s.pendingFollowup[uid].q]:[])
    ].slice(-24),
    historyMeta:[...(s.questionHistoryMeta||[])].slice(-24),
    pending:publicQuestion(pending)};
}
async function commitQuestion(db,uid,expected,parsed,now=Date.now()){
  const choices=[parsed.correct,...(parsed.wrong||[])].map(v=>Visual.transportText(v,1000));
  if(choices.length!==4||new Set(choices).size!==4||choices.some(v=>!v))throw error('題目選項未通過驗證');
  let answerIndex=0;for(let i=3;i>0;i--){const j=crypto.randomInt(i+1);[choices[i],choices[j]]=[choices[j],choices[i]];if(answerIndex===i)answerIndex=j;else if(answerIndex===j)answerIndex=i;}
  const q={id:crypto.randomUUID(),q:Visual.transportText(parsed.q,4000),opts:choices,answerIndex,explanation:Visual.transportText(parsed.exp,5000),
    subject:expected.subject,topic:expected.topic||String(parsed.sub_topic||'').slice(0,100),
    learningTopic:String(parsed.sub_topic||expected.topic||'本題概念').slice(0,240),
    difficulty:parsed.adaptive?.difficulty||parsed.difficulty||expected.difficulty||'easy',
    // Preserve the very same reasoning and knowledge-point labels used by
    // main's quizMetaFromRaw, rather than discarding them on battle commit.
    meta:{
      ...Knowledge.metadata(parsed,expected.subject),
      concept_id:String(parsed.concept_id||'').slice(0,100),
      template_id:String(parsed.template_id||'').slice(0,120),
      question_form:String(parsed.question_form||'').slice(0,60),
      cognitive_level:Math.max(1,Math.min(5,Number(parsed.cognitive_level)||1)),
      reasoning_steps:Math.max(1,Math.min(6,Number(parsed.reasoning_steps)||1))
    },
    ...(parsed.adaptive?{adaptive:parsed.adaptive}:{}),
    scopeKey:expected.scopeKey,...Knowledge.metadata(parsed,expected.subject),createdAtMs:now};
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,expected.roomId,uid),a=member(s,uid);
    const currentUser=exists(await tx.get(db.collection('users').doc(uid)));
    if(!currentUser||StudyScope.key(StudyScope.snapshot(currentUser))!==expected.scopeKey)
      throw error('修習範圍已變更，請重新取得題目');
    if((s.quizRound?s.quizRound!==expected.quizRound:s.turnUid!==uid||s.turn!==expected.turn)||a.answered!==expected.index)throw error('回合已更新，請重新取得題目');
    try{Rules.canAnswer(s,uid,now);}catch(_){throw error('回合已更新，請重新取得題目');}
    if(a.questions+(expected.batchSlot===1?1:0)>=Rules.LIMITS.questions)throw error('本輪剩餘題數不足');
    const followup=expected.batchSlot===1;
    const existing=followup?s.pendingFollowup?.[uid]:s.pending?.[uid];
    if(existing)return publicQuestion(existing);
    // Slot 1 may be generated and committed while slot 0 is still in flight.
    // Neither draft is visible to the player until slot 0 has been assigned.
    // Both slot orders reject exact duplicates and the transaction remains
    // turn/revision-scoped, so a stale parallel request cannot replace a question.
    const counterpart=followup?s.pending?.[uid]:s.pendingFollowup?.[uid];
    if(counterpart&&counterpart.q===q.q)throw error('兩題內容重複，請重新產生');
    if(followup){s.pendingFollowup||={};s.pendingFollowup[uid]=q;}
    else{s.pending||={};s.pending[uid]=q;}
    tx.set(db.collection(ROOMS).doc(s.id),s);return publicQuestion(q);
  });
}
function sharedSoloQuestion(uid, user, room, input, readReceipt = readSoloReceipt) {
  if (room.mode !== 'pve') throw error('只有問道試煉可使用一般待答題', 400);
  const { question, options, proof, bankId, drawId } = input.soloQuestion;
  if (typeof question !== 'string' || !Array.isArray(options) || options.length < 2 ||
      options.length > 10 || options.some(value => typeof value !== 'string'))
    throw error('待答題目資料無效', 400);

  let q;
  if (bankId) {
    const settings = user.gameSettings || {};
    if (settings.sourceMode !== 'bank' || typeof bankId !== 'string' || !requestId(drawId))
      throw error('所選題庫已變更，請重新取得題目');
    const entry = soloBank.load(settings.source).questions.find(item => item.id === bankId && item.q === question);
    if (entry && JSON.stringify([entry.correct, ...entry.wrong].sort()) === JSON.stringify([...options].sort())) {
      const subject = entry.subject || settings.source.split('/').pop().replace('.json', '');
      q = {
        id: 'bank-' + drawId, q: entry.q, opts: options, answerIndex: options.indexOf(entry.correct),
        explanation: entry.exp || '', subject, topic: entry.sub_topic || '題庫',
        difficulty: entry.difficulty || AdaptiveRules.generalDifficulty(user.stats, subject),
        meta: Knowledge.metadata(entry, subject)
      };
    }
  } else if (proof) {
    q = readReceipt(uid, { proof, question, options });
  }
  if (!q || q.id !== input.questionId) throw error('待答題目驗證失敗，請重新取得題目');
  return q;
}
const soloLogId = (uid, questionId) => crypto.createHash('sha256').update('solo-trial\n'+uid+'\n'+questionId).digest('hex');

async function answer(db,uid,input,now=Date.now(),readReceipt=readSoloReceipt){
  if(!Number.isInteger(input.choice)||input.choice<0||input.choice>(input.soloQuestion?9:3))throw error('選項無效',400);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,input.roomId,uid);
    const userRef=db.collection('users').doc(uid),user=exists(await tx.get(userRef));if(!user)throw error('玩家資料不存在',404);
    if(raw.reviews?.[uid]?.questionId===input.questionId)return withProgress(raw,uid,user);
    const shared = input.soloQuestion;
    const q = shared ? sharedSoloQuestion(uid,user,raw,input,readReceipt) : raw.pending?.[uid];
    if(!q||q.id!==input.questionId)throw error('此題已結算或已失效');
    if(input.choice>=q.opts.length)throw error('選項無效',400);
    const logId = shared ? soloLogId(uid,q.id) : crypto.createHash('sha256').update(raw.id+'\n'+uid+'\n'+q.id).digest('hex');
    const logRef = db.collection('exam_logs').doc(logId);
    if(shared){
      if(input.turn!==raw.turn)throw error('回合已更新，請重新開啟答題');
      const skipRef = db.collection('tacticalSoloQuestionSkips').doc(logId);
      if(raw.questionRefunds?.[q.id]?.uid===uid || exists(await tx.get(logRef)) ||
          exists(await tx.get(skipRef)))
        throw error('此題已結算或已失效');
    } else if(q.scopeKey!==StudyScope.key(StudyScope.snapshot(user))) {
      throw error('修習範圍已變更，請重新取得題目');
    }
    const correct=input.choice===q.answerIndex,s=Rules.answer(raw,uid,correct,now),before=member(raw,uid),after=member(s,uid);
    s.reviews||={};s.reviews[uid]={questionId:q.id,q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,correct,choice:input.choice,answerIndex:q.answerIndex,explanation:q.explanation,gain:after.stamina-before.stamina};
    // Keep only the authoritative shortfall, including the cap at answer time.
    // A review may finish after another answer has replaced the visible review.
    s.answerStamina||={};s.answerStamina[q.id]={uid,shortfall:correct?0:Math.max(0,Math.min(Rules.LIMITS.correct,Rules.LIMITS.stamina-before.stamina)-(after.stamina-before.stamina))};
    s.reviewHistory||={};s.reviewHistory[q.id]={...s.reviews[uid],uid};
    const oldReviewIds=Object.keys(s.reviewHistory);if(oldReviewIds.length>32)delete s.reviewHistory[oldReviewIds[0]];
    if(!shared&&s.pendingFollowup?.[uid])s.pending[uid]=s.pendingFollowup[uid];
    else delete s.pending[uid];
    delete s.pendingFollowup?.[uid];
    s.questionHistory=[...(s.questionHistory||[]),q.q].slice(-24);
    s.questionHistoryMeta=[...(s.questionHistoryMeta||[]),{...q.meta,q:q.q}].slice(-24);
    // Main quiz's two shared learning engines are the source of truth:
    // (1) fixed-point ability footprint, (2) concept mistakes/hard/weak reward.
    // Fine-grained adaptive mastery is written into the SAME transaction, not
    // by a second browser-side write that might race the battle transaction.
    const stats=user.stats||{},learningQuiz={
      data:{q:q.q},learningSubject:q.subject,
      learningTopic:q.learningTopic||q.topic,
      learningDifficulty:q.difficulty,
      recoveryOrigin:q.recoveryOrigin||'',answerSelectedIndex:input.choice
    };
    const learningContext=SoloLearning.context(learningQuiz);
    const learningReward=SoloLearning.reward(stats,learningQuiz,correct,user.profile||{});
    const patch={
      'stats.totalAnswered':Rules.num(stats.totalAnswered)+1,
      'stats.totalCorrect':Rules.num(stats.totalCorrect)+(correct?1:0),
      'stats.knowledgePointMapV1':Knowledge.record(stats.knowledgePointMapV1||{},q,correct)
    };
    const subject=learningContext.subject,topic=learningContext.topic;
    const map={...(stats.knowledgeMap||{})},topics={...(map[subject]||{})},prior=topics[topic]||{};
    topics[topic]={...prior,total:Rules.num(prior.total)+1,correct:Rules.num(prior.correct)+(correct?1:0)};
    map[subject]=topics;patch['stats.knowledgeMap']=map;
    const help=Math.max(0,Math.min(3,Math.floor(Number(input.help)||0)));
    if(q.adaptive?.scopeId){
      patch['stats.adaptiveLearningV1']=AdaptiveRules.record(
        stats.adaptiveLearningV1,q.adaptive,{
          id:q.adaptive.questionId,correct,skipped:false,help,at:now
        });
    }
    const previousScore=Rules.num(stats.totalScore);
    let cultivation=0, answerBonus=null;
    if(s.mode==='pve'){
      patch['stats.soloLearningV1']=learningReward.progress;
      // Main progression awards +1 before 金丹, +2 from 金丹 onward;
      // learning bonuses use the exact main solo rule, not tactical guesses.
      // Existing server-authoritative battle tally remains separate.
      cultivation=correct?(previousScore>=28?2:1)+Growth.cultivation(user,'solo')+learningReward.gain
        :previousScore>=28?-1:0;
      if(correct){
        const manual=exists(await tx.get(db.collection(MANUALS).doc(uid)));
        answerBonus=AnswerBonus.award(stats.answerCultivationV1,cultivation,true,AnswerBonus.maxedWeapons(manual,Manuals));
        cultivation=answerBonus.gain;patch['stats.answerCultivationV1']=answerBonus.state;
      }
      const desired=Math.max(0,previousScore+cultivation);
      const gatePointer=RealmGate.needsRead(stats,desired)?exists(await tx.get(db.collection(PLAYERS).doc(uid))):null;
      Object.assign(patch,RealmGate.patch(stats,desired,gatePointer));
      patch['stats.lastQuizAnswer']={
        question:String(q.q).normalize('NFC').replace(/\s+/g,' ').trim().slice(0,1500),
        isCorrect:correct,scoreBefore:previousScore,scoreAfter:patch['stats.totalScore'],
        penalty:Math.max(0,previousScore-patch['stats.totalScore']),answeredAtMs:now
      };
      patch['stats.currentStreak']=correct?Rules.num(stats.currentStreak)+1:0;
      patch['stats.bestStreak']=Math.max(Rules.num(stats.bestStreak),patch['stats.currentStreak']);
      if(correct){
        patch.questProgress=recordEvent(user.questProgress,'solo');
        if(learningReward.recovery)patch.questProgress=recordEvent(patch.questProgress,'correction');
      }
    }
    // Return actual wallet/progression gains so the same answer review can
    // show them without trusting a client-supplied reward calculation.
    s.reviews[uid].reward={
      cultivation, gold:0, learning:[learningReward.message,AnswerBonus.message(answerBonus)].filter(Boolean).join('；'), ...(answerBonus?{answerBonus}:{})
    };
    s.reviewHistory[q.id].reward=s.reviews[uid].reward;
    const updates=s.status==='finished'?await settle(tx,db,s,{[uid]:patchedUser(user,patch)}):{};
    if(updates[uid]?.stats?.totalScore!==undefined)patch['stats.totalScore']=updates[uid].stats.totalScore;
    if(updates[uid]?.stats?.realmDungeonGateV1)patch['stats.realmDungeonGateV1']=updates[uid].stats.realmDungeonGateV1;
    tx.update(userRef,patch);
    const point=Knowledge.label(q,q.subject);
    tx.set(logRef,{
      uid,question:q.q,options:q.opts,correctIdx:q.answerIndex,userIdx:input.choice,
      isCorrect:correct,explanation:q.explanation,subject:learningContext.subject,subTopic:learningContext.topic,
      knowledgeSubject:point?.subject||'',knowledgePointId:point?.id||'',
      knowledgePoint:point?.name||'',knowledgePoints:Knowledge.labels(q,q.subject),
      questionForm:q.meta?.question_form||'',
      cognitiveLevel:q.meta?.cognitive_level||null,reasoningSteps:q.meta?.reasoning_steps||null,
      conceptId:q.meta?.concept_id||'',
      ...(q.adaptive?{adaptiveScopeId:q.adaptive.scopeId,
        adaptiveConceptId:q.adaptive.conceptId,adaptiveFacetId:q.adaptive.facetId,
        assistanceLevel:help,adaptiveSkipped:false}:{}),
      mode:s.mode==='pve'?'infinite':'duel',topic:s.mode==='pve'?'Solo':'Duel',
      rankAtTime:s.mode==='pve'?'問道獵妖':'戰棋鬥法',
      timestamp:FieldValue.serverTimestamp(),
      timeTaken:Math.max(0,Math.min(86400,Number(input.timeTaken)||0))
    });
    tx.set(db.collection(ROOMS).doc(s.id),s);return withProgress(s,uid,patchedUser(updates[uid]||user,patch));
  });
}
async function refundQuestionStamina(db,uid,id,questionId,shared){
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,id,uid),a=member(s,uid);
    const user=exists(await tx.get(db.collection('users').doc(uid)));if(!user)throw error('玩家資料不存在',404);
    const previous=s.questionRefunds?.[questionId];
    if(previous?.uid===uid)return {staminaAdded:0,staminaRefunded:previous.amount,staminaReplayed:true,questionSkipped:previous.skipped,battle:withProgress(s,uid,user)};
    let amount=0,skipped=false,skipRef;
    if(s.status==='active'){
      const pending=s.pending?.[uid],record=s.answerStamina?.[questionId],answered=s.reviews?.[uid];
      let shortfall=0;
      if(pending?.id===questionId||s.pendingFollowup?.[uid]?.id===questionId){
        Rules.canAnswer(s,uid);skipped=true;shortfall=Rules.LIMITS.correct;
        const isFollowup=s.pendingFollowup?.[uid]?.id===questionId;
        const discarded=isFollowup?s.pendingFollowup[uid]:pending;
        a.questions++;
        if(!isFollowup){
          if(s.pendingFollowup?.[uid])s.pending[uid]=s.pendingFollowup[uid];
          else delete s.pending[uid];
        }
        delete s.pendingFollowup?.[uid];
        s.questionHistory=[...(s.questionHistory||[]),discarded.q].slice(-24);
      }else if(record?.uid===uid)shortfall=record.shortfall;
      else if(shared && !s.reviewHistory?.[questionId] && s.turn===shared.turn){
        const logId=soloLogId(uid,questionId);
        const ref=db.collection('tacticalSoloQuestionSkips').doc(logId);
        const [answeredSnap, skippedSnap]=await Promise.all([
          tx.get(db.collection('exam_logs').doc(logId)),tx.get(ref)
        ]);
        if(!exists(answeredSnap)&&!exists(skippedSnap)){
          try {
            Rules.canAnswer(s,uid);
            a.questions++;
            skipped=true;
            shortfall=Rules.LIMITS.correct;
            skipRef=ref;
          } catch (_) { /* The battle moved on during independent review. */ }
        }
      }
      // Backward compatibility for an answer made before the shortfall ledger existed.
      else if(answered?.questionId===questionId&&!answered.correct)shortfall=Math.max(0,Rules.LIMITS.correct-Rules.num(answered.gain));
      amount=Math.min(Rules.num(shortfall),Math.max(0,Rules.LIMITS.stamina-a.stamina));
      a.stamina+=amount;
    }
    s.questionRefunds||={};s.questionRefunds[questionId]={uid,amount,skipped};
    delete s.answerStamina?.[questionId];
    s.revision++;s.updatedAtMs=Date.now();
    if(amount){
      s.eventSequence=(s.eventSequence||0)+1;
      s.events=[...s.events,{id:s.revision+':'+s.eventSequence,type:'answer',actor:uid,gain:amount,text:a.name+'錯題確認，返還 '+amount+' 體力',
        animation:{kind:'answer',changes:[{uid,hp:a.hp,shield:a.shield,stamina:a.stamina,guard:a.guard,slow:a.slow}],numbers:[{uid,gain:amount}]}}].slice(-Rules.LIMITS.events);
    }
    if(skipRef)tx.set(skipRef,{uid,questionId,roomId:s.id});
    tx.set(db.collection(ROOMS).doc(s.id),s);
    return {staminaAdded:amount,staminaRefunded:amount,staminaReplayed:false,questionSkipped:skipped,battle:withProgress(s,uid,user)};
  });
}
async function reportQuestion(db,uid,input,{review,award,readReceipt=readSoloReceipt}={}){
  const reports=require('./question-report-api.cjs').__test;
  if(!roomId(input.roomId))throw error('戰場代碼無效',400);
  const s=exists(await db.collection(ROOMS).doc(input.roomId).get());member(s,uid);
  if(s.mode!=='pve')throw error('問道試煉才能使用此回報入口',400);
  if(String(input.reason||'').normalize('NFC').replace(/\s+/g,' ').trim().length<6)throw error('請具體描述題目的錯誤，至少輸入 6 個字元。',400);
  if(s.questionRefunds?.[input.questionId]?.uid===uid)return {status:'duplicate',valid:true,compensated:false,reason:'本題已完成錯題審核及體力補正，不會重複發放獎勵。',...await refundQuestionStamina(db,uid,s.id,input.questionId)};
  let q=s.pending?.[uid]?.id===input.questionId?s.pending[uid]:s.pendingFollowup?.[uid]?.id===input.questionId?s.pendingFollowup[uid]:s.reviewHistory?.[input.questionId]?.uid===uid?s.reviewHistory[input.questionId]:s.reviews?.[uid]?.questionId===input.questionId?s.reviews[uid]:null;
  let shared;
  if(input.soloQuestion){
    const user=exists(await db.collection('users').doc(uid).get());
    if(!user)throw error('玩家資料不存在',404);
    const verified=sharedSoloQuestion(uid,user,s,input,readReceipt);
    if(!q)shared={turn:input.turn};
    q||=verified;
  }
  if(!q)throw error('題目已變更，請回到目前題目重新回報');
  const trusted=reports.validateReport({question:q.q,options:q.opts,correctIndex:q.answerIndex,explanation:q.explanation,userReason:input.reason});
  if(trusted.error)throw error(trusted.error,400);
  const claim=exists(await db.collection('questionErrorCompensations').doc(reports.reportKey(uid,trusted.question)).get());
  const approved=claim?.uid===uid&&claim.question===trusted.question&&claim.correctIndex===trusted.correctIndex&&
    claim.explanation===trusted.explanation&&JSON.stringify(claim.options)===JSON.stringify(trusted.options);
  const result=approved?{status:'confirmed',reason:claim.reviewReason,issueType:claim.issueType}:await (review||reports.reviewQuestion)(trusted,{trusted:true});
  if(result.status==='unavailable')throw error(result.reason,503);
  if(result.status==='confirmed'){
    // The trial pays currency at stage settlement. Correcting a question
    // still applies the cultivation compensation and stamina refund once.
    const outcome=await (award||reports.awardOnce)(db,uid,trusted,result,{goldReward:0});
    const stamina=await refundQuestionStamina(db,uid,s.id,input.questionId,shared);
    // A verified question can still hit the daily reward cap, or replay a
    // previously committed award. Never overwrite the payment outcome status.
    return {...outcome,valid:true,reason:'獨立審核已確認本題有誤。'+
      (outcome.status==='limit'||outcome.status==='duplicate'?' '+outcome.reason:''),...stamina};
  }
  // Before answering, never reveal the answer through an AI review reason.
  return (shared||s.pending?.[uid]?.id===input.questionId||s.pendingFollowup?.[uid]?.id===input.questionId)?{...result,reason:result.status==='rejected'?'獨立審核未確認本題有實質錯誤。':result.reason}:result;
}
// Review the authenticated room question or the same verified solo question
// accepted by PvE grading. Automatic review only returns a submission status.
async function reviewMathIssue(db,uid,input,{review,readReceipt=readSoloReceipt}={}){
  if(!roomId(input?.roomId))throw error('戰場代碼無效',400);
  const s=exists(await db.collection(ROOMS).doc(input.roomId).get());
  member(s,uid);
  const questionId=String(input.questionId||'');
  let q=s.pending?.[uid]?.id===questionId?s.pending[uid]:
    s.pendingFollowup?.[uid]?.id===questionId?s.pendingFollowup[uid]:
    s.reviewHistory?.[questionId]?.uid===uid?s.reviewHistory[questionId]:
    s.reviews?.[uid]?.questionId===questionId?s.reviews[uid]:null;
  if(!q&&s.mode==='pve'&&input.soloQuestion){
    const user=exists(await db.collection('users').doc(uid).get());
    if(!user)throw error('玩家資料不存在',404);
    q=sharedSoloQuestion(uid,user,s,input,readReceipt);
  }
  if(!q)throw error('目前沒有這道可送審的題目',409);
  const reports=require('./question-report-api.cjs').__test;
  const evidence=reports.validateReport({question:q.q,options:q.opts,
    correctIndex:q.answerIndex,explanation:q.explanation,
    userReason:'玩家作答時 MathJax 無法解析公式，TeX 顯示成原始文字。請審查題幹與選項的公式和排版。'});
  if(evidence.error)throw error(evidence.error,400);
  const result=await (review||reports.reviewQuestion)(evidence,{trusted:true});
  if(result.status==='unavailable')throw error(result.reason,503);
  // Background reviews cannot reveal answers or race grading for compensation.
  return {status:result.status,submitted:true};
}
// Only trusted server construction can enable development dungeons. Never read
// this flag from query/body/headers or a client-side preference.
function register(app,{resolve=()=>playerRepository.resolve(),verify=verifyMainIdentity,logger=console,allowHiddenWeaponDungeons=false}={}){
  const dungeonAccess=Object.freeze({allowHidden:allowHiddenWeaponDungeons===true});
  const route=fn=>async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{const uid=await verify(req),result=await fn(resolve().db,uid,req);return res.json({ok:true,state:result});}
    catch(e){
      if(!e.status)logger.error('[Tactical combat]',{
        path:req.path,action:req.body?.type,skill:req.body?.skillId,code:e.code,message:e.message
      });
      return res.status(e.status||503).json({ok:false,error:e.status?e.message:'戰場同步失敗，請稍後重試'});
    }
  };
  app.get('/api/tactical/state',route((db,uid,req)=>state(db,uid,Date.now(),req.query?.mode||'')));
  app.get('/api/tactical/weapon-dungeons',route((db,uid)=>weaponDungeonState(db,uid,Date.now(),dungeonAccess)));
  app.get('/api/tactical/manuals',route((db,uid)=>manualsState(db,uid)));
  app.post('/api/tactical/manuals/school',route((db,uid,req)=>chooseSchool(db,uid,req.body)));
  app.post('/api/tactical/manuals/loadout',route((db,uid,req)=>updateLoadout(db,uid,req.body)));
  app.post('/api/tactical/manuals/equip',route((db,uid,req)=>equipManualSkills(db,uid,req.body)));
  app.post('/api/tactical/manuals/upgrade',route((db,uid,req)=>upgradeManual(db,uid,req.body)));
  app.post('/api/tactical/manuals/skills/upgrade',route((db,uid,req)=>upgradeSkill(db,uid,req.body)));
  app.post('/api/tactical/start',route((db,uid,req)=>start(db,uid,req.body,Date.now(),dungeonAccess)));
  app.post('/api/tactical/action',route((db,uid,req)=>command(db,uid,req.body)));
  app.post('/api/tactical/loadout',route((db,uid,req)=>switchBattleLoadout(db,uid,req.body)));
  app.post('/api/tactical/answer',route((db,uid,req)=>answer(db,uid,req.body)));
  app.post('/api/tactical/acknowledge-enemy',route((db,uid,req)=>acknowledgeEnemy(db,uid,req.body)));
  app.post('/api/tactical/report-question',route((db,uid,req)=>reportQuestion(db,uid,req.body)));
  app.post('/api/tactical/review-math-issue',route((db,uid,req)=>reviewMathIssue(db,uid,req.body)));
}
module.exports=register;
module.exports.__test={weaponDungeonState,settle,ROOMS,PLAYERS,MANUALS,reviewMathIssue,manualsState,chooseSchool,equipManualSkills,updateLoadout,switchBattleLoadout,upgradeManual,upgradeSkill,applyManualKills,rollManualDrop,roomId,member,snapshot,playerActor,trialProgress,rewardFor,start,state,command,acknowledgeEnemy,prepareQuestion,commitQuestion,answer,reportQuestion};
