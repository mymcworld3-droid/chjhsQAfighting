'use strict';
const crypto=require('node:crypto');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity,issueRaidQuestionTicket,readRaidQuestionTicket,assertRaidQuestionTicket}=require('./raid-question-ticket.cjs');
const {educationCohort,TRIBULATION_SCORE}=require('./world-immortals-cleanup-api.cjs').__test;
const Combat=require('./immortal-avatar-combat.cjs');
const Knowledge=require('./public/cultivation/knowledge-points.js');
const COLLECTION='immortalAvatarSessions',TTL=60*60*1000,MAX_ROUNDS=24;
const ROLES=Object.freeze({'ru-xian':{name:'儒仙',subject:'國文'},'fa-xian':{name:'法仙',subject:'社會'},
  'suan-xian':{name:'算仙',subject:'數學'},'xuan-xian':{name:'玄仙',subject:'自然'},'wai-xian':{name:'外仙',subject:'英文'}});
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const clean=(value,n=100)=>String(value||'').trim().slice(0,n);
const count=n=>Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0;
const ref=(db,uid)=>db.collection(COLLECTION).doc(uid);
const seatId=(cohort,role)=>cohort+'__'+role;
function eligible(user,cohort){return !!user&&count(user.stats?.totalScore)>=TRIBULATION_SCORE&&educationCohort(user.profile?.educationLevel)===cohort;}
function checkPlayer(user,cohort){
  if(!user)throw fail('玩家資料不存在',404);
  if(count(user.stats?.totalScore)<TRIBULATION_SCORE)throw fail('渡劫境（1268 修為）以上才能問鼎仙位',403);
  if(!cohort||educationCohort(user.profile?.educationLevel)!==cohort)throw fail('年級已變更，請返回自己的仙榜',409);
}
function revision(seat){return seat?clean(seat.avatarRevision,100)||crypto.createHash('sha256').update(JSON.stringify([seat.uid,seat.claimedAt||null,seat.challengeScore||0])).digest('hex'):'';}
function publicQuestion(q){return q?{id:q.id,q:q.q,opts:q.opts,ticket:q.ticket,expiresAtMs:q.expiresAtMs,
  subject:q.subject,level:q.level,...Knowledge.metadata(q,q.subject)}:null;}
function fighter(player){return {name:player.name,hp:player.hp,maxHp:player.maxHp,atk:player.atk,power:player.power,
  shield:count(player.artifactShield),goldenCore:player.goldenCore,nascentSoul:!!player.nascentSoul,
  innateAbility:player.innateAbility? '本命神通已啟用' : '',equipment:player.equipment||[]};}
function snapshot(state,now=Date.now()){
  if(!state)return {status:'idle'};
  const expired=state.status==='active'&&state.expiresAtMs<=now;
  return {runId:state.runId,role:state.role,roleName:ROLES[state.role].name,subject:ROLES[state.role].subject,
    cohort:state.cohort,level:state.level,status:expired?'expired':state.status,
    round:state.round,maxRounds:MAX_ROUNDS,charge:state.charge,style:state.style,styleName:Combat.STYLES[state.style],
    practice:state.practice,npc:state.npc,challenger:fighter(state.challenger),defender:fighter(state.defender),
    intent:Combat.intent(state.style,state.round+1),question:!expired&&state.pendingQuestion?.expiresAtMs>now?publicQuestion(state.pendingQuestion):null,
    lastReview:state.lastReview||null,result:state.result||null,expiresAtMs:state.expiresAtMs};
}
async function start(db,uid,body={},now=Date.now()){
  const role=clean(body.role),style=body.style||'assault';
  if(!ROLES[role]||!Object.hasOwn(Combat.STYLES,style))throw fail('仙位或守擂風格無效',400);
  return db.runTransaction(async tx=>{
    const [playerSnap,sessionSnap,configSnap]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(ref(db,uid)),
      tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);
    const user=playerSnap.exists?playerSnap.data():null,cohort=educationCohort(user?.profile?.educationLevel);
    checkPlayer(user,cohort);
    const live=sessionSnap.exists?sessionSnap.data():null;
    if(live?.status==='active'&&live.expiresAtMs>now){
      if(live.role!==role||live.cohort!==cohort)throw fail('還有一場化身挑戰，請先返回該場或結束挑戰');
      return snapshot(live,now);
    }
    const seats=await Promise.all(Object.keys(ROLES).map(id=>tx.get(db.collection('worldImmortals').doc(seatId(cohort,id)))));
    if(seats.some((s,i)=>s.exists&&s.data().uid===uid&&Object.keys(ROLES)[i]!==role))throw fail('每名修士同時只能據有一席仙位，請回到自己的仙位試陣');
    const raw=seats[Object.keys(ROLES).indexOf(role)],seat=raw.exists?raw.data():null;
    const ownerSnap=seat?.uid?await tx.get(db.collection('users').doc(seat.uid)):null;
    const target=seat&&eligible(ownerSnap?.exists?ownerSnap.data():null,cohort)?seat:null;
    const config=configSnap.data()||{},challenger=Combat.snapshot(uid,user,config);
    let defender=target?.avatarVersion===2&&target.avatar?structuredClone(target.avatar):
      target?Combat.snapshot(target.uid,ownerSnap.data(),config):
        Combat.snapshot('npc-'+role,{displayName:ROLES[role].name+'鎮殿化身',stats:{attack:160,maxHp:1000,totalScore:1268}},config);
    // Defending against your own snapshot is practice. Distinct IDs are required
    // for combat seeds and winner selection even when both builds share an owner.
    defender.uid='avatar-'+(target?.uid||role);defender.hp=defender.maxHp;
    const state={version:2,runId:crypto.randomUUID(),role,cohort,style:Object.hasOwn(Combat.STYLES,target?.avatarStyle)?target.avatarStyle:'assault',claimStyle:style,
      level:cohort==='elementary'?'國小高年級':'國中三年級',challenger,defender,initialAvatar:structuredClone(challenger),
      targetUid:target?.uid||'',targetRevision:revision(target),practice:target?.uid===uid,npc:!target,
      round:0,charge:0,status:'active',pendingQuestion:null,lastReview:null,lastRequest:null,
      history:[],startedAtMs:now,expiresAtMs:now+TTL,result:null};
    tx.set(ref(db,uid),state);return snapshot(state,now);
  });
}
async function configure(db,uid,body={},now=Date.now()){
  if(!ROLES[body.role]||!Object.hasOwn(Combat.STYLES,body.style))throw fail('請選擇有效的仙位與守擂風格',400);
  return db.runTransaction(async tx=>{
    const [p,c]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);
    const user=p.exists?p.data():null,cohort=educationCohort(user?.profile?.educationLevel);checkPlayer(user,cohort);
    const seatRef=db.collection('worldImmortals').doc(seatId(cohort,body.role)),seat=await tx.get(seatRef);
    if(!seat.exists||seat.data()?.uid!==uid)throw fail('只有在榜仙主能更新自己的守擂化身',403);
    const avatar=Combat.snapshot(uid,user,c.data()||{});
    tx.update(seatRef,{avatarVersion:2,avatar,avatarPower:avatar.power,avatarStyle:body.style,
      avatarRevision:crypto.randomUUID(),avatarUpdatedAtMs:now});
    return {ok:true,avatar:fighter(avatar),style:body.style};
  });
}
async function prepareQuestion(db,uid,now=Date.now()){
  const s=await ref(db,uid).get(),state=s.exists?s.data():null;
  if(!state||state.status!=='active'||state.expiresAtMs<=now)throw fail('本次化身挑戰已結束，請重新挑戰');
  return {runId:state.runId,index:state.round,subject:ROLES[state.role].subject,level:state.level,
    history:state.history||[],pending:state.pendingQuestion?.expiresAtMs>now?publicQuestion(state.pendingQuestion):null};
}
async function commitQuestion(db,uid,expected,parsed,now=Date.now()){
  const opts=[clean(parsed?.correct,500),...(Array.isArray(parsed?.wrong)?parsed.wrong.map(x=>clean(x,500)):[])];
  if(!clean(parsed?.q,3000)||opts.length!==4||opts.some(x=>!x)||new Set(opts).size!==4)throw fail('題目選項驗證未通過');
  let answerIndex=0;
  for(let i=3;i>0;i--){const j=crypto.randomInt(i+1);[opts[i],opts[j]]=[opts[j],opts[i]];if(answerIndex===i)answerIndex=j;else if(answerIndex===j)answerIndex=i;}
  const id='avatar-'+crypto.randomUUID();
  const ticket=issueRaidQuestionTicket({uid,roomId:expected.runId,actionId:expected.index+1,questionId:id,
    answerIndex,explanation:clean(parsed.exp,3000)},{now});
  const fresh={id,q:clean(parsed.q,3000),opts,ticket,subject:expected.subject,level:expected.level,
    ...Knowledge.metadata(parsed,expected.subject),expiresAtMs:Math.min(readRaidQuestionTicket(ticket,{now}).expiresAtMs,now+TTL)};
  return db.runTransaction(async tx=>{
    const s=await tx.get(ref(db,uid)),state=s.exists?s.data():null;
    if(!state||state.status!=='active'||state.expiresAtMs<=now||state.runId!==expected.runId||state.round!==expected.index)throw fail('挑戰回合已更新，請同步戰場');
    if(state.pendingQuestion?.expiresAtMs>now)return publicQuestion(state.pendingQuestion);
    if(state.history.includes(fresh.q))throw fail('題目重複，請重新取得');
    tx.update(ref(db,uid),{pendingQuestion:fresh});return publicQuestion(fresh);
  });
}
async function answer(db,uid,body={},now=Date.now()){
  const choice=Number(body.choice),tactic=body.tactic;
  if(!Number.isInteger(choice)||choice<0||choice>3||!['assault','guard','charge'].includes(tactic))throw fail('請選擇作戰方式與答案',400);
  const token=clean(body.ticket,12000),raw=readRaidQuestionTicket(token,{now});
  const verified=assertRaidQuestionTicket(raw,{uid,roomId:body.runId,actionId:Number(body.round)+1,questionId:body.questionId});
  const signature=JSON.stringify([body.questionId,choice,tactic,token]);
  return db.runTransaction(async tx=>{
    const [sessionSnap,playerSnap]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
    const state=sessionSnap.exists?sessionSnap.data():null,user=playerSnap.exists?playerSnap.data():null;
    if(!state||state.runId!==body.runId)throw fail('挑戰不存在，請同步戰場');
    if(state.lastRequest===signature)return {ok:true,state:snapshot(state,now)};
    checkPlayer(user,state.cohort);
    const q=state.pendingQuestion;
    if(state.status!=='active'||state.expiresAtMs<=now||state.round!==Number(body.round)||
      q?.id!==body.questionId||q?.ticket!==token||q?.expiresAtMs<=now)throw fail('此題已結算或與本回合不符，請同步戰場');
    const correct=choice===verified.answerIndex,outcome=Combat.settle(state,correct,tactic);
    const next={...state,round:outcome.round,charge:outcome.charge,challenger:outcome.challenger,defender:outcome.defender,
      pendingQuestion:null,lastRequest:signature,history:[...state.history,q.q].slice(-MAX_ROUNDS),
      lastReview:{questionId:q.id,correct,correctIndex:verified.answerIndex,selectedChoice:choice,explanation:clean(raw.explanation,3000),
        tactic,round:outcome.round,notes:outcome.notes,logs:outcome.logs,activations:outcome.activations}};
    if(outcome.finished){
      const roleKeys=Object.keys(ROLES),seatRefs=roleKeys.map(id=>db.collection('worldImmortals').doc(seatId(state.cohort,id)));
      const seats=await Promise.all(seatRefs.map(r=>tx.get(r))),targetIndex=roleKeys.indexOf(state.role);
      const liveSeat=seats[targetIndex].exists?seats[targetIndex].data():null;
      const liveOwner=liveSeat?.uid?await tx.get(db.collection('users').doc(liveSeat.uid)):null;
      const validSeat=liveSeat&&eligible(liveOwner?.exists?liveOwner.data():null,state.cohort)?liveSeat:null;
      const sameTarget=revision(validSeat)===state.targetRevision&&(validSeat?.uid||'')===state.targetUid;
      const otherSeat=seats.some((s,i)=>i!==targetIndex&&s.exists&&s.data().uid===uid);
      const result=state.practice?'practice':!sameTarget?'changed':outcome.won&&otherSeat?'already-other':outcome.won?'claimed':outcome.reason;
      next.status='completed';next.finishedAtMs=now;next.result={code:result,won:outcome.won,claimed:result==='claimed'};
      if(result==='claimed'){
        // Store a fresh, full-health copy of the build that actually won.
        const avatar=structuredClone(state.initialAvatar);
        tx.set(seatRefs[targetIndex],{uid,cohort:state.cohort,role:state.role,subject:ROLES[state.role].subject,
          displayName:clean(user.displayName||user.name||'無名仙客',60),claimedAtMs:now,
          avatarVersion:2,avatar,avatarPower:avatar.power,avatarStyle:state.claimStyle,
          avatarRevision:crypto.randomUUID(),avatarUpdatedAtMs:now,defenseWins:0,recentDefenses:[]});
      }else if(sameTarget&&validSeat&&!state.practice){
        tx.update(seatRefs[targetIndex],{defenseWins:count(validSeat.defenseWins)+(outcome.won?0:1),
          recentDefenses:[{challenger:clean(user.displayName||user.name||'無名仙客',60),won:outcome.won,
            round:outcome.round,atMs:now},...(validSeat.recentDefenses||[])].slice(0,8)});
      }
    }
    // Durable study history is part of settlement, even if the browser closes.
    const point=Knowledge.label(q,ROLES[state.role].subject);
    const logKey=('immortal_'+uid+'_'+state.runId+'_'+outcome.round).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,480);
    tx.set(db.collection('exam_logs').doc(logKey),{uid,email:clean(user.email,200),timestamp:new Date(now),
      mode:'immortal',topic:'Immortal',rankAtTime:'化身問鼎 · '+ROLES[state.role].name,
      question:q.q,options:q.opts,correctIdx:verified.answerIndex,userIdx:choice,isCorrect:correct,
      explanation:clean(raw.explanation,3000),subject:ROLES[state.role].subject,subTopic:ROLES[state.role].name,
      knowledgeSubject:point?.subject||'',knowledgePointId:point?.id||'',knowledgePoint:point?.name||'',
      knowledgePoints:Knowledge.labels(q,ROLES[state.role].subject),timeTaken:0});
    if(point)tx.update(db.collection('users').doc(uid),{
      'stats.knowledgePointMapV1':Knowledge.record(user.stats?.knowledgePointMapV1||{},q,correct)});
    tx.set(ref(db,uid),next);return {ok:true,state:snapshot(next,now)};
  });
}
async function abandon(db,uid,body={},now=Date.now()){
  return db.runTransaction(async tx=>{
    const s=await tx.get(ref(db,uid)),state=s.exists?s.data():null;
    if(!state||state.runId!==body.runId)throw fail('挑戰進度已更新，請同步戰場');
    if(state.status==='active'){state.status='abandoned';state.pendingQuestion=null;tx.set(ref(db,uid),state);}
    return {ok:true,state:snapshot(state,now)};
  });
}
function handler(action,{resolveA=()=>playerRepository.resolve(),clock=()=>Date.now(),logger=console}={}){
  return async(req,res)=>{
    res.set?.('Cache-Control','no-store');
    try{
      const uid=await verifyMainIdentity(req,{resolveA}),db=resolveA().db,now=clock();
      if(action==='status'){const s=await ref(db,uid).get();return res.json({ok:true,state:snapshot(s.exists?s.data():null,now)});}
      if(action==='start')return res.json({ok:true,state:await start(db,uid,req.body,now)});
      return res.json(await ({configure,answer,abandon}[action])(db,uid,req.body,now));
    }catch(e){if(!e.status)logger.error('[Immortal avatar]',e.message);
      return res.status(e.status||503).json({ok:false,error:e.status?e.message:'化身戰場同步暫時未完成，請重試原操作'});}
  };
}
module.exports=app=>{
  app.get('/api/immortals/challenge',handler('status'));
  for(const action of ['start','configure','answer','abandon'])app.post('/api/immortals/challenge/'+action,handler(action));
};
module.exports.__test={start,configure,prepareQuestion,commitQuestion,answer,abandon,snapshot,handler,revision,eligible,COLLECTION,MAX_ROUNDS};
