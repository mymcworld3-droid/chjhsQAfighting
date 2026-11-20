'use strict';
// Stage 12: independent, server-graded dungeon questions. All learning data
// lives in player project A. The combat room and stamina live in project C.
const crypto=require('node:crypto');
const {playerRepository,raidRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const Scope=require('./trial-tower-scope.cjs');
const Adaptive=require('./public/cultivation/adaptive-learning-rules.js');
const Knowledge=require('./public/cultivation/knowledge-points.js');
const Solo=require('./public/cultivation/solo-learning-rules.js');
const Growth=require('./public/cultivation/nascent-growth.js');
const LearningCorrection=require('./dungeon-learning-correction.cjs');
const {recordEvent}=require('./public/cultivation/quest-rules.js');
const {FieldValue}=require('./storage-values.cjs');
const COLLECTION='dungeonQuizStates',MAX_BUFFER=5,MAX_HISTORY=40;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const count=value=>Math.max(0,Math.floor(Number(value)||0));
const exists=s=>s?.exists?s.data():null;
const safeRoom=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''))?String(value):'';
const publicQuestion=q=>q?{
  id:q.id,q:q.q,opts:q.opts,subject:q.subject,topic:q.topic,
  learningTopic:q.learningTopic,difficulty:q.difficulty,level:q.level,
  adaptive:q.adaptive||null,meta:q.meta||{},
  ...Knowledge.metadata(q,q.subject)
}:null;
function validSession(room,uid,roomId,now){
  if(!safeRoom(roomId)||room?.mode!=='dungeon'||room.status!=='assembled'||
      !Number.isSafeInteger(room.assembledAtMs)||!room.members?.[uid]||
      Number(room.expiresAtMs)<=now)
    throw fail('副本未開始、隊伍已離開或房間已過期',403);
  return String(roomId)+':'+room.assembledAtMs;
}
async function session(dbC,uid,roomId,now=Date.now()){
  const snap=await dbC.collection('dungeonRooms').doc(roomId).get();
  const room=exists(snap);
  return {room,sessionKey:validSession(room,uid,roomId,now)};
}
function baseState(roomId,sessionKey,scopeKey){
  return {version:1,roomId,sessionKey,scopeKey,answered:0,
    questions:{},history:[],historyMeta:[],lastReview:null,reviews:{}};
}
function matching(state,roomId,sessionKey,scopeKey){
  if(!state||state.version!==1||state.sessionKey!==sessionKey||
      state.roomId!==roomId)return baseState(roomId,sessionKey,scopeKey);
  if(state.scopeKey!==scopeKey)
    return {...state,scopeKey,questions:{}};
  return state;
}
function view(state,creditedThrough=0,refundedIds=[]){
  const index=count(state.answered);
  const questions=state.questions||{};
  const stock=Array.from({length:MAX_BUFFER},(_,i)=>questions[index+i])
    .filter(Boolean).length;
  const reviews=Object.entries(state.reviews||{}).map(([id,r])=>({
    id,index:r.index,amount:r.amount,correct:r.correct
  })).filter(r=>r.index>creditedThrough).sort((a,b)=>a.index-b.index);
  const alreadyRefunded=new Set(refundedIds);
  const errorRefunds=Object.entries(state.errorReports||{})
    .filter(([id,claim])=>claim?.approved===true&&!claim.skipped&&
      state.reviews?.[id]?.correct===false&&!alreadyRefunded.has(id))
    .map(([id,claim])=>({id,index:claim.index}));
  return {roomId:state.roomId,sessionKey:state.sessionKey,
    answered:index,stock,question:publicQuestion(questions[index]),
    lastReview:state.lastReview||null,pendingCredits:reviews,
    errorRefunds:errorRefunds.slice(-128)};
}
async function state(dbA,dbC,uid,roomId,now=Date.now()){
  const {room,sessionKey}=await session(dbC,uid,roomId,now);
  const [userSnap,snap]=await Promise.all([
    dbA.collection('users').doc(uid).get(),
    dbA.collection(COLLECTION).doc(uid).get()
  ]);
  const user=exists(userSnap);if(!user)throw fail('玩家資料不存在',404);
  const scopeKey=Scope.key(Scope.snapshot(user));
  const member=room.members[uid];
  const refundedIds=[...(Array.isArray(member.quizErrorRefunds)?
    member.quizErrorRefunds:[]),member.lastQuizErrorRefund?.questionId]
    .filter(Boolean);
  const result=view(matching(exists(snap),roomId,sessionKey,scopeKey),
    count(member.quizCreditSeq),refundedIds);
  return {...result,progress:LearningCorrection.progress(user)};
}
async function prepareQuestion(dbA,dbC,uid,roomId,slot=0,now=Date.now()){
  if(!safeRoom(roomId))throw fail('副本房間代碼無效',400);
  if(!Number.isSafeInteger(slot)||slot<0||slot>=MAX_BUFFER)
    throw fail('背景備題位置無效',400);
  const {sessionKey}=await session(dbC,uid,roomId,now);
  const [player,doc]=await Promise.all([
    dbA.collection('users').doc(uid).get(),
    dbA.collection(COLLECTION).doc(uid).get()
  ]);
  const user=exists(player);if(!user)throw fail('玩家資料不存在',404);
  const scope=Scope.snapshot(user),scopeKey=Scope.key(scope);
  const s=matching(exists(doc),roomId,sessionKey,scopeKey);
  const questionIndex=count(s.answered)+slot;
  const prior=s.questions?.[questionIndex];
  if(prior)return {pending:publicQuestion(prior),roomId,sessionKey,slot,questionIndex};
  const choice=Scope.pick(scope,user,questionIndex);
  const normalizedSubject={'英語閱讀':'英文','數學A':'數學','數學B':'數學','數學甲':'數學',
    '數學乙':'數學','地球科學':'地科','自然科學':'自然'};
  if(scope.mode==='bank'){
    const subject=normalizedSubject[choice.subject]||choice.subject;
    choice.difficulty=Adaptive.generalDifficulty(user.stats,subject);
  }
  const questions=Object.values(s.questions||{});
  return {roomId,sessionKey,scopeKey,slot,questionIndex,
    subject:choice.subject,level:choice.level,topic:choice.specificTopic,
    difficulty:choice.difficulty,bankSource:choice.bankSource||'',
    adaptiveScope:choice.adaptiveScope||null,
    adaptivePending:questions.filter(q=>q?.adaptive).map(q=>q.adaptive),
    history:[...(s.history||[]),...questions.map(q=>q.q)].filter(Boolean).slice(-MAX_HISTORY),
    historyMeta:[...(s.historyMeta||[]),...questions.map(q=>({...q.meta,q:q.q}))].slice(-MAX_HISTORY)};
}
async function commitQuestion(dbA,uid,expected,parsed,now=Date.now()){
  const choices=[parsed?.correct,...(parsed?.wrong||[])].map(v=>String(v||'').trim().slice(0,1200));
  if(choices.length!==4||choices.some(v=>!v)||new Set(choices).size!==4||
      typeof parsed?.q!=='string'||parsed.q.trim().length<5||
      typeof parsed?.exp!=='string'||parsed.exp.trim().length<5)
    throw fail('題目未通過四選一格式及解析檢查',422);
  let answerIndex=0;
  for(let i=3;i>0;i--){
    const j=crypto.randomInt(i+1);
    [choices[i],choices[j]]=[choices[j],choices[i]];
    if(answerIndex===i)answerIndex=j;
    else if(answerIndex===j)answerIndex=i;
  }
  const q={
    id:crypto.randomUUID(),q:parsed.q.slice(0,4000),opts:choices,answerIndex,
    explanation:parsed.exp.slice(0,5000),
    subject:expected.subject||parsed.subject||'綜合',topic:expected.topic||parsed.sub_topic||'本題概念',
    learningTopic:String(parsed.sub_topic||expected.topic||'本題概念').slice(0,240),
    difficulty:parsed.adaptive?.difficulty||parsed.difficulty||expected.difficulty||'easy',
    level:expected.level,
    meta:{...Knowledge.metadata(parsed,expected.subject),
      concept_id:String(parsed.concept_id||'').slice(0,100),
      template_id:String(parsed.template_id||'').slice(0,120),
      question_form:String(parsed.question_form||'').slice(0,60),
      cognitive_level:Math.max(1,Math.min(5,Number(parsed.cognitive_level)||1)),
      reasoning_steps:Math.max(1,Math.min(6,Number(parsed.reasoning_steps)||1))},
    ...(parsed.adaptive?{adaptive:parsed.adaptive}:{}),
    scopeKey:expected.scopeKey,createdAtMs:now,
    ...Knowledge.metadata(parsed,expected.subject)
  };
  return dbA.runTransaction(async tx=>{
    const player=exists(await tx.get(dbA.collection('users').doc(uid)));
    if(!player||Scope.key(Scope.snapshot(player))!==expected.scopeKey)
      throw fail('修習範圍已更改，請重新取題',409);
    const ref=dbA.collection(COLLECTION).doc(uid),snap=await tx.get(ref);
    const raw=matching(exists(snap),expected.roomId,expected.sessionKey,
      expected.scopeKey);
    if(expected.questionIndex<count(raw.answered)||
        expected.questionIndex>=count(raw.answered)+MAX_BUFFER)
      throw fail('背景備題已過期',409);
    const existing=raw.questions?.[expected.questionIndex];
    if(existing)return publicQuestion(existing);
    const other=Object.values(raw.questions||{});
    if(other.some(v=>v.q===q.q)||(raw.history||[]).includes(q.q))
      throw fail('此題與尚未作答的題目重複',409);
    raw.questions={...(raw.questions||{}),[expected.questionIndex]:q};
    tx.set(ref,raw);
    return publicQuestion(q);
  });
}
async function answer(dbA,dbC,uid,input,now=Date.now()){
  const roomId=safeRoom(input?.roomId);
  if(!roomId)throw fail('副本房間代碼無效',400);
  const choice=input?.choice;
  if(!Number.isInteger(choice)||choice<0||choice>3)throw fail('答案選項無效',400);
  const {sessionKey}=await session(dbC,uid,roomId,now);
  return dbA.runTransaction(async tx=>{
    const userRef=dbA.collection('users').doc(uid),
      recordRef=dbA.collection(COLLECTION).doc(uid);
    const [userSnap,recordSnap]=await Promise.all([tx.get(userRef),tx.get(recordRef)]);
    const user=exists(userSnap);if(!user)throw fail('玩家資料不存在',404);
    const scopeKey=Scope.key(Scope.snapshot(user));
    const s=matching(exists(recordSnap),roomId,sessionKey,scopeKey);
    // Any recent receipt can be replayed without mutating the user stats,
    // even if another question was answered in a second browser meanwhile.
    if(s.reviews?.[input.questionId])
      return {review:s.reviews[input.questionId],state:view(s),
        progress:LearningCorrection.progress(user)};
    if(s.lastReview)
      throw fail('請先查看本題解析並按「下一題」',409);
    const index=count(s.answered),q=s.questions?.[index];
    if(!q||q.id!==input.questionId||q.scopeKey!==scopeKey)
      throw fail('此題已失效或尚未完成出題',409);
    if(choice>=q.opts.length)throw fail('答案選項無效',400);
    const logRef=dbA.collection('exam_logs').doc(
      crypto.createHash('sha256').update('dungeon-quiz\n'+uid+'\n'+q.id).digest('hex'));
    const logSnap=await tx.get(logRef);
    if(logSnap.exists)throw fail('此題已結算，請同步最新答題狀態',409);
    const correct=choice===q.answerIndex,amount=correct?4:1;
    const stats=user.stats||{},learningQuiz={
      data:{q:q.q},learningSubject:q.subject,
      learningTopic:q.learningTopic||q.topic,learningDifficulty:q.difficulty,
      answerSelectedIndex:choice
    };
    const learningContext=Solo.context(learningQuiz);
    const learningReward=Solo.reward(stats,learningQuiz,correct,user.profile||{});
    const countOf=v=>Math.max(0,Math.floor(Number(v)||0));
    const patch={
      'stats.totalAnswered':countOf(stats.totalAnswered)+1,
      'stats.totalCorrect':countOf(stats.totalCorrect)+(correct?1:0),
      'stats.knowledgePointMapV1':Knowledge.record(stats.knowledgePointMapV1||{},q,correct),
      'stats.soloLearningV1':learningReward.progress
    };
    const subject=learningContext.subject,topic=learningContext.topic;
    const knowledgeMap={...(stats.knowledgeMap||{})};
    const topicData={...(knowledgeMap[subject]||{})};
    const old=topicData[topic]||{};
    topicData[topic]={...old,total:countOf(old.total)+1,
      correct:countOf(old.correct)+(correct?1:0)};
    knowledgeMap[subject]=topicData;patch['stats.knowledgeMap']=knowledgeMap;
    const help=Math.max(0,Math.min(3,countOf(input.help)));
    if(q.adaptive?.scopeId)
      patch['stats.adaptiveLearningV1']=Adaptive.record(stats.adaptiveLearningV1,q.adaptive,{
        id:q.adaptive.questionId||q.id,correct,skipped:false,help,at:now
      });
    const beforeScore=countOf(stats.totalScore);
    const cultivation=correct?(beforeScore>=28?2:1)+Growth.cultivation(user,'solo')+learningReward.gain:
      beforeScore>=28?-1:0;
    patch['stats.totalScore']=Math.max(0,beforeScore+cultivation);
    patch['stats.lastQuizAnswer']={
      question:String(q.q).normalize('NFC').replace(/\s+/g,' ').trim().slice(0,1500),
      isCorrect:correct,scoreBefore:beforeScore,
      scoreAfter:patch['stats.totalScore'],
      penalty:Math.max(0,beforeScore-patch['stats.totalScore']),answeredAtMs:now
    };
    patch['stats.currentStreak']=correct?countOf(stats.currentStreak)+1:0;
    patch['stats.bestStreak']=Math.max(countOf(stats.bestStreak),patch['stats.currentStreak']);
    if(correct){
      patch.questProgress=recordEvent(user.questProgress,'solo');
      if(learningReward.recovery)patch.questProgress=recordEvent(patch.questProgress,'correction');
    }
    const review={uid,questionId:q.id,index:index+1,choice,answerIndex:q.answerIndex,
      correct,amount,explanation:q.explanation,q:q.q,opts:q.opts,
      subject:q.subject,topic:q.topic,learningTopic:q.learningTopic,
      difficulty:q.difficulty,adaptive:q.adaptive||null,meta:q.meta||{},
      reward:{
        cultivation,gold:0,learning:learningReward.message||''
      }};
    s.answered=index+1;
    const qs={...(s.questions||{})};delete qs[index];s.questions=qs;
    s.history=[...(s.history||[]),q.q].slice(-MAX_HISTORY);
    s.historyMeta=[...(s.historyMeta||[]),{...q.meta,q:q.q}].slice(-MAX_HISTORY);
    s.lastReview=review;s.reviews={...(s.reviews||{}),[q.id]:review};
    const correctionEvidence=LearningCorrection.evidenceBefore(
      stats,q,correct,help,now,patch);
    // Retain a bounded recovery window; C remembers the highest credited
    // sequence, so replay is impossible even after A trims old reviews.
    const reviewIds=Object.keys(s.reviews);
    if(reviewIds.length>128)delete s.reviews[reviewIds[0]];
    const point=Knowledge.label(q,q.subject);
    tx.set(logRef,{
      uid,question:q.q,options:q.opts,correctIdx:q.answerIndex,
      userIdx:choice,isCorrect:correct,explanation:q.explanation,
      subject,subTopic:topic,knowledgeSubject:point?.subject||'',
      knowledgePointId:point?.id||'',knowledgePoint:point?.name||'',
      knowledgePoints:Knowledge.labels(q,q.subject),
      questionForm:q.meta?.question_form||'',cognitiveLevel:q.meta?.cognitive_level||null,
      reasoningSteps:q.meta?.reasoning_steps||null,conceptId:q.meta?.concept_id||'',
      mode:'infinite',topic:'Dungeon',rankAtTime:'多人合作副本',
      learningCorrectionEvidence:correctionEvidence,
      timestamp:FieldValue.serverTimestamp(),
      timeTaken:Math.max(0,Math.min(86400,Number(input.timeTaken)||0))
    });
    tx.update(userRef,patch);tx.set(recordRef,s);
    // Only the current user sees their already-committed progress. This is
    // the same post-grade client refresh used by the main PvE question UI;
    // the shared learning footprint must not display stale mastery data.
    const updated={...user,stats:{...stats,
      ...Object.fromEntries(Object.entries(patch)
        .filter(([key])=>key.startsWith('stats.'))
        .map(([key,value])=>[key.slice('stats.'.length),value]))}};
    return {review,state:view(s),progress:LearningCorrection.progress(updated)};
  });
}
async function acknowledge(dbA,dbC,uid,input,now=Date.now()){
  const roomId=safeRoom(input?.roomId);
  if(!roomId)throw fail('副本房間代碼無效',400);
  const {sessionKey}=await session(dbC,uid,roomId,now);
  return dbA.runTransaction(async tx=>{
    const userRef=dbA.collection('users').doc(uid),ref=dbA.collection(COLLECTION).doc(uid);
    const [userSnap,recordSnap]=await Promise.all([tx.get(userRef),tx.get(ref)]);
    const user=exists(userSnap);if(!user)throw fail('玩家資料不存在',404);
    const s=matching(exists(recordSnap),roomId,sessionKey,Scope.key(Scope.snapshot(user)));
    if(s.lastReview?.questionId!==input.questionId){
      if(s.reviews?.[input.questionId]&&!s.lastReview)
        return {state:view(s)};
      throw fail('此題解析不同步，請重新整理題目',409);
    }
    s.lastReview=null;
    tx.set(ref,s);
    return {state:view(s)};
  });
}
function register(app,{resolveA=()=>playerRepository.resolve(),
  resolveC=()=>raidRepository.resolve(),verify=verifyMainIdentity,
  clock=Date.now,logger=console}={}){
  const route=fn=>async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{
      const uid=await verify(req,{resolveA});
      const value=await fn(resolveA().db,resolveC().db,uid,req,clock());
      return res.json({ok:true,...value});
    }catch(error){
      if(!error.status)logger.error('[Dungeon quiz]',{path:req.path,error:error.message});
      return res.status(error.status||503).json({ok:false,
        error:error.status?error.message:'副本答題服務暫時無法使用'});
    }
  };
  app.post('/api/dungeon/quiz/state',route(async(a,c,uid,req,now)=>
    ({state:await state(a,c,uid,String(req.body?.roomId||''),now)})));
  app.post('/api/dungeon/quiz/answer',route(async(a,c,uid,req,now)=>
    await answer(a,c,uid,req.body,now)));
  app.post('/api/dungeon/quiz/next',route(async(a,c,uid,req,now)=>
    await acknowledge(a,c,uid,req.body,now)));
  const errors=require('./dungeon-question-report.cjs');
  app.post('/api/dungeon/quiz/report',route(async(a,c,uid,req,now)=>
    await errors.report(a,c,uid,req.body,now)));
  app.post('/api/dungeon/quiz/review-math-issue',
    route(async(a,c,uid,req,now)=>
      await errors.reviewMath(a,c,uid,req.body,now)));
}
module.exports=register;
module.exports.__test={COLLECTION,MAX_BUFFER,validSession,session,matching,view,
  prepareQuestion,commitQuestion,answer,acknowledge,state,register};
