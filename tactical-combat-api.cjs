'use strict';
const crypto=require('node:crypto');
const Rules=require('./public/cultivation/tactical-rules.js');
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
function snapshot(s,uid){
  if(!s)return null;member(s,uid);
  const out=copy(s);delete out.pending;delete out.reviews;delete out.receipts;
  out.question=s.turnUid===uid?publicQuestion(s.pending?.[uid]):null;
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
function playerActor(user,uid,selection,catalog){
  const trusted=trustedRaidPlayerSnapshot(user,uid,catalog),type=trusted.goldenCore?.type||'none';
  const branch=Rules.savedBranch(user,type).id;
  return {...trusted,core:type,branch,gender:user.storyProgressV1?.gender==='female'?'female':'male',shield:trusted.artifactShield||0};
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
  const [users,pointers]=await Promise.all([
    Promise.all(people.map(a=>tx.get(db.collection('users').doc(a.uid)))),
    Promise.all(people.map(a=>tx.get(db.collection(PLAYERS).doc(a.uid))))
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
    const [pointerSnap,userSnap,catalogSnap]=await Promise.all([tx.get(pointerRef),tx.get(userRef),tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);
    const user=exists(userSnap);if(!user||user.uid&&user.uid!==uid)throw error('玩家資料不存在',404);
    const pointer=exists(pointerSnap)||{},priorId=pointer.roomId;
    const prior=priorId?exists(await tx.get(db.collection(ROOMS).doc(priorId))):null;
    const campaign=trialProgress(pointer.trial,seed);
    if(prior?.status==='active'){
      // Resume old unfinished trials without moving actors or discarding a question.
      if(prior.mode==='pve'&&!prior.trial){
        prior.trial={version:1,seed:campaign.seed,stage:campaign.stage,title:Rules.mapFor(prior.map).name};
        tx.set(db.collection(ROOMS).doc(prior.id),prior);tx.set(pointerRef,{...pointer,trial:campaign});
      }
      return snapshot(prior,uid);
    }
    if(prior?.status==='waiting'&&mode!=='pvp')throw error('請先取消正在等待的鬥法');
    const candidate=wanted||candidates.find(s=>!s.actors.some(a=>a.uid===uid)&&(!prior||s.id<prior.id))?.id;
    const target=candidate?exists(await tx.get(db.collection(ROOMS).doc(candidate))):null;
    if(wanted&&(!target||target.status!=='waiting'||target.createdAtMs<now-15*60000))throw error('此戰場已開始或已失效');
    const a=playerActor(user,uid,selection,exists(catalogSnap)||{});
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
      s=attachScopes(Rules.create({id:newId,mode,map,players:[a],trial:mode==='pve'?campaign:null,now}),[a]);
      // Actor construction deliberately limits public combat fields.
      s.actors[0].baseAtk=a.baseAtk;s.actors[0].baseMaxHp=a.baseMaxHp;s.actors[0].trainingAccessScore=a.trainingAccessScore;
    }
    if(s.mode==='pvp'&&s.actors.length===2){const p=s.actors.find(p=>p.uid===uid);p.baseAtk=a.baseAtk;p.baseMaxHp=a.baseMaxHp;p.trainingAccessScore=a.trainingAccessScore;}
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
  if(stored.status==='waiting'&&stored.createdAtMs<now-15*60000)return command(db,uid,{roomId:stored.id,type:'leave',requestId:crypto.randomUUID()},now);
  if(stored.status==='finished')return withProgress(stored,uid,exists(await db.collection('users').doc(uid).get()));
  if(stored.status!=='active'||stored.mode!=='pvp'||now<stored.deadlineMs)return snapshot(stored,uid);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,stored.id,uid),s=Rules.expire(raw,now);
    let updates={};if(s!==raw){delete s.pending?.[raw.turnUid];updates=await settle(tx,db,s);tx.set(db.collection(ROOMS).doc(s.id),s);}return withProgress(s,uid,updates[uid]);
  });
}
async function command(db,uid,input,now=Date.now()){
  const id=requestId(input.requestId);if(!id)throw error('行動識別碼無效',400);
  return db.runTransaction(async tx=>{
    const raw=await readRoom(tx,db,input.roomId,uid);
    if(raw.receipts?.some(r=>r.uid===uid&&r.id===id))return raw.status==='finished'?withProgress(raw,uid,exists(await tx.get(db.collection('users').doc(uid)))):snapshot(raw,uid);
    if(input.type!=='leave'&&Number(input.revision)!==raw.revision)throw error('戰場已更新，請重新選擇行動');
    let s=input.type==='leave'?Rules.forfeit(raw,uid,now):Rules.apply(raw,uid,input,now);
    if(input.type==='end'||input.type==='leave')delete s.pending?.[uid];
    s.receipts=[...(s.receipts||[]),{uid,id}].slice(-48);
    const updates=await settle(tx,db,s);tx.set(db.collection(ROOMS).doc(s.id),s);return withProgress(s,uid,updates[uid]);
  });
}
async function prepareQuestion(db,uid,id,now=Date.now()){
  if(!roomId(id))throw error('戰場代碼無效',400);
  const s=exists(await db.collection(ROOMS).doc(id).get()),a=member(s,uid);
  if(s.status!=='active'||s.turnUid!==uid)throw error('請在自己的回合答題');
  if(s.mode==='pvp'&&now>=s.deadlineMs)throw error('行動時間已結束');
  if(a.questions>=Rules.LIMITS.questions||a.stamina>=Rules.LIMITS.stamina)throw error('請先使用體力，或結束回合');
  const scope=pickTrustedRaidKnowledge(a.knowledgeScope,a.answered+1);
  return {roomId:id,turn:s.turn,index:a.answered,subject:scope.subject,topic:scope.specificTopic,
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
    if(s.status!=='active'||s.turnUid!==uid||s.turn!==expected.turn||a.answered!==expected.index||s.mode==='pvp'&&now>=s.deadlineMs)throw error('回合已更新，請重新取得題目');
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
    s.reviews||={};s.reviews[uid]={questionId:q.id,q:q.q,opts:q.opts,correct,choice:input.choice,answerIndex:q.answerIndex,explanation:q.explanation,gain:after.stamina-before.stamina};
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
}
module.exports=register;
module.exports.__test={ROOMS,PLAYERS,roomId,member,snapshot,playerActor,trialProgress,rewardFor,start,state,command,prepareQuestion,commitQuestion,answer};
