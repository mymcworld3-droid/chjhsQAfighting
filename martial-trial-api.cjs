'use strict';
const crypto=require('node:crypto');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const {trustedRaidPlayerSnapshot}=require('./raid-authority.cjs');
const Combat=require('./immortal-avatar-combat.cjs');
const Access=require('./public/cultivation/training-access-rules.js');
const COLLECTION='martialTrialStates',MAX_FLOOR=100,TTL=2*60*60*1000,TURN_DELAY=300;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const count=n=>Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0;
const clone=x=>JSON.parse(JSON.stringify(x));
const ref=(db,uid)=>db.collection(COLLECTION).doc(uid);
const checkpoint=best=>Math.min(96,Math.floor(count(best)/5)*5+1);
function title(best){return best>=100?'萬象破陣者':best>=50?'演武宗師':best>=20?'百戰修士':best>=5?'入陣修士':'初入演武';}
function enemy(floor){
 const names=['逐風劍衛','鎮岳守衛','霆霄靈衛','赤焰戰傀','星陣守將'];
 const atk=Math.round(90+floor*4+.25*floor**1.1),maxHp=Math.round(700+floor*50+2*floor**1.2);
 const type=['sword','ocean','thunder','reverse','xingchen'][(Math.ceil(floor/5)-1)%5];
 return {uid:'trial-guard-'+floor,name:names[(floor-1)%5],atk,baseAtk:atk,hp:maxHp,maxHp,baseMaxHp:maxHp,
  totalScore:188,trainingAccessScore:188,goldenCore:floor>=5?{type,name:{sword:'破鋒劍心丹',ocean:'大海無垠丹',thunder:'萬劫雷霆丹',reverse:'陰陽反轉丹',xingchen:'星辰吞月丹'}[type],grade:Math.max(3,9-Math.floor(floor/15))}:null,
  nascentSoul:null,innateAbility:null,innateAbilityState:null,coreShield:false,coreCorrectStreak:0,soulStarCorrectWindow:0,
  artifactBattle:{version:1,effects:[],openingShield:0},artifactShield:0,artifactFirstHitUsed:false,artifactCheatDeathUsed:false};
}
function encounter(build,runId,floor,now){
 return {runId,floor,status:'active',round:0,charge:0,style:['assault','counter','sustain'][(floor-1)%3],
  formation:clone(build),challenger:clone(build),defender:enemy(floor),startedAtMs:now,expiresAtMs:now+TTL,lastTurnAtMs:0,lastTurn:null};
}
function fighter(p){return {name:p.name,atk:p.atk,hp:p.hp,maxHp:p.maxHp,shield:count(p.artifactShield),
 power:count(p.combatPower||p.power),portrait:p.portrait||'',core:p.goldenCore?.name||'',
 equipment:[...new Set((p.artifactBattle?.effects||[]).map(e=>e.artifactName).filter(Boolean))]};}
function view(record,now=Date.now()){
 const bestFloor=Math.min(MAX_FLOOR,count(record?.bestFloor)),run=record?.run;
 const state={bestFloor,title:title(bestFloor),checkpoint:checkpoint(bestFloor),maxFloor:MAX_FLOOR,totalWins:count(record?.totalWins),status:'idle'};
 if(!run)return state;
 const expired=run.expiresAtMs<=now&&['active','cleared'].includes(run.status);
 return {...state,runId:run.runId,status:expired?'expired':run.status,floor:run.floor,round:run.round,maxRounds:24,
  charge:run.charge,challenger:fighter(run.challenger),defender:fighter(run.defender),
  intent:Combat.intent(run.style,run.round+1),lastTurn:run.lastTurn,expiresAtMs:run.expiresAtMs};
}
function requestKey(body){const id=String(body?.requestId||'');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw fail('操作識別碼無效，請重新同步',400);return id;}
function signature(action,body){
 if(action==='start')return JSON.stringify([action,body.floor===undefined?null:Number(body.floor)]);
 const runId=String(body.runId||'');
 return JSON.stringify([action,runId.length<=80?runId:'invalid',Number(body.floor),Number(body.round),action==='turn'?body.tactic:'']);
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
  const user=p.data();if(Access.score(user)<28)throw fail('金丹境開放演武試煉',403);
  const record=s.exists?s.data():{version:1,uid,bestFloor:0,totalWins:0,run:null};
  const repeated=replay(record,'start',body,now);if(repeated)return repeated;
  if(record.run?.expiresAtMs>now&&['active','cleared'].includes(record.run.status))return view(record,now);
  const floor=body.floor===undefined?checkpoint(record.bestFloor):Number(body.floor);
  if(!Number.isInteger(floor)||floor<1||floor>checkpoint(record.bestFloor)||(floor!==1&&(floor-1)%5!==0))throw fail('請由已解鎖的演武起點開始',400);
  const build=trustedRaidPlayerSnapshot(user,uid,c.exists?c.data():{});
  // Combat state is temporary; no permanent HP, currency, items or learning rewards change.
  build.hp=build.maxHp;build.coreShield=false;
  record.run=encounter(build,crypto.randomUUID(),floor,now);remember(record,'start',body);
  tx.set(ref(db,uid),record);return view(record,now);
 });
}
async function act(db,uid,action,body={},now=Date.now()){
 requestKey(body);
 if(!['turn','next','abandon'].includes(action))throw fail('演武操作無效',400);
 if(action==='turn'&&!['assault','guard','charge'].includes(body.tactic))throw fail('請選擇有效戰術',400);
 return db.runTransaction(async tx=>{
  const s=await tx.get(ref(db,uid)),record=s.exists?s.data():null;
  const repeated=replay(record,action,body,now);if(repeated)return repeated;
  const run=record?.run;
  if(!run||body.runId!==run.runId||body.floor!==run.floor||body.round!==run.round)throw fail('戰場進度已更新，請重新同步');
  if(run.expiresAtMs<=now)throw fail('演武已逾時，請重新開陣',410);
  if(action==='abandon'){run.status='abandoned';}
  else if(action==='next'){
   if(run.status!=='cleared'||run.floor>=MAX_FLOOR)throw fail('擊破當層守衛後才能繼續');
   record.run=encounter(run.formation,crypto.randomUUID(),run.floor+1,now);
  }else{
   if(run.status!=='active')throw fail('這一層已經結束，請繼續或重新開陣');
   if(run.lastTurnAtMs&&now-run.lastTurnAtMs<TURN_DELAY)throw fail('招式尚未結束，請稍候',429);
   const outcome=Combat.settle(run,true,body.tactic);
   Object.assign(run,{round:outcome.round,charge:outcome.charge,challenger:outcome.challenger,defender:outcome.defender,lastTurnAtMs:now,
    lastTurn:{notes:outcome.notes.map(n=>n.replaceAll('化身','守衛')),logs:outcome.logs.slice(-24),activations:outcome.activations.slice(-12)}});
   if(outcome.finished){
    run.status=outcome.won?(run.floor===MAX_FLOOR?'complete':'cleared'):'defeated';
    if(outcome.won){record.bestFloor=Math.max(count(record.bestFloor),run.floor);record.totalWins=count(record.totalWins)+1;}
   }
  }
  remember(record,action,body);tx.set(ref(db,uid),record);return view(record,now);
 });
}
function handler(action,{resolveA=()=>playerRepository.resolve(),clock=()=>Date.now(),logger=console}={}){
 return async(req,res)=>{
  res.set?.('Cache-Control','no-store');
  try{
   const uid=await verifyMainIdentity(req,{resolveA}),db=resolveA().db,now=clock();
   const state=action==='status'?await ref(db,uid).get().then(s=>view(s.exists?s.data():null,now)):
    action==='start'?await start(db,uid,req.body,now):await act(db,uid,action,req.body,now);
   res.json({ok:true,state});
  }catch(e){if(!e.status)logger.error('[Martial trial]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'演武同步未完成，請重試原操作'});}
 };
}
module.exports=app=>{app.get('/api/martial-trial',handler('status'));for(const action of ['start','turn','next','abandon'])app.post('/api/martial-trial/'+action,handler(action));};
module.exports.__test={COLLECTION,MAX_FLOOR,TTL,TURN_DELAY,start,act,view,enemy,checkpoint,handler};
