'use strict';
// 悟道試煉：所有題目簽發、答題結果和獎勵均由 Firebase A 上的伺服器事務處理。
const crypto = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity, issueRaidQuestionTicket, readRaidQuestionTicket,
  assertRaidQuestionTicket } = require('./raid-question-ticket.cjs');
const ability = require('./public/cultivation/ability-insights-core.js');

const COLLECTION = 'enlightenmentTrialStates';
const TOTAL = 5, REQUIRED = 4;
const PRIZE = Object.freeze({gold:45,cultivation:3});
const MAX_TOPIC_RECORDS = 64;
const count = n => Number.isFinite(Number(n)) ? Math.max(0,Math.floor(Number(n))) : 0;
const error = (message,status=409) => Object.assign(new Error(message),{status});
const day = (time=Date.now()) => new Date(time+8*3600000).toISOString().slice(0,10);
const clean = (text,limit=55) => String(text||'').trim().slice(0,limit);
const fingerprint = (subject,topic) => crypto.createHash('sha256')
  .update(subject+'\n'+topic).digest('hex').slice(0,20);
function candidateWeaknesses(map) {
  const out = [];
  if (!map || typeof map!=='object') return out;
  for (const [rawSubject,topics] of Object.entries(map)) {
    const subject = clean(rawSubject,40);
    if (!subject || !topics || typeof topics !== 'object' || Array.isArray(topics)) continue;
    for (const [rawTopic,value] of Object.entries(topics)) {
      const topic = clean(rawTopic);
      if (!topic || /^(精選|綜合|一般|題庫|練習|隨機)$/.test(topic)) continue;
      const measured = ability.row(subject,topic,value);
      if (measured.total >= 5 && measured.estimate < 78) out.push(measured);
    }
  }
  return out.sort((a,b) => a.estimate - b.estimate || b.total - a.total ||
    a.subject.localeCompare(b.subject,'zh') || a.topic.localeCompare(b.topic,'zh')).slice(0,10);
}
function titleFor(n) { return n >= 7 ? '明心悟道' : n >= 3 ? '辨惑行者' : n >= 1 ? '悟道學徒' : ''; }
function publicQuestion(question) {
  if (!question) return null;
  return {id:question.id,q:question.q,opts:question.opts,ticket:question.ticket,
    subject:question.subject,topic:question.topic,level:question.level,expiresAtMs:question.expiresAtMs};
}
function snapshot(state, weakness=null) {
  if (!state) return {status:'idle',weakness,total:TOTAL,required:REQUIRED};
  const pending=state.pendingQuestion && state.pendingQuestion.expiresAtMs>Date.now()
    ? publicQuestion(state.pendingQuestion) : null;
  return {runId:state.runId,status:state.status,day:state.day,
    subject:state.subject,topic:state.topic,level:state.level,
    index:count(state.index),correct:count(state.correct),total:TOTAL,required:REQUIRED,
    question:pending,lastReview:state.lastReview||null,success:state.success===true,
    rewarded:state.rewarded===true,reward:state.reward||null,masteryCount:count(state.masteryCount),
    title:state.title||'',weakness,finishedAtMs:state.finishedAtMs||0};
}
async function readState(db,uid) {
  const [userSnap,stateSnap] = await Promise.all([
    db.collection('users').doc(uid).get(), db.collection(COLLECTION).doc(uid).get()
  ]);
  if (!userSnap.exists) throw error('玩家資料不存在',404);
  const user=userSnap.data()||{};
  const raw=stateSnap.exists ? stateSnap.data()||{} : null;
  return {user,state:raw,weakness:candidateWeaknesses(user.stats?.knowledgeMap)[0]||null};
}
async function start(db,uid,selection={},now=Date.now()) {
  const userRef=db.collection('users').doc(uid),stateRef=db.collection(COLLECTION).doc(uid);
  return db.runTransaction(async tx => {
    const [userSnap,stateSnap]=await Promise.all([tx.get(userRef),tx.get(stateRef)]);
    if(!userSnap.exists) throw error('玩家資料不存在',404);
    const user=userSnap.data()||{}, current=stateSnap.exists?stateSnap.data()||{}:null;
    if(user.uid&&user.uid!==uid) throw error('帳號驗證失敗',403);
    if(current?.day===day(now)) {
      if(current.status==='active')return snapshot(current);
      throw error('今日悟道試煉已結束，明日可再挑戰');
    }
    const available=candidateWeaknesses(user.stats?.knowledgeMap);
    if(!available.length)throw error('目前沒有足夠證據判斷弱項。請先在問道同一單元完成至少五題。');
    const desiredSubject=clean(selection.subject,40),desiredTopic=clean(selection.topic);
    const selected=available.find(x=>x.subject===desiredSubject && x.topic===desiredTopic) || available[0];
    const progress=user.enlightenmentProgress||{};
    const mastered=progress.masteredTopics||{};
    const chosen=available.find(x=>!mastered[fingerprint(x.subject,x.topic)])||selected;
    const state={version:1,runId:crypto.randomUUID(),day:day(now),status:'active',
      subject:chosen.subject,topic:chosen.topic,level:clean(user.profile?.educationLevel,32)||'國中一年級',
      index:0,correct:0,pendingQuestion:null,lastReview:null,history:[],
      startedAtMs:now,finishedAtMs:0,success:false,rewarded:false,
      title:titleFor(Object.keys(mastered).length),masteryCount:Object.keys(mastered).length};
    tx.set(stateRef,state);
    return snapshot(state);
  });
}
async function prepareQuestion(db,uid,now=Date.now()) {
  const snap=await db.collection(COLLECTION).doc(uid).get();
  if(!snap.exists)throw error('尚未開始悟道試煉');
  const state=snap.data()||{};
  if(state.status!=='active'||state.day!==day(now)||count(state.index)>=TOTAL)throw error('本次悟道試煉已結束');
  const pending=state.pendingQuestion && state.pendingQuestion.expiresAtMs>now
    ? publicQuestion(state.pendingQuestion) : null;
  return {runId:state.runId,index:count(state.index),subject:state.subject,
    topic:state.topic,level:state.level,history:(state.history||[]).slice(-TOTAL),pending};
}
async function commitQuestion(db,uid,expected,parsed,now=Date.now()) {
  const correct=clean(parsed?.correct,300),wrong=Array.isArray(parsed?.wrong)?parsed.wrong.map(x=>clean(x,300)):[];
  if(!correct||wrong.length!==3||wrong.some(x=>!x))throw error('題目選項未通過驗證');
  const opts=[correct,...wrong];
  let answerIndex=0;
  for(let i=opts.length-1;i>0;i--){
    const j=crypto.randomInt(i+1);[opts[i],opts[j]]=[opts[j],opts[i]];
    if(answerIndex===i)answerIndex=j;else if(answerIndex===j)answerIndex=i;
  }
  const id='enlightenment-'+crypto.randomUUID(),actionId=expected.index+1;
  const token=issueRaidQuestionTicket({uid,roomId:expected.runId,actionId,questionId:id,
    answerIndex,explanation:String(parsed.exp||'').slice(0,3000)});
  const ticket=readRaidQuestionTicket(token);
  const fresh={id,q:String(parsed.q||'').slice(0,3000),opts,ticket:token,
    subject:expected.subject,topic:expected.topic,level:expected.level,
    expiresAtMs:ticket.expiresAtMs};
  const ref=db.collection(COLLECTION).doc(uid);
  return db.runTransaction(async tx => {
    const snap=await tx.get(ref),state=snap.exists?snap.data()||{}:{};
    if(state.status!=='active'||state.day!==day(now)||state.runId!==expected.runId||count(state.index)!==expected.index)
      throw error('試煉進度已更新，請重新取得題目');
    if(state.pendingQuestion?.expiresAtMs>now)return publicQuestion(state.pendingQuestion);
    tx.update(ref,{pendingQuestion:fresh});
    return publicQuestion(fresh);
  });
}
async function answer(db,uid,request={},now=Date.now()) {
  const token=clean(request.ticket,10000),choice=Number(request.choice);
  if(!Number.isInteger(choice)||choice<0||choice>=4)throw error('請選擇正確的選項編號',400);
  const raw=readRaidQuestionTicket(token,{now});
  const answerIndex=assertRaidQuestionTicket(raw,{uid,roomId:clean(request.runId,100),
    actionId:Number(request.index)+1,questionId:clean(request.questionId,120)}).answerIndex;
  const userRef=db.collection('users').doc(uid),ref=db.collection(COLLECTION).doc(uid);
  return db.runTransaction(async tx => {
    const [userSnap,stateSnap]=await Promise.all([tx.get(userRef),tx.get(ref)]);
    if(!userSnap.exists||!stateSnap.exists)throw error('試煉資料不存在',404);
    const user=userSnap.data()||{},state=stateSnap.data()||{};
    const pending=state.pendingQuestion;
    if(state.status!=='active'||state.day!==day(now)||state.runId!==request.runId||
        count(state.index)!==Number(request.index)||pending?.id!==request.questionId||
        pending?.ticket!==token||pending?.expiresAtMs<=now)throw error('此題已結算或與試煉進度不符');
    const correct=choice===answerIndex;
    const index=count(state.index)+1,numCorrect=count(state.correct)+(correct?1:0);
    const stats=user.stats||{},map={...(stats.knowledgeMap||{})},subjects={...(map[state.subject]||{})};
    const before=subjects[state.topic]||{},total=count(before.total)+1;
    subjects[state.topic]={...before,total,correct:Math.min(total,count(before.correct)+(correct?1:0))};
    map[state.subject]=subjects;
    const patch={
      'stats.knowledgeMap':map,
      'stats.totalAnswered':count(stats.totalAnswered)+1,
      'stats.totalCorrect':count(stats.totalCorrect)+(correct?1:0)
    };
    const done=index===TOTAL,success=done&&numCorrect>=REQUIRED;
    const progress=user.enlightenmentProgress||{},mastered={...(progress.masteredTopics||{})};
    const key=fingerprint(state.subject,state.topic);
    const newMastery=success&&!mastered[key];
    const reward=newMastery?PRIZE:{gold:0,cultivation:0};
    if(newMastery){
      mastered[key]={subject:state.subject,topic:state.topic,completedAtMs:now,accuracy:numCorrect+'/'+TOTAL};
      // Prevent unbounded player-document growth; retain most recent entries.
      const entries=Object.entries(mastered).sort((a,b)=>(a[1].completedAtMs||0)-(b[1].completedAtMs||0));
      while(entries.length>MAX_TOPIC_RECORDS){const removed=entries.shift();delete mastered[removed[0]];}
      patch['stats.gold']=count(stats.gold)+PRIZE.gold;
      patch['stats.totalScore']=count(stats.totalScore)+PRIZE.cultivation;
    }
    const masteryCount=Object.keys(mastered).length,title=titleFor(masteryCount);
    if(done){
      patch.enlightenmentProgress={...progress,masteredTopics:mastered,
        completedTrials:count(progress.completedTrials)+1,
        successfulTrials:count(progress.successfulTrials)+(success?1:0),title};
    }
    const review={index,correct,correctIndex:answerIndex,
      explanation:String(raw.explanation||''),selectedChoice:choice};
    const newState={...state,index,correct:numCorrect,pendingQuestion:null,lastReview:review,
      history:[...(state.history||[]),pending.q].slice(-TOTAL),status:done?'completed':'active',
      success:success||false,rewarded:!!newMastery,reward:done?reward:null,
      finishedAtMs:done?now:0,masteryCount,title};
    tx.update(userRef,patch);
    tx.set(ref,newState);
    return {ok:true,review,state:snapshot(newState),balances:{
      gold:newMastery?patch['stats.gold']:count(stats.gold),
      totalScore:newMastery?patch['stats.totalScore']:count(stats.totalScore)
    },knowledge:subjects[state.topic]};
  });
}
function handler(action,{resolveA=()=>playerRepository.resolve(),clock=()=>Date.now(),logger=console}={}){
  return async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{
      const uid=await verifyMainIdentity(req,{resolveA}),db=resolveA().db,now=clock();
      if(action==='status'){
        const {user,state,weakness}=await readState(db,uid);
        const today=state?.day===day(now)?state:null;
        const progress=user.enlightenmentProgress||{};
        const publicData=snapshot(today,weakness);
        if(!today)Object.assign(publicData,{masteryCount:Object.keys(progress.masteredTopics||{}).length,title:progress.title||''});
        return res.json({ok:true,trial:publicData});
      }
      const trial=action==='start'?await start(db,uid,req.body||{},now):await answer(db,uid,req.body||{},now);
      return res.json({ok:true,...(action==='start'?{trial}:trial)});
    }catch(e){
      if(!e.status)logger.error('[Enlightenment trial]',e?.message||e);
      return res.status(e.status||503).json({ok:false,error:e.status?e.message:'悟道試煉暫時無法使用'});
    }
  };
}
module.exports=function registerEnlightenmentTrialApi(app){
  app.get('/api/enlightenment/trial',handler('status'));
  app.post('/api/enlightenment/trial/start',handler('start'));
  app.post('/api/enlightenment/trial/answer',handler('answer'));
};
module.exports.__test={day,candidateWeaknesses,titleFor,fingerprint,snapshot,
  start,readState,prepareQuestion,commitQuestion,answer,handler,PRIZE};
