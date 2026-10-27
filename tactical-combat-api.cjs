'use strict';
const crypto=require('node:crypto');
const Rules=require('./public/cultivation/tactical-rules.js');
const Weapons=require('./public/cultivation/weapon-system-rules.js');
const Knowledge=require('./public/cultivation/knowledge-points.js');
const Growth=require('./public/cultivation/nascent-growth.js');
const Gold=require('./public/cultivation/answer-gold-rules.js');
const {recordEvent}=require('./public/cultivation/quest-rules.js');
const {trustedRaidPlayerSnapshot,pickTrustedRaidKnowledge}=require('./raid-authority.cjs');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const {FieldValue}=require('./storage-values.cjs');
// New server-only documents share the player repository so answers, rewards and
// stamina commit atomically under the existing Firestore/D1 adapter.
const ROOMS='tacticalBattleRooms',PLAYERS='tacticalBattlePlayers';
const error=(message,status=409)=>Object.assign(new Error(message),{status});
const roomId=value=>/^arena-[a-f0-9]{16}$/.test(String(value))?String(value):'';
const requestId=value=>/^[A-Za-z0-9_-]{8,100}$/.test(String(value))?String(value):'';
const copy=v=>JSON.parse(JSON.stringify(v));
const exists=s=>s?.exists?s.data():null;
function member(s,uid){const a=s?.actors?.find(a=>a.uid===uid&&!a.bot);if(!a)throw error('你不是此戰場的參戰玩家',403);return a;}
function publicQuestion(q){return q?{id:q.id,q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,...Knowledge.metadata(q,q.subject)}:null;}
const seenSpecies=pointer=>[...new Set((Array.isArray(pointer?.bestiary?.seen)?pointer.bestiary.seen:[]).filter(id=>Number.isInteger(id)&&!!Rules.MONSTERS[id]))];
function ensureIntroductions(s,uid,pointer){
  if(s.mode!=='pve'||Array.isArray(s.pendingIntroductions?.[uid]))return false;
  const seen=new Set(seenSpecies(pointer));s.pendingIntroductions||={};
  s.pendingIntroductions[uid]=[...new Set(s.actors.filter(a=>a.bot&&Rules.MONSTERS[a.species]&&!seen.has(a.species)).map(a=>a.species))];
  return true;
}
function snapshot(s,uid){
  if(!s)return null;member(s,uid);
  const out=copy(s);delete out.pending;delete out.reviews;delete out.receipts;delete out.answerStamina;delete out.questionRefunds;
  out.newEnemies=s.mode==='pve'?[...(s.pendingIntroductions?.[uid]||[])]:[];delete out.pendingIntroductions;
  out.question=s.status==='active'&&(s.quizRound||s.turnUid===uid)?publicQuestion(s.pending?.[uid]):null;
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
function playerActor(user,uid,selection,catalog,armory){
  const trusted=trustedRaidPlayerSnapshot({...user,artifactSystem:{...(user.artifactSystem||{}),equipped:{}}},uid,catalog),type=trusted.goldenCore?.type||'none';
  const branch=Rules.savedBranch(user,type).id;
  const weapon=Weapons.snapshot(armory),multiplier=Weapons.attackMultiplier(weapon);
  return {...trusted,atk:Math.round(trusted.atk*multiplier),baseAtk:Math.round(trusted.baseAtk*multiplier),enemyScaleAttack:trusted.atk,weapon,
    core:type,branch,gender:user.storyProgressV1?.gender==='female'?'female':'male',shield:0};
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
  if(s.mode==='pve')return win&&a.correct>0?{gold:s.trial?35+Math.min(100,Rules.num(s.trial.stage-1)*5):35+Rules.MAPS.findIndex(m=>m.id===s.map)*25,cultivation:2+Growth.cultivation(user,'solo'),win}:null;
  if(s.actors.filter(p=>!p.bot).reduce((n,p)=>n+p.answered,0)<2)return null;
  return {gold:win?500:draw?250:200,cultivation:win?5+Growth.cultivation(user,'battle'):draw?2:0,win,draw};
}
async function settle(tx,db,s){
  const updates={};if(s.status!=='finished')return updates;
  const people=s.actors.filter(a=>!a.bot&&!s.rewarded.includes(a.uid));
  const [users,pointers,armories]=await Promise.all([
    Promise.all(people.map(a=>tx.get(db.collection('users').doc(a.uid)))),
    Promise.all(people.map(a=>tx.get(db.collection(PLAYERS).doc(a.uid)))),
    Promise.all(people.map(a=>tx.get(db.collection('weaponArmories').doc(a.uid))))
  ]);
  people.forEach((a,i)=>{
    const u=exists(users[i]);if(!u)return;const reward=rewardFor(s,a,u);
    s.rewarded.push(a.uid);s.rewards||={};s.rewards[a.uid]=reward||{gold:0,cultivation:0,win:s.winner===a.team};
    const patch={};
    const pointer=exists(pointers[i]),campaign=pointer?.trial;
    if(s.mode==='pve'&&s.trial&&s.winner===a.team&&s.finishReason==='hp'&&pointer?.roomId===s.id&&
       campaign?.seed===s.trial.seed&&campaign.stage===s.trial.stage){
      const next={...campaign,stage:Math.min(1000000,campaign.stage+1),best:Math.max(campaign.best||0,campaign.stage)};
      patch.tacticalTrialV1=next;s.nextStage=next.stage;
      tx.set(db.collection(PLAYERS).doc(a.uid),{...pointer,trial:next});
      if(a.correct>0){const earned=Weapons.grantTrial(exists(armories[i]),campaign.stage);
        if(earned.earned){patch.weaponSystemV1=earned.state;s.weaponRewards||={};s.weaponRewards[a.uid]={chests:earned.earned};tx.set(db.collection('weaponArmories').doc(a.uid),earned.state);}}
    }
    if(reward){patch['stats.gold']=Rules.num(u.stats?.gold)+reward.gold;patch['stats.totalScore']=Rules.num(u.stats?.totalScore)+reward.cultivation;}
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
  const s=exists(await tx.get(db.collection(ROOMS).doc(id)));if(!s)throw error('戰場不存在',404);member(s,uid);return s;
}
async function start(db,uid,selection={},now=Date.now()){
  const mode=selection.mode==='pvp'?'pvp':'pve',map=Rules.mapFor(selection.map).id;
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
    const [pointerSnap,userSnap,catalogSnap,armorySnap]=await Promise.all([tx.get(pointerRef),tx.get(userRef),tx.get(db.collection('gameConfig').doc('artifactCatalogV1')),tx.get(db.collection('weaponArmories').doc(uid))]);
    const user=exists(userSnap);if(!user||user.uid&&user.uid!==uid)throw error('玩家資料不存在',404);
    const pointer=exists(pointerSnap)||{},priorId=pointer.roomId;
    const prior=priorId?exists(await tx.get(db.collection(ROOMS).doc(priorId))):null;
    const campaign=trialProgress(pointer.trial,seed);
    if(prior?.status==='active'){
      // Resume old unfinished trials without moving actors or discarding a question.
      let changed=false;
      if(prior.mode==='pve'&&!prior.trial){
        prior.trial={version:1,seed:campaign.seed,stage:campaign.stage,layoutVersion:0,title:Rules.mapFor(prior.map).name};
        changed=true;tx.set(pointerRef,{...pointer,trial:campaign});
      }
      changed=ensureIntroductions(prior,uid,pointer)||changed;
      if(changed)tx.set(db.collection(ROOMS).doc(prior.id),prior);
      return snapshot(prior,uid);
    }
    if(prior?.status==='waiting'&&mode!=='pvp')throw error('請先取消正在等待的鬥法');
    const candidate=wanted||candidates.find(s=>!s.actors.some(a=>a.uid===uid)&&(!prior||s.id<prior.id))?.id;
    const target=candidate?exists(await tx.get(db.collection(ROOMS).doc(candidate))):null;
    if(wanted&&(!target||target.status!=='waiting'||target.createdAtMs<now-15*60000))throw error('此戰場已開始或已失效');
    const a=playerActor(user,uid,selection,exists(catalogSnap)||{},exists(armorySnap));
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
      const retry=mode==='pve'&&prior?.trial?.seed===campaign.seed&&prior.trial.stage===campaign.stage&&prior.winner!=='player';
      const trial={...campaign,layoutVersion:retry?(prior.trial.layoutVersion??1):2};
      s=attachScopes(Rules.create({id:newId,mode,map:retry&&trial.layoutVersion===0?prior.map:map,players:[a],trial:mode==='pve'?trial:null,now}),[a]);
      // Actor construction deliberately limits public combat fields.
      s.actors[0].baseAtk=a.baseAtk;s.actors[0].baseMaxHp=a.baseMaxHp;s.actors[0].trainingAccessScore=a.trainingAccessScore;
    }
    if(s.mode==='pvp'&&s.actors.length===2){const p=s.actors.find(p=>p.uid===uid);p.baseAtk=a.baseAtk;p.baseMaxHp=a.baseMaxHp;p.trainingAccessScore=a.trainingAccessScore;}
    ensureIntroductions(s,uid,pointer);
    if(prior?.status==='waiting'&&prior.id!==s.id)tx.set(db.collection(ROOMS).doc(prior.id),Rules.forfeit(prior,uid,now));
    tx.set(db.collection(ROOMS).doc(s.id),s);tx.set(pointerRef,{...pointer,roomId:s.id,...(mode==='pve'?{trial:campaign}:{})});
    const preferences={['tacticalPreferences.'+a.core]:a.branch,...(mode==='pve'?{tacticalTrialV1:campaign}:{})};
    tx.update(userRef,preferences);return snapshot(s,uid);
  });
}
async function state(db,uid,now=Date.now()){
  const pointer=exists(await db.collection(PLAYERS).doc(uid).get());if(!pointer?.roomId)return null;
  // No write for ordinary reads. Only an expired PvP turn requires a transaction.
  const stored=exists(await db.collection(ROOMS).doc(pointer.roomId).get());if(!stored)return null;
  member(stored,uid);
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
    if(s.mode!=='pve'||pointer?.roomId!==s.id||!s.actors.some(a=>a.bot&&a.species===species))throw error('這不是目前試煉出現的妖獸');
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
    if(raw.receipts?.some(r=>r.uid===uid&&r.id===id))return raw.status==='finished'?withProgress(raw,uid,exists(await tx.get(db.collection('users').doc(uid)))):snapshot(raw,uid);
    const expired=input.type==='leave'?raw:Rules.expire(raw,now);
    if(expired!==raw){const updates=await settle(tx,db,expired);tx.set(db.collection(ROOMS).doc(expired.id),expired);return withProgress(expired,uid,updates[uid]);}
    if(input.type!=='leave'&&Number(input.revision)!==raw.revision&&!(raw.quizRound&&Number.isInteger(input.actionRevision)&&input.actionRevision===raw.actionRevision))throw error('戰場已更新，請重新選擇行動');
    let s=input.type==='leave'?Rules.forfeit(raw,uid,now):Rules.apply(raw,uid,input,now);
    if(input.type==='end'||input.type==='leave')delete s.pending?.[uid];
    s.receipts=[...(s.receipts||[]),{uid,id}].slice(-48);
    const updates=await settle(tx,db,s);tx.set(db.collection(ROOMS).doc(s.id),s);return withProgress(s,uid,updates[uid]);
  });
}
async function prepareQuestion(db,uid,id,now=Date.now()){
  if(!roomId(id))throw error('戰場代碼無效',400);
  const s=exists(await db.collection(ROOMS).doc(id).get()),a=member(s,uid);
  Rules.canAnswer(s,uid,now);
  if(!s.quizRound&&a.stamina>=Rules.LIMITS.stamina)throw error('請先使用體力，或結束回合');
  const scope=pickTrustedRaidKnowledge(a.knowledgeScope,a.answered+1);
  return {roomId:id,turn:s.turn,quizRound:s.quizRound||0,index:a.answered,subject:scope.subject,topic:scope.specificTopic,
    difficulty:scope.difficulty,level:scope.level,history:(s.questionHistory||[]).slice(-24),pending:publicQuestion(s.pending?.[uid])};
}
async function commitQuestion(db,uid,expected,parsed,now=Date.now()){
  const choices=[parsed.correct,...(parsed.wrong||[])].map(v=>String(v||'').trim().slice(0,1000));
  if(choices.length!==4||new Set(choices).size!==4||choices.some(v=>!v))throw error('題目選項未通過驗證');
  let answerIndex=0;for(let i=3;i>0;i--){const j=crypto.randomInt(i+1);[choices[i],choices[j]]=[choices[j],choices[i]];if(answerIndex===i)answerIndex=j;else if(answerIndex===j)answerIndex=i;}
  const q={id:crypto.randomUUID(),q:String(parsed.q).slice(0,4000),opts:choices,answerIndex,explanation:String(parsed.exp||'').slice(0,5000),
    subject:expected.subject,topic:expected.topic||String(parsed.sub_topic||'').slice(0,100),...Knowledge.metadata(parsed,expected.subject),createdAtMs:now};
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,expected.roomId,uid),a=member(s,uid);
    if((s.quizRound?s.quizRound!==expected.quizRound:s.turnUid!==uid||s.turn!==expected.turn)||a.answered!==expected.index)throw error('回合已更新，請重新取得題目');
    try{Rules.canAnswer(s,uid,now);}catch(_){throw error('回合已更新，請重新取得題目');}
    if(s.pending?.[uid])return publicQuestion(s.pending[uid]);
    s.pending||={};s.pending[uid]=q;
    tx.set(db.collection(ROOMS).doc(s.id),s);return publicQuestion(q);
  });
}
async function answer(db,uid,input,now=Date.now()){
  if(!Number.isInteger(input.choice)||input.choice<0||input.choice>3)throw error('選項無效',400);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,input.roomId,uid);
    const userRef=db.collection('users').doc(uid),user=exists(await tx.get(userRef));if(!user)throw error('玩家資料不存在',404);
    if(raw.reviews?.[uid]?.questionId===input.questionId)return withProgress(raw,uid,user);
    const q=raw.pending?.[uid];if(!q||q.id!==input.questionId)throw error('此題已結算或已失效');
    const correct=input.choice===q.answerIndex,s=Rules.answer(raw,uid,correct,now),before=member(raw,uid),after=member(s,uid);
    s.reviews||={};s.reviews[uid]={questionId:q.id,q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,correct,choice:input.choice,answerIndex:q.answerIndex,explanation:q.explanation,gain:after.stamina-before.stamina};
    // Keep only the authoritative shortfall, including the cap at answer time.
    // A review may finish after another answer has replaced the visible review.
    s.answerStamina||={};s.answerStamina[q.id]={uid,shortfall:correct?0:Math.max(0,Math.min(Rules.LIMITS.correct,Rules.LIMITS.stamina-before.stamina)-(after.stamina-before.stamina))};
    delete s.pending[uid];s.questionHistory=[...(s.questionHistory||[]),q.q].slice(-24);
    const stats=user.stats||{},patch={'stats.totalAnswered':Rules.num(stats.totalAnswered)+1,
      'stats.totalCorrect':Rules.num(stats.totalCorrect)+(correct?1:0),
      'stats.knowledgePointMapV1':Knowledge.record(stats.knowledgePointMapV1||{},q,correct)};
    const topic=['__proto__','constructor','prototype'].includes(q.topic)?'本題概念':q.topic||'本題概念';
    const map={...(stats.knowledgeMap||{})},topics={...(map[q.subject]||{})},prior=topics[topic]||{};
    topics[topic]={...prior,total:Rules.num(prior.total)+1,correct:Rules.num(prior.correct)+(correct?1:0)};map[q.subject]=topics;patch['stats.knowledgeMap']=map;
    // Preserve normal solo progression, with server-derived amounts.
    if(s.mode==='pve'){
      const gain=correct?1+Growth.cultivation(user,'solo'):Rules.num(stats.totalScore)>=28?-1:0;
      patch['stats.totalScore']=Math.max(0,Rules.num(stats.totalScore)+gain);
      patch['stats.lastQuizAnswer']={question:q.q,isCorrect:correct,scoreBefore:Rules.num(stats.totalScore),scoreAfter:patch['stats.totalScore'],
        penalty:Math.max(0,Rules.num(stats.totalScore)-patch['stats.totalScore']),answeredAtMs:now};
      patch['stats.currentStreak']=correct?Rules.num(stats.currentStreak)+1:0;
      patch['stats.bestStreak']=Math.max(Rules.num(stats.bestStreak),patch['stats.currentStreak']);
      if(correct){patch['stats.gold']=Rules.num(stats.gold)+Gold.perCorrect(stats.totalScore);patch.questProgress=recordEvent(user.questProgress,'solo');}
    }
    const logId=crypto.createHash('sha256').update(s.id+'\n'+uid+'\n'+q.id).digest('hex');
    tx.update(userRef,patch);
    tx.set(db.collection('exam_logs').doc(logId),{uid,question:q.q,options:q.opts,correctIdx:q.answerIndex,userIdx:input.choice,
      isCorrect:correct,explanation:q.explanation,subject:q.subject,subTopic:q.topic,...Knowledge.metadata(q,q.subject),
      mode:s.mode==='pve'?'infinite':'duel',topic:s.mode==='pve'?'Solo':'Duel',rankAtTime:s.mode==='pve'?'問道獵妖':'戰棋鬥法',
      timestamp:FieldValue.serverTimestamp(),timeTaken:Math.max(0,now-q.createdAtMs)});
    tx.set(db.collection(ROOMS).doc(s.id),s);return withProgress(s,uid,patchedUser(user,patch));
  });
}
async function refundQuestionStamina(db,uid,id,questionId){
  return db.runTransaction(async tx=>{
    const s=await readRoom(tx,db,id,uid),a=member(s,uid);
    const user=exists(await tx.get(db.collection('users').doc(uid)));if(!user)throw error('玩家資料不存在',404);
    const previous=s.questionRefunds?.[questionId];
    if(previous?.uid===uid)return {staminaAdded:0,staminaRefunded:previous.amount,staminaReplayed:true,questionSkipped:previous.skipped,battle:withProgress(s,uid,user)};
    let amount=0,skipped=false;
    if(s.status==='active'){
      const pending=s.pending?.[uid],record=s.answerStamina?.[questionId],answered=s.reviews?.[uid];
      let shortfall=0;
      if(pending?.id===questionId){
        Rules.canAnswer(s,uid);skipped=true;shortfall=Rules.LIMITS.correct;
        a.questions++;delete s.pending[uid];
        s.questionHistory=[...(s.questionHistory||[]),pending.q].slice(-24);
      }else if(record?.uid===uid)shortfall=record.shortfall;
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
        animation:{kind:'answer',changes:[{uid,hp:a.hp,shield:a.shield,stamina:a.stamina,guard:a.guard,slow:a.slow}],numbers:[{uid,gain:amount}]}}].slice(-28);
    }
    tx.set(db.collection(ROOMS).doc(s.id),s);
    return {staminaAdded:amount,staminaRefunded:amount,staminaReplayed:false,questionSkipped:skipped,battle:withProgress(s,uid,user)};
  });
}
async function reportQuestion(db,uid,input,{review,award}={}){
  const reports=require('./question-report-api.cjs').__test;
  if(!roomId(input.roomId))throw error('戰場代碼無效',400);
  const s=exists(await db.collection(ROOMS).doc(input.roomId).get());member(s,uid);
  if(s.mode!=='pve')throw error('問道試煉才能使用此回報入口',400);
  if(String(input.reason||'').normalize('NFC').replace(/\s+/g,' ').trim().length<6)throw error('請具體描述題目的錯誤，至少輸入 6 個字元。',400);
  if(s.questionRefunds?.[input.questionId]?.uid===uid)return {status:'duplicate',compensated:false,reason:'本題已完成錯題補償。',...await refundQuestionStamina(db,uid,s.id,input.questionId)};
  const q=s.pending?.[uid]?.id===input.questionId?s.pending[uid]:s.reviews?.[uid]?.questionId===input.questionId?s.reviews[uid]:null;
  if(!q)throw error('題目已變更，請回到目前題目重新回報');
  const trusted=reports.validateReport({question:q.q,options:q.opts,correctIndex:q.answerIndex,explanation:q.explanation,userReason:input.reason});
  if(trusted.error)throw error(trusted.error,400);
  const claim=exists(await db.collection('questionErrorCompensations').doc(reports.reportKey(uid,trusted.question)).get());
  const approved=claim?.uid===uid&&claim.question===trusted.question&&claim.correctIndex===trusted.correctIndex&&
    claim.explanation===trusted.explanation&&JSON.stringify(claim.options)===JSON.stringify(trusted.options);
  const result=approved?{status:'confirmed',reason:claim.reviewReason,issueType:claim.issueType}:await (review||reports.reviewQuestion)(trusted);
  if(result.status==='unavailable')throw error(result.reason,503);
  if(result.status==='confirmed'){
    // Currency and combat stamina have separate idempotent receipts. A lost
    // response or a failed stamina transaction can safely retry a currency award.
    const outcome=await (award||reports.awardOnce)(db,uid,trusted,result);
    return {...outcome,status:'confirmed',reason:'獨立審核已確認本題有誤。'+(outcome.status==='limit'?outcome.reason:''),...await refundQuestionStamina(db,uid,s.id,input.questionId)};
  }
  // Before answering, never reveal the answer through an AI review reason.
  return s.pending?.[uid]?.id===input.questionId?{...result,reason:result.status==='rejected'?'獨立審核未確認本題有實質錯誤。':result.reason}:result;
}
function register(app,{resolve=()=>playerRepository.resolve(),verify=verifyMainIdentity,logger=console}={}){
  const route=fn=>async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{const uid=await verify(req),result=await fn(resolve().db,uid,req);return res.json({ok:true,state:result});}
    catch(e){if(!e.status)logger.error('[Tactical combat]',e?.message||e);return res.status(e.status||503).json({ok:false,error:e.status?e.message:'戰場同步失敗，請稍後重試'});}
  };
  app.get('/api/tactical/state',route((db,uid)=>state(db,uid)));
  app.post('/api/tactical/start',route((db,uid,req)=>start(db,uid,req.body)));
  app.post('/api/tactical/action',route((db,uid,req)=>command(db,uid,req.body)));
  app.post('/api/tactical/answer',route((db,uid,req)=>answer(db,uid,req.body)));
  app.post('/api/tactical/acknowledge-enemy',route((db,uid,req)=>acknowledgeEnemy(db,uid,req.body)));
  app.post('/api/tactical/report-question',route((db,uid,req)=>reportQuestion(db,uid,req.body)));
}
module.exports=register;
module.exports.__test={ROOMS,PLAYERS,roomId,member,snapshot,playerActor,trialProgress,rewardFor,start,state,command,acknowledgeEnemy,prepareQuestion,commitQuestion,answer,reportQuestion};
