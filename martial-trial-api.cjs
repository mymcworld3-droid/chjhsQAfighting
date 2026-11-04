'use strict';
const crypto=require('node:crypto');
const {playerRepository}=require('./server-repositories.cjs');
const {verifyMainIdentity}=require('./raid-question-ticket.cjs');
const {trustedRaidPlayerSnapshot}=require('./raid-authority.cjs');
const Combat=require('./immortal-avatar-combat.cjs');
const Access=require('./public/cultivation/training-access-rules.js');
const Rewards=require('./public/cultivation/trial-tower-rewards.js');
const COLLECTION='martialTrialStates',MAX_FLOOR=100,TTL=2*60*60*1000,TURN_DELAY=300;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const count=n=>Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):0;
const clone=x=>JSON.parse(JSON.stringify(x));
const ref=(db,uid)=>db.collection(COLLECTION).doc(uid);
const checkpoint=best=>Math.min(96,Math.floor(count(best)/5)*5+1);
function title(best){return best>=100?'萬象破陣者':best>=50?'試煉宗師':best>=20?'破陣行者':best>=5?'登塔修士':'初入試煉';}
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
 const state={bestFloor,title:title(bestFloor),checkpoint:checkpoint(bestFloor),maxFloor:MAX_FLOOR,totalWins:count(record?.totalWins),status:'idle',
  rewardVersion:Rewards.VERSION,claimedFloors:Rewards.claimed(record||{}),unclaimedFloors:Rewards.pending(record||{})};
 if(!run)return state;
 const expired=run.expiresAtMs<=now&&['active','cleared'].includes(run.status);
 return {...state,runId:run.runId,status:expired?'expired':run.status,floor:run.floor,round:run.round,maxRounds:24,
  charge:run.charge,challenger:fighter(run.challenger),defender:fighter(run.defender),
  intent:Combat.intent(run.style,run.round+1),lastTurn:run.lastTurn,lastReward:run.lastReward||null,expiresAtMs:run.expiresAtMs};
}
function economy(user){return {gold:count(user.stats?.gold),forgeFragments:count(user.forgeFragments),drawTickets:count(user.soulboundDrawTickets),
 materials:Object.fromEntries(Object.keys(Rewards.ITEMS).map(id=>[id,count(user.materialSystem?.inventory?.[id])]))};}
function award(record,user,floors){
 const allowed=new Set(Rewards.pending(record)),earned=[...new Set(floors)].filter(f=>allowed.has(f));
 if(!earned.length)return null;
 const reward=Rewards.total(earned),patch={
  'stats.gold':count(user.stats?.gold)+reward.gold,forgeFragments:count(user.forgeFragments)+reward.forgeFragments,
  soulboundDrawTickets:count(user.soulboundDrawTickets)+reward.drawTickets
 };
 user.stats||={};user.stats.gold=patch['stats.gold'];user.forgeFragments=patch.forgeFragments;user.soulboundDrawTickets=patch.soulboundDrawTickets;
 user.materialSystem||={};user.materialSystem.inventory||={};
 for(const [id,quantity]of Object.entries(reward.materials)){
  const next=count(user.materialSystem.inventory[id])+quantity;user.materialSystem.inventory[id]=next;patch['materialSystem.inventory.'+id]=next;
 }
 record.rewardClaims=[...new Set([...Rewards.claimed(record),...earned])].sort((a,b)=>a-b);record.rewardVersion=Rewards.VERSION;
 return {floors:earned,reward,patch};
}
function result(record,user,now,granted){return {...view(record,now),economy:economy(user),...(granted?{awarded:{floors:granted.floors,reward:granted.reward}}:{})};}
async function status(db,uid,now=Date.now()){
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  return result(s.exists?s.data():null,p.data(),now);
 });
}
function requestKey(body){const id=String(body?.requestId||'');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw fail('操作識別碼無效，請重新同步',400);return id;}
function signature(action,body){
 if(action==='start')return JSON.stringify([action,body.floor===undefined?null:Number(body.floor)]);
 if(action==='claim')return JSON.stringify([action]);
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
  const user=p.data();if(Access.score(user)<28)throw fail('金丹境開放試煉之塔',403);
  const record=s.exists?s.data():{version:1,uid,bestFloor:0,totalWins:0,run:null};
  const repeated=replay(record,'start',body,now);if(repeated)return {...repeated,economy:economy(user)};
  if(record.run?.expiresAtMs>now&&['active','cleared'].includes(record.run.status))return result(record,user,now);
  const floor=body.floor===undefined?checkpoint(record.bestFloor):Number(body.floor);
  if(!Number.isInteger(floor)||floor<1||floor>checkpoint(record.bestFloor)||(floor!==1&&(floor-1)%5!==0))throw fail('請由已解鎖的試煉起點開始',400);
  const build=trustedRaidPlayerSnapshot(user,uid,c.exists?c.data():{});
  // Combat HP stays temporary; only verified first clears award resources.
  build.hp=build.maxHp;build.coreShield=false;
  record.run=encounter(build,crypto.randomUUID(),floor,now);remember(record,'start',body);
  tx.set(ref(db,uid),record);return result(record,user,now);
 });
}
async function act(db,uid,action,body={},now=Date.now()){
 requestKey(body);
 if(!['turn','next','abandon','claim'].includes(action))throw fail('闖塔操作無效',400);
 if(action==='turn'&&!['assault','guard','charge'].includes(body.tactic))throw fail('請選擇有效戰術',400);
 return db.runTransaction(async tx=>{
  const [s,p]=await Promise.all([tx.get(ref(db,uid)),tx.get(db.collection('users').doc(uid))]);
  if(!p.exists)throw fail('玩家資料不存在',404);
  const record=s.exists?s.data():null,user=p.data();
  const repeated=replay(record,action,body,now);if(repeated)return {...repeated,economy:economy(user)};
  if(action==='claim'){
   if(!record)throw fail('尚無可領取的通關獎勵');
   const granted=award(record,user,Rewards.pending(record));
   if(granted)tx.update(db.collection('users').doc(uid),granted.patch);
   remember(record,action,body);tx.set(ref(db,uid),record);return result(record,user,now,granted);
  }
  const run=record?.run;
  let granted=null;
  if(!run||body.runId!==run.runId||body.floor!==run.floor||body.round!==run.round)throw fail('戰場進度已更新，請重新同步');
  if(run.expiresAtMs<=now)throw fail('闖塔已逾時，請重新開陣',410);
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
    if(outcome.won){
     record.bestFloor=Math.max(count(record.bestFloor),run.floor);record.totalWins=count(record.totalWins)+1;
     granted=award(record,user,[run.floor]);
     if(granted){run.lastReward={floors:granted.floors,reward:granted.reward};tx.update(db.collection('users').doc(uid),granted.patch);}
    }
   }
  }
  remember(record,action,body);tx.set(ref(db,uid),record);return result(record,user,now,granted);
 });
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
module.exports=app=>{app.get('/api/martial-trial',handler('status'));for(const action of ['start','turn','next','abandon','claim'])app.post('/api/martial-trial/'+action,handler(action));};
module.exports.__test={COLLECTION,MAX_FLOOR,TTL,TURN_DELAY,start,act,status,view,enemy,checkpoint,handler};
