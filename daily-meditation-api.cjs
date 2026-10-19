'use strict';
const crypto = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const Rules = require('./public/cultivation/daily-meditation-rules.js');
const Mistakes = require('./public/cultivation/daily-meditation-mistakes.js');
const Growth = require('./public/cultivation/nascent-growth.js');
const Quests = require('./public/cultivation/quest-rules.js');
const { accrueRaidTickets } = require('./raid-room-api.cjs').__test;
const SESSIONS = 'meditationSessions', RESULTS = 'meditationDailyResults';
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const validUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const friends = (user, uid) => [...new Set((Array.isArray(user?.friends) ? user.friends : []).filter(x => validUid(x) && x !== uid))].slice(0,100);
const dayId = (uid,date) => date + '_' + uid;
function dailyResult(user, result, uid, date) {
  if (result?.date === date && result.uid === uid && result.completed === true) return result;
  // Keep today's already-settled personal reward when rolling out the new system.
  if (user?.dailyMeditation?.lastDate === date && user.dailyMeditation.lastResult) return {
    uid,date,completed:true,legacy:true,stars:Math.min(3,count(user.dailyMeditation.lastResult.correct)),
    answerTimeMs:null,rewardScore:count(user.stats?.totalScore),claimed:[]
  };
  return null;
}
function publicRow(user, result, uid) {
  return {uid,name:String(user.displayName || '修士').slice(0,40),stars:Math.min(3,count(result.stars)),
    correct:Math.min(3,count(result.stars)),total:3,
    answerTimeMs:typeof result.answerTimeMs === 'number' && Number.isFinite(result.answerTimeMs) ? count(result.answerTimeMs) : null};
}
function publicSession(session) {
  if (!session) return null;
  const index=session.index, entry=session.questions[index], answer=session.answers[index];
  return {date:session.date,index,answered:session.answers.length,correct:session.answers.filter(x=>x.isCorrect).length,
    questionAnswered:!!answer,question:{id:entry.id,q:entry.data.q,opts:entry.data.opts,source:entry.source},
    feedback:answer?{isCorrect:answer.isCorrect,correctIdx:entry.data.ans,exp:entry.data.exp || ''}:null};
}
function economy(user) {
  return {gold:count(user.stats?.gold),score:count(user.stats?.totalScore),rank:count(user.stats?.rankLevel),
    drawTickets:count(user.soulboundDrawTickets),raidTickets:user.raidTickets || null,growthState:Growth.prepare(user)};
}
function createService({db,now=Date.now,random=Math.random}={}) {
  const dateNow=()=>Rules.meditationDateKey(new Date(now()));
  const refs=(uid,date)=>({user:db.collection('users').doc(uid),session:db.collection(SESSIONS).doc(dayId(uid,date)),result:db.collection(RESULTS).doc(dayId(uid,date))});
  function sameDay(date) { if(date!==dateNow())throw fail('已跨日，請重新確認今日閉關'); }
  async function own(tx,uid,date) {
    const r=refs(uid,date),[u,s,d]=await Promise.all([tx.get(r.user),tx.get(r.session),tx.get(r.result)]);
    if(!u.exists)throw fail('玩家資料不存在',404);
    const user=u.data();if(user.uid && user.uid!==uid)throw fail('玩家身分不符',403);
    return {refs:r,user,session:s.exists?s.data():null,result:dailyResult(user,d.exists?d.data():null,uid,date),resultExists:d.exists};
  }
  async function context(tx,uid,date) {
    const c=await own(tx,uid,date),ids=friends(c.user,uid);
    const pairs=await Promise.all(ids.map(async id=>{
      const [u,d]=await Promise.all([tx.get(db.collection('users').doc(id)),tx.get(refs(id,date).result)]);
      if(!u.exists || !friends(u.data(),id).includes(uid))return null;
      const user=u.data(),result=dailyResult(user,d.exists?d.data():null,id,date);
      return result?publicRow(user,result,id):null;
    }));
    c.rows=pairs.filter(Boolean);
    if(c.result)c.rows.push(publicRow(c.user,c.result,uid));
    c.stars=Math.min(15,Math.max(count(c.result?.bestStars),c.rows.reduce((sum,row)=>sum+row.stars,0)));
    return c;
  }
  function view(c,uid,date) {
    const claimed=Array.isArray(c.result?.claimed)?c.result.claimed:[];
    const milestones=Rules.MEDITATION_COOP_STEPS.map(step=>({stars:step.stars,
      reward:Rules.meditationCoopReward(c.result?.rewardScore ?? count(c.user.stats?.totalScore),step.stars),
      claimed:claimed.includes(step.stars),claimable:!!c.result && c.stars>=step.stars && !claimed.includes(step.stars)}));
    return {date,completed:!!c.result,record:c.user.dailyMeditation || {},drawTickets:count(c.user.soulboundDrawTickets),personalStars:c.result?Math.min(3,count(c.result.stars)):0,
      stars:c.stars,milestones,claimable:milestones.some(x=>x.claimable),
      rankings:c.result?Rules.rankMeditators(c.rows):[],session:c.result?null:publicSession(c.session)};
  }
  async function status(uid) {
    const date=dateNow();
    return db.runTransaction(async tx=>{
      const c=await context(tx,uid,date);sameDay(date);
      if(c.result && (!c.resultExists || count(c.result.bestStars)<c.stars))tx.set(c.refs.result,{...c.result,bestStars:c.stars});
      return view(c,uid,date);
    });
  }
  async function start(uid) {
    const date=dateNow();
    const existing=await db.runTransaction(tx=>own(tx,uid,date));
    sameDay(date);
    if(existing.result)return {completed:true,session:null};
    if(existing.session)return {completed:false,session:publicSession(existing.session)};
    const logs=await db.collection('exam_logs').where('uid','==',uid).orderBy('timestamp','desc').limit(250).get();
    const pool=Mistakes.buildMeditationMistakePool(logs.docs.map(doc=>doc.data()));
    const selected=Mistakes.chooseMeditationMistakes(pool,3,random);
    if(selected.length<3)throw fail('目前只有 '+pool.total+' 道不同錯題，需集齊 3 題才能閉關；請先到問道或洞天練習');
    const questions=selected.map(q=>({...q,id:crypto.randomUUID()}));
    return db.runTransaction(async tx=>{
      const c=await own(tx,uid,date);sameDay(date);
      if(c.result)return {completed:true,session:null};
      const session=c.session || {uid,date,index:0,questions,answers:[],issuedAtMs:now()};
      if(!c.session)tx.set(c.refs.session,session);
      return {completed:false,session:publicSession(session)};
    });
  }
  async function answer(uid,body) {
    const date=dateNow();
    return db.runTransaction(async tx=>{
      const c=await own(tx,uid,date),s=c.session;sameDay(date);
      if(!s || c.result)throw fail('今日閉關已完成或尚未開始，請重新確認');
      const previous=s.answers.find(x=>x.questionId===body.questionId);
      if(previous) {
        if(previous.userIdx!==body.choice)throw fail('這題已經作答，不能更換答案');
        return {session:publicSession(s)};
      }
      const q=s.questions[s.index];
      if(q.id!==body.questionId || s.answers.length!==s.index)throw fail('題目已更新，請重新同步');
      if(!Number.isInteger(body.choice)||body.choice<0||body.choice>=q.data.opts.length)throw fail('請選擇有效答案',400);
      const elapsed=Math.max(0,now()-s.issuedAtMs);
      const activeMs=Math.min(30*60*1000,elapsed,count(body.activeMs));
      if(typeof body.activeMs!=='number'||!Number.isFinite(body.activeMs)||body.activeMs<0)throw fail('作答時間無效，請重新同步',400);
      s.answers.push({questionId:q.id,q:q.data.q,options:q.data.opts,correctIdx:q.data.ans,userIdx:body.choice,
        isCorrect:body.choice===q.data.ans,exp:q.data.exp || '',source:q.source,activeMs});
      tx.set(c.refs.session,s);return {session:publicSession(s)};
    });
  }
  async function next(uid) {
    const date=dateNow();
    return db.runTransaction(async tx=>{
      const c=await own(tx,uid,date),s=c.session;sameDay(date);
      if(!s || c.result)throw fail('請重新確認今日閉關');
      if(s.answers.length===s.index+1 && s.index<2){s.index++;s.issuedAtMs=now();tx.set(c.refs.session,s);}
      return {session:publicSession(s)};
    });
  }
  async function finish(uid) {
    const date=dateNow();
    return db.runTransaction(async tx=>{
      const c=await own(tx,uid,date),user=c.user;sameDay(date);
      if(c.result)return {completed:true,record:user.dailyMeditation,economy:economy(user)};
      if(!c.session || c.session.answers.length!==3)throw fail('請完成三題後再出關');
      const answers=c.session.answers,correct=answers.filter(x=>x.isCorrect).length,old=user.dailyMeditation || {};
      if(old.lastDate>date)throw fail('閉關日期異常，請重新同步');
      const streak=Rules.nextMeditationStreak(old.lastDate,old.streak,date),score=count(user.stats?.totalScore);
      const reward=Rules.meditationReward(score,streak,correct);
      const soulCultivation=correct===3?Growth.cultivation(user,'daily'):0;
      const fragments=score>=68 && correct===3?3:0;
      const growth=Growth.award(user,fragments),answerTimeMs=answers.reduce((sum,row)=>sum+row.activeMs,0);
      const record={lastDate:date,streak,totalDays:count(old.totalDays)+1,bestStreak:Math.max(streak,count(old.bestStreak)),
        lastResult:{correct,total:3,stars:correct,answerTimeMs,cultivation:reward.cultivation+soulCultivation,
          soulCultivation,gold:reward.gold,fragments,realm:reward.realm},updatedAt:new Date(now())};
      const patch={dailyMeditation:record,questProgress:Quests.recordEvent(user.questProgress,'meditation',date),
        'stats.totalScore':score+record.lastResult.cultivation,'stats.gold':count(user.stats?.gold)+reward.gold,...Growth.patch(growth)};
      tx.update(c.refs.user,patch);
      const result={uid,date,completed:true,stars:correct,answerTimeMs,rewardScore:score,claimed:[],bestStars:correct,finishedAtMs:now()};
      tx.set(c.refs.result,result);
      tx.set(db.collection('exam_logs').doc('meditation_'+dayId(uid,date)),{uid,mode:'daily-meditation',topic:'閉關錯題',
        question:'每日閉關 · '+correct+'/3',isCorrect:correct===3,correctCount:correct,totalCount:3,
        dailyMeditationAnswers:answers,timestamp:new Date(now())});
      user.dailyMeditation=record;user.stats ||= {};user.stats.totalScore=patch['stats.totalScore'];user.stats.gold=patch['stats.gold'];Growth.apply(user,growth);
      return {completed:true,record,economy:economy(user)};
    });
  }
  async function claim(uid,body) {
    if(!Rules.MEDITATION_COOP_STEPS.some(x=>x.stars===body.stars))throw fail('獎勵節點不正確',400);
    const date=dateNow();
    if(body.date && body.date!==date)throw fail('共修獎勵已跨日，請重新查看');
    return db.runTransaction(async tx=>{
      const c=await context(tx,uid,date);sameDay(date);
      if(!c.result)throw fail('請先完成自己的三題閉關');
      const claimed=Array.isArray(c.result.claimed)?c.result.claimed:[];
      if(claimed.includes(body.stars))return {...view(c,uid,date),claimedNow:false,economy:economy(c.user)};
      if(c.stars<body.stars)throw fail('好友共修星星尚未達到此節點');
      const reward=Rules.meditationCoopReward(c.result.rewardScore,body.stars),user=c.user,patch={};
      let gold=reward.gold,raidTicketsAdded=0,convertedRaidGold=0;
      if(reward.raidTickets){
        const tickets=accrueRaidTickets(user,date),added=Math.min(reward.raidTickets,tickets.cap-tickets.count);
        raidTicketsAdded=added;
        tickets.count+=added;patch.raidTickets=tickets;user.raidTickets=tickets;
        if(!added){convertedRaidGold=Rules.meditationCoopReward(c.result.rewardScore,9).gold;gold+=convertedRaidGold;}
      }
      patch['stats.gold']=count(user.stats?.gold)+gold;
      patch.soulboundDrawTickets=count(user.soulboundDrawTickets)+reward.drawTickets;
      user.soulboundDrawTickets=patch.soulboundDrawTickets;user.stats ||= {};user.stats.gold=patch['stats.gold'];
      if(reward.fragments){const growth=Growth.award(user,reward.fragments);Object.assign(patch,Growth.patch(growth));Growth.apply(user,growth);}
      tx.update(c.refs.user,patch);
      c.result={...c.result,claimed:[...claimed,body.stars],bestStars:c.stars};
      tx.set(c.refs.result,c.result);
      return {...view(c,uid,date),claimedNow:true,reward:{...reward,gold,raidTickets:raidTicketsAdded,convertedRaidGold},economy:economy(user)};
    });
  }
  return {status,start,answer,next,finish,claim};
}
function createHandler({action='status',resolveA=()=>playerRepository.resolve(),now=Date.now,random=Math.random,logger=console}={}) {
  return async (req,res)=>{
    res.set?.('Cache-Control','private, no-store');
    try {
      const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization')||''));
      if(!match)throw fail('請先登入再閉關',401);
      const a=resolveA();let identity;
      try{identity=await a.auth.verifyIdToken(match[1],true);}catch(_){throw fail('登入已失效，請重新登入',401);}
      if(!validUid(identity?.uid)||identity.aud!==PROJECT_IDS.A||identity.iss!=='https://securetoken.google.com/'+PROJECT_IDS.A)throw fail('登入身分驗證失敗',401);
      const service=createService({db:a.db,now,random});
      return res.json({ok:true,...await service[action](identity.uid,req.body||{})});
    }catch(error){if(!error.status)logger.error('[Meditation]',error.message);return res.status(error.status||503).json({ok:false,error:error.status?error.message:'閉關同步未完成，請重試原操作'});}
  };
}
module.exports=app=>{for(const action of ['status','start','answer','next','finish','claim'])app.post('/api/meditation/'+action,createHandler({action}));};
module.exports.__test={createService,createHandler,publicSession,dayId,RESULTS,SESSIONS,dailyResult};
