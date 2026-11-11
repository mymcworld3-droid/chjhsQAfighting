'use strict';
const crypto=require('node:crypto');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const {trustedRaidPlayerSnapshot}=require('./raid-authority.cjs');
const StudyScope=require('./trial-tower-scope.cjs');
const Knowledge=require('./public/cultivation/knowledge-points.js');
const Combat=require('./immortal-avatar-combat.cjs');
const Access=require('./public/cultivation/training-access-rules.js');
const Rewards=require('./public/cultivation/trial-tower-rewards.js');
const Guards=require('./public/cultivation/trial-tower-guards.js');
const COLLECTION='martialTrialStates',MAX_FLOOR=100,TTL=2*60*60*1000,TURN_DELAY=300;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const count=n=>Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0;
const clone=x=>JSON.parse(JSON.stringify(x));
const ref=(db,uid)=>db.collection(COLLECTION).doc(uid);
const checkpoint=Guards.nextFloor;
function title(best){return best>=100?'萬象破陣者':best>=50?'試煉宗師':best>=20?'破陣行者':best>=5?'登塔修士':'初入試煉';}
const enemy=Guards.enemy;
function encounter(build,runId,floor,now){
 const pair=Combat.trialPair(build,enemy(floor));
 return {version:2,runId,floor,status:'active',round:0,formation:clone(build),challenger:pair.host,defender:pair.guest,
  pendingQuestion:null,history:[],startedAtMs:now,expiresAtMs:now+TTL,lastTurnAtMs:0,lastTurn:null};
}
function publicQuestion(q){return q?{id:q.id,q:q.q,opts:q.opts,subject:q.subject,level:q.level,topic:q.topic||'',difficulty:q.difficulty||'medium',help:count(q.help),adaptive:q.adaptive||null,meta:q.meta||{},recoveryOrigin:q.recoveryOrigin||'',extendedPractice:!!q.extendedPractice,practicePoint:q.practicePoint||'',...Knowledge.metadata(q,q.subject)}:null;}
function fighter(p){return {uid:p.uid,realm:p.realm||'',gender:p.gender||'',name:p.name,atk:p.atk,hp:p.hp,maxHp:p.maxHp,shield:count(p.artifactShield),
 power:count(p.combatPower||p.power),portrait:p.portrait||'',core:p.goldenCore?.name||'',goldenCore:p.goldenCore||null,
 equipment:[...new Set((p.artifactBattle?.effects||[]).map(e=>e.artifactName).filter(Boolean))]};}
function guardianView(run){
 const {name,realm,portrait}=Guards.enemy(run.floor);
 // Existing fights retain their HP, abilities, round and build; only the
 // displayed guardian identity follows the new roster until the next floor.
 return {...fighter(run.defender),name,realm,portrait};
}
function view(record,now=Date.now()){
 const bestFloor=Math.min(MAX_FLOOR,count(record?.bestFloor)),run=record?.run;
 const state={bestFloor,title:title(bestFloor),checkpoint:checkpoint(bestFloor),maxFloor:MAX_FLOOR,totalWins:count(record?.totalWins),status:'idle',
  activeExtension:record?.activeExtension?{id:record.activeExtension.id,point:record.activeExtension.point}:null,queuedPractice:(record?.practiceQueue||[]).map(p=>({id:p.id,questionId:p.questionId,point:p.point,correction:p.correction})),rewardVersion:Rewards.VERSION,claimedFloors:Rewards.claimed(record||{}),unclaimedFloors:Rewards.pending(record||{}),unclaimedTicketFloors:Rewards.ticketBackfill(record||{}),unclaimedBonusFloors:Rewards.bonusPending(record||{})};
 if(!run||run.version!==2)return {...state,rulesUpdated:!!run};
 const expired=run.expiresAtMs<=now&&['active','cleared'].includes(run.status);
 return {...state,runId:run.runId,status:expired?'expired':run.status,floor:run.floor,round:run.round,maxRounds:24,
  question:publicQuestion(run.pendingQuestion),challenger:fighter(run.challenger),defender:guardianView(run),
  lastTurn:run.lastTurn,lastReward:run.lastReward||null,expiresAtMs:run.expiresAtMs};
}
function plannedPractice(record){return record.practiceQueue?.[0]||record.activeExtension||null;}
function refreshStudyScope(record,user){
 const run=record?.run;if(run?.version!==2||run.status!=='active')return false;
 const scope=StudyScope.snapshot(user),scopeKey=StudyScope.key(scope);
 if(record.scopeKey===scopeKey&&(!run.pendingQuestion||run.pendingQuestion.scopeKey===scopeKey))return false;
 record.knowledgeScope=scope;record.scopeKey=scopeKey;run.pendingQuestion=null;record.practiceQueue=(record.practiceQueue||[]).filter(p=>p.scopeKey===scopeKey);if(record.activeExtension?.scopeKey!==scopeKey)record.activeExtension=null;return true;
}
function economy(user){return {gold:count(user.stats?.gold),forgeFragments:count(user.forgeFragments),drawTickets:count(user.soulboundDrawTickets),
 materials:Object.fromEntries(Object.keys(Rewards.ITEMS).map(id=>[id,count(user.materialSystem?.inventory?.[id])]))};}
function award(record,user,floors,ticketFloors=[],bonusFloors=[]){
 const allowed=new Set(Rewards.pending(record)),earned=[...new Set(floors)].filter(f=>allowed.has(f));
 const ticketAllowed=new Set(Rewards.ticketBackfill(record)),tickets=[...new Set(ticketFloors)].filter(f=>ticketAllowed.has(f));
 const bonusAllowed=new Set(Rewards.bonusPending(record)),bonuses=[...new Set(bonusFloors)].filter(f=>bonusAllowed.has(f));
 if(!earned.length&&!tickets.length&&!bonuses.length)return null;
 const reward=Rewards.payout(earned,tickets,bonuses);
 const patch={
  'stats.gold':count(user.stats?.gold)+reward.gold,forgeFragments:count(user.forgeFragments)+reward.forgeFragments,
  soulboundDrawTickets:count(user.soulboundDrawTickets)+reward.drawTickets
 };
 user.stats||={};user.stats.gold=patch['stats.gold'];user.forgeFragments=patch.forgeFragments;user.soulboundDrawTickets=patch.soulboundDrawTickets;
 user.materialSystem||={};user.materialSystem.inventory||={};
 for(const [id,quantity]of Object.entries(reward.materials)){
  const next=count(user.materialSystem.inventory[id])+quantity;user.materialSystem.inventory[id]=next;patch['materialSystem.inventory.'+id]=next;
 }
 record.rewardClaims=[...new Set([...Rewards.claimed(record),...earned])].sort((a,b)=>a-b);record.rewardVersion=Rewards.VERSION;
 // Preserve the unclaimed legacy ticket supplements when a newer floor clears.
 record.floorTicketClaims=[...new Set([...(Array.isArray(record.floorTicketClaims)?record.floorTicketClaims:[]),...earned,...tickets])].filter(f=>Number.isInteger(f)&&f>=1&&f<=MAX_FLOOR).sort((a,b)=>a-b);
 record.floorRewardVersions=Object.fromEntries(Rewards.claimed(record).filter(f=>Number(record.floorRewardVersions?.[f])>=Rewards.VERSION).map(f=>[f,record.floorRewardVersions[f]]));
 for(const floor of [...earned,...bonuses])record.floorRewardVersions[floor]=Rewards.VERSION;
 return {floors:earned,ticketFloors:tickets,bonusFloors:bonuses,reward,patch};
}
function result(record,user,now,granted){return {...view(record,now),economy:economy(user),...(granted?{awarded:{floors:granted.floors,ticketFloors:granted.ticketFloors,bonusFloors:granted.bonusFloors,reward:granted.reward}}:{})};}
function settleQuestion(record,user,q,choice,now,start=record.run,verifiedError=false){
 const run=record.run,revising=start.round<run.round,correct=Number.isInteger(choice)?choice===q.correctIndex:null;
 // Keep the entire private pre-round combat state: HP alone cannot restore shields,
 // one-use equipment or innate counters when an approved report corrects a round.
 run.lastTurnStart={questionId:q.id,runId:run.runId,round:start.round,challenger:clone(start.challenger),defender:clone(start.defender)};
 const outcome=Combat.settleTrial(run.lastTurnStart,verifiedError||correct===true),pending=run.pendingQuestion;
 run.lastQuestion=q;if(!revising)run.history=[...(run.history||[]),q.q].slice(-80);
 Object.assign(run,{status:'active',round:outcome.round,challenger:outcome.challenger,defender:outcome.defender,lastTurnAtMs:now,
  lastTurn:{question:publicQuestion(q),questionId:q.id,correct,correctIndex:q.correctIndex,selectedChoice:choice,explanation:q.exp,
   ...(verifiedError?{verifiedError:true}:{}),startHostHp:outcome.startHostHp,startGuestHp:outcome.startGuestHp,steps:outcome.steps,
   notes:verifiedError?['審查確認題目有誤，本回合取得先手攻擊；守衛存活時仍會後手攻擊。']:outcome.notes.map(n=>n.replaceAll('化身','守衛')),logs:outcome.logs.slice(-24),activations:outcome.activations.slice(-12)}});
 let granted=null;
 if(outcome.finished){
  run.status=outcome.won?(run.floor===MAX_FLOOR?'complete':'cleared'):'defeated';
  if(outcome.won){
   record.bestFloor=Math.max(count(record.bestFloor),run.floor);record.totalWins=count(record.totalWins)+1;
   granted=award(record,user,[run.floor]);if(granted)run.lastReward={floors:granted.floors,reward:granted.reward};
  }
 }
 // A correction/extension may already have prefetched the following question.
 run.pendingQuestion=revising&&run.status==='active'?pending:null;
 const logKey=('tower_'+record.uid+'_'+run.runId+'_'+outcome.round).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,480);
 const log={uid:record.uid,timestamp:new Date(now),mode:'trial-tower',topic:q.subject,
  rankAtTime:'試煉之塔 · 第 '+run.floor+' 層',question:q.q,options:q.opts,correctIdx:q.correctIndex,userIdx:choice,
  isCorrect:correct,explanation:q.exp,subject:q.subject,subTopic:q.topic||'',...Knowledge.metadata(q,q.subject),
  ...(verifiedError?{questionInvalid:true,combatAttackGranted:true}:{}),
  ...(q.adaptive?{adaptiveScopeId:q.adaptive.scopeId,adaptiveConceptId:q.adaptive.conceptId,adaptiveFacetId:q.adaptive.facetId,assistanceLevel:count(q.help),adaptiveSkipped:verifiedError}:{}),timeTaken:0};
 return {granted,logKey,log};
}
async function status(db,uid,now=Date.now()){
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  const record=s.exists?s.data():null;
  if(refreshStudyScope(record,p.data()))tx.set(ref(db,uid),record);
  return result(record,p.data(),now);
 });
}
function requestKey(body){const id=String(body?.requestId||'');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw fail('操作識別碼無效，請重新同步',400);return id;}
function signature(action,body){
 if(action==='start')return JSON.stringify([action,body.floor===undefined?null:Number(body.floor)]);
 if(action==='claim')return JSON.stringify([action]);
 const runId=String(body.runId||'');
 return JSON.stringify([action,runId.length<=80?runId:'invalid',Number(body.floor),Number(body.round),action==='turn'?[body.questionId,body.choice]:['replace','practice','hint'].includes(action)?[body.questionId,action==='practice'?String(body.point||'').slice(0,60):'',action==='practice'?!!body.correction:action==='hint'?Number(body.help):false]:'']);
}
function replay(record,action,body,now){
 const id=requestKey(body);
 const receipt=(record?.recentRequests||[]).find(row=>row.id===id)||(record?.lastRequest?.id===id?record.lastRequest:null);
 if(!receipt)return null;
 if(receipt.signature!==signature(action,body))throw fail('重送操作內容不一致，請同步戰場');
 return view(record,now);
}
function remember(record,action,body){
 record.lastRequest={id:requestKey(body),signature:signature(action,body)};
 record.recentRequests=[...(record.recentRequests||[]),record.lastRequest].slice(-64);
}
async function start(db,uid,body={},now=Date.now()){
 requestKey(body);
 return db.runTransaction(async tx=>{
  const [p,s,c]=await Promise.all([tx.get(db.collection('users').doc(uid)),tx.get(ref(db,uid)),tx.get(db.collection('gameConfig').doc('artifactCatalogV1'))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  const user=p.data();if(Access.score(user)<28)throw fail('金丹境開放試煉之塔',403);
  const record=s.exists?s.data():{version:1,uid,bestFloor:0,totalWins:0,run:null};
  const repeated=replay(record,'start',body,now);if(repeated)return {...repeated,economy:economy(user)};
  if(record.run?.version===2&&record.run?.expiresAtMs>now&&['active','cleared'].includes(record.run.status))return result(record,user,now);
  const floor=body.floor===undefined?checkpoint(record.bestFloor):Number(body.floor);
  if(!Number.isInteger(floor)||floor<1||floor>checkpoint(record.bestFloor))throw fail('請由已解鎖的試煉起點開始',400);
  const build=trustedRaidPlayerSnapshot(user,uid,c.exists?c.data():{});
  // Combat HP stays temporary; only verified first clears award resources.
  build.hp=build.maxHp;build.coreShield=false;build.gender=user.storyProgressV1?.gender==='female'?'female':'male';
  record.knowledgeScope=StudyScope.snapshot(user);record.scopeKey=StudyScope.key(record.knowledgeScope);
  record.run=encounter(build,crypto.randomUUID(),floor,now);remember(record,'start',body);
  tx.set(ref(db,uid),record);return result(record,user,now);
 });
}
async function act(db,uid,action,body={},now=Date.now()){
 requestKey(body);
 if(!['turn','next','abandon','claim','replace','practice','cancel-practice','hint'].includes(action))throw fail('闖塔操作無效',400);
 if(action==='turn'&&(!Number.isInteger(body.choice)||body.choice<0||body.choice>3||body.tactic!==undefined))throw fail('請選擇題目答案',400);
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  const record=s.exists?s.data():null,user=p.data();
  const repeated=replay(record,action,body,now);if(repeated)return {...repeated,economy:economy(user)};
  if(action==='claim'){
   if(!record)throw fail('尚無可領取的通關獎勵');
   const granted=award(record,user,Rewards.pending(record),Rewards.ticketBackfill(record),Rewards.bonusPending(record));
   if(granted)tx.update(db.collection('users').doc(uid),granted.patch);
   remember(record,action,body);tx.set(ref(db,uid),record);return result(record,user,now,granted);
  }
  const run=record?.run;
  let granted=null;
  if(!run||run.version!==2||body.runId!==run.runId||body.floor!==run.floor||body.round!==run.round)throw fail('戰場進度已更新，請重新同步');
  if(run.expiresAtMs<=now)throw fail('闖塔已逾時，請重新開陣',410);
  if(action==='hint'){
   const q=run.pendingQuestion;
   if(run.status!=='active'||q?.id!==body.questionId||!Number.isInteger(body.help)||body.help<1||body.help>3)throw fail('題目提示紀錄已更新，請重新同步');
   q.help=Math.max(count(q.help),body.help);
  }else if(action==='practice'){
   const q=[run.pendingQuestion,run.lastQuestion].find(q=>q?.id===body.questionId),point=String(body.point||'').trim().slice(0,60);
   if(!q||!point||q.scopeKey!==StudyScope.key(StudyScope.snapshot(user)))throw fail('題目或出題範圍已變更，請重新同步');
   if(body.correction&&!(run.lastTurn?.questionId===q.id&&run.lastTurn.correct===false))throw fail('答錯後才能加入訂正練習');
   const correction=!!body.correction,id=q.id+':'+(correction?'correction':'extension')+':'+point;
   const queue=record.practiceQueue||[];
   if(!queue.some(p=>p.id===id)&&run.pendingQuestion?.practiceId!==id){
    if(queue.length>=6)throw fail('已有六個練習排隊，請先完成目前題目');
    const practice={id,questionId:q.id,point,correction,scopeKey:q.scopeKey,subject:q.subject,level:q.level,
     topic:q.topic||'',origin:q.q,scopeUnit:q.scopeUnit||null,conceptId:q.adaptive?.conceptId||''};
    record.practiceQueue=correction?[practice,...queue]:[...queue,practice];
   }
  }else if(action==='cancel-practice'){
   record.practiceQueue=(record.practiceQueue||[]).filter(p=>p.correction);record.activeExtension=null;
  }else if(action==='replace'){
   const q=[run.pendingQuestion,run.lastQuestion].find(q=>q?.id===body.questionId);
   if(!['active','cleared','complete','defeated'].includes(run.status)||!q)throw fail('題目已更新，請重新同步');
   const key=require('./question-report-api.cjs').__test.reportKey(uid,q.q);
   const claim=await tx.get(db.collection('questionErrorCompensations').doc(key));
   if(!claim.exists||claim.data().uid!==uid)throw fail('題目尚未通過錯誤審核',403);
   if(run.lastTurn?.questionId===q.id){
    // Already granted, or the original correct answer already attacked/cleared.
    if(run.lastTurn.verifiedError||run.lastTurn.correct||['cleared','complete'].includes(run.status))run.lastTurn.verifiedError=true;
    else{
     const start=run.lastTurnStart;
     if(start?.questionId!==q.id||start.runId!==run.runId||start.round!==run.round-1)throw fail('此舊回合缺少完整戰鬥紀錄，無法補算；請由下一回合繼續');
     const settled=settleQuestion(record,user,q,run.lastTurn.selectedChoice,now,start,true);granted=settled.granted;
     tx.set(db.collection('exam_logs').doc(settled.logKey),settled.log);
    }
   }else{
    if(run.status!=='active'||run.pendingQuestion?.id!==q.id)throw fail('本回合已結束，請重新同步');
    const settled=settleQuestion(record,user,q,null,now,run,true);granted=settled.granted;
    tx.set(db.collection('exam_logs').doc(settled.logKey),settled.log);
   }
   if(granted)tx.update(db.collection('users').doc(uid),granted.patch);
  }else if(action==='abandon'){run.status='abandoned';run.pendingQuestion=null;}
  else if(action==='next'){
   if(run.status!=='cleared'||run.floor>=MAX_FLOOR)throw fail('擊破當層守衛後才能繼續');
   record.run=encounter(run.formation,crypto.randomUUID(),run.floor+1,now);
  }else{
   if(run.status!=='active')throw fail('這一層已經結束，請繼續或重新開陣');
   if(run.lastTurnAtMs&&now-run.lastTurnAtMs<TURN_DELAY)throw fail('招式尚未結束，請稍候',429);
   const q=run.pendingQuestion;
   if(!q||q.id!==body.questionId)throw fail('請先取得本回合題目並作答',409);
   if(q.scopeKey!==StudyScope.key(StudyScope.snapshot(user)))throw fail('出題範圍已變更，請同步戰場後重新取得題目');
   q.help=Math.max(count(q.help),Math.min(3,count(body.help)));
   const settled=settleQuestion(record,user,q,body.choice,now);granted=settled.granted;
   tx.set(db.collection('exam_logs').doc(settled.logKey),settled.log);
   if(granted)tx.update(db.collection('users').doc(uid),granted.patch);
  }
  remember(record,action,body);tx.set(ref(db,uid),record);return result(record,user,now,granted);
 });
}
async function prepareQuestion(db,uid,now=Date.now()){
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  const record=s.exists?s.data():null,run=record?.run;
  if(run?.version!==2||run.status!=='active'||run.expiresAtMs<=now)throw fail('請先開始試煉之塔',409);
  if(refreshStudyScope(record,p.data()))tx.set(ref(db,uid),record);
  const practice=plannedPractice(record);
  const target=practice?{subject:practice.subject,level:practice.level,difficulty:StudyScope.pick(record.knowledgeScope,p.data(),run.round+run.floor-1).difficulty,
   specificTopic:practice.topic,adaptiveScope:practice.scopeUnit||undefined,adaptiveConceptId:practice.conceptId,
   practiceId:practice.id,recoveryOrigin:practice.correction?practice.origin:'',extendedPractice:!practice.correction,practicePoint:practice.point,
   practiceInstruction:`在原本選定範圍內，針對「${practice.point}」生成${practice.correction?'同概念訂正':'延伸練習'}的新情境變式；不得重複原題或只換數字。原題為：${practice.origin}`}:StudyScope.pick(record.knowledgeScope,p.data(),run.round+run.floor-1);
  return {runId:run.runId,index:run.round,floor:run.floor,history:run.history||[],scopeKey:record.scopeKey,
   ...target,pending:publicQuestion(run.pendingQuestion)};
 });
}
async function commitQuestion(db,uid,expected,parsed,now=Date.now()){
 const clean=(v,n)=>String(v||'').trim().slice(0,n);
 const opts=[clean(parsed?.correct,500),...(Array.isArray(parsed?.wrong)?parsed.wrong.map(v=>clean(v,500)):[])];
 if(!clean(parsed?.q,3000)||opts.length!==4||opts.some(v=>!v)||new Set(opts).size!==4)throw fail('題目驗證未通過');
 let correctIndex=0;for(let i=3;i>0;i--){const j=crypto.randomInt(i+1);[opts[i],opts[j]]=[opts[j],opts[i]];if(correctIndex===i)correctIndex=j;else if(correctIndex===j)correctIndex=i;}
 const q={id:'tower-'+crypto.randomUUID(),q:clean(parsed.q,3000),opts,correctIndex,exp:clean(parsed.exp,3000),
  scopeKey:expected.scopeKey,scopeUnit:expected.adaptiveScope||null,adaptive:parsed.adaptive||null,
  meta:Object.fromEntries(['question_form','concept_id','template_id','cognitive_level','reasoning_steps'].map(k=>[k,parsed[k]??null])),
  difficulty:parsed.adaptive?.difficulty||expected.difficulty,practiceId:expected.practiceId||'',recoveryOrigin:expected.recoveryOrigin||'',extendedPractice:!!expected.extendedPractice,practicePoint:expected.practicePoint||'',
  subject:expected.subject||parsed.subject||'題庫',level:expected.level,topic:expected.specificTopic||'',...Knowledge.metadata(parsed,expected.subject)};
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  const record=s.exists?s.data():null,run=record?.run;
  if(!p.exists)throw fail('玩家資料不存在',404);
  if(expected.scopeKey!==StudyScope.key(StudyScope.snapshot(p.data())))throw fail('出題範圍已變更，請重新取得題目');
  if(run?.version!==2||run.status!=='active'||run.expiresAtMs<=now||run.runId!==expected.runId||run.round!==expected.index||run.floor!==expected.floor)throw fail('回合已更新，請同步戰場');
  if(run.pendingQuestion)return publicQuestion(run.pendingQuestion);
  if((plannedPractice(record)?.id||'')!==(expected.practiceId||''))throw fail('練習順序已更新，請重新取得題目');
  if(!expected.bankSource&&run.history.includes(q.q))throw fail('題目重複，請重新取得');
  run.pendingQuestion=q;if(expected.practiceId){const practice=plannedPractice(record);if(record.practiceQueue?.[0]?.id===expected.practiceId)record.practiceQueue.shift();if(practice&&!practice.correction)record.activeExtension=practice;}tx.set(ref(db,uid),record);return publicQuestion(q);
 });
}
async function reportInput(db,uid,body,now=Date.now()){
 const s=await ref(db,uid).get(),run=s.exists?s.data().run:null;
 const q=[run?.pendingQuestion,run?.lastQuestion].find(q=>q?.id===body.towerQuestionId);
 if(run?.version!==2||run.runId!==body.towerRunId||!q||run.expiresAtMs<=now)throw fail('回報題目已更新，請重新開啟',409);
 return {question:q.q,options:q.opts,correctIndex:q.correctIndex,explanation:q.exp,userReason:body.userReason};
}
function handler(action,{resolveA=()=>playerRepository.resolve(),clock=()=>Date.now(),logger=console}={}){
 return async(req,res)=>{
  res.set?.('Cache-Control','no-store');
  try{
   const uid=await verifyMainIdentity(req,{resolveA}),db=resolveA().db,now=clock();
   const state=action==='status'?await status(db,uid,now):
    action==='start'?await start(db,uid,req.body,now):await act(db,uid,action,req.body,now);
   res.json({ok:true,state});
  }catch(e){if(!e.status)logger.error('[Martial trial]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'試煉同步未完成，請重試原操作'});}
 };
}
module.exports=app=>{app.get('/api/martial-trial',handler('status'));for(const action of ['start','turn','next','abandon','claim','replace','practice','cancel-practice','hint'])app.post('/api/martial-trial/'+action,handler(action));};
module.exports.__test={COLLECTION,MAX_FLOOR,TTL,TURN_DELAY,start,act,status,view,enemy,checkpoint,handler,prepareQuestion,commitQuestion,reportInput};
