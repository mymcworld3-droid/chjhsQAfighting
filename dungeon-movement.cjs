'use strict';

// Stage-7 cooperative exploration movement. All values are checked on the
// server and written in the same Firestore transaction as the room revision.
// This temporary dungeon exploration pool is independent from raid tickets,
// tactical combat and main-account resources until quiz charging arrives.
const {generateDungeonLayout,LAYOUT_VERSION,walkable}=require('./dungeon-map-generator.cjs');
const Boss=require('./dungeon-boss-battle.cjs');
const START_STAMINA=100;
const STEP_COST=1;
const MAX_STEPS=100000;
const error=(message,status=409)=>Object.assign(new Error(message),{status});
const order=members=>Object.values(members||{}).sort((a,b)=>
  Number(a.joinedAtMs)-Number(b.joinedAtMs)||String(a.uid).localeCompare(String(b.uid)));
function roomMap(room,roomId){
  if(room?.mapVersion!==undefined&&room.mapVersion!==LAYOUT_VERSION)
    throw error('副本地圖版本尚未支援',409);
  const seed=room?.mapSeed||('legacy:'+roomId);
  return room?.dungeonArena==='boss'?Boss.mapFor(seed):
    generateDungeonLayout(seed);
}
function spawnFor(room,uid,map){
  const index=order(room?.members).findIndex(m=>m.uid===uid);
  if(index<0)throw error('你不是此副本的隊員',403);
  return {...(map.spawnPads[Math.min(index,3)]||map.spawn)};
}
function startExplorationMembers(room,map){
  return Object.fromEntries(order(room.members).map((member,index)=>{
    const position={...(map.spawnPads[index]||map.spawn)};
    return [member.uid,{...member,position,explorationStamina:START_STAMINA,
      battleHealth:100,battleMaxHealth:100,downed:false,lastDamage:null,
      moveSeq:0,lastMove:null,strikeSeq:0,lastStrike:null,
      quizCreditSeq:0,lastQuizCredit:null,
      rescueSeq:0,lastRescue:null,selfRescueCount:0,allyReviveCount:0}];
  }));
}
const validVector=(dx,dy)=>Number.isInteger(dx)&&Number.isInteger(dy)&&
  Math.abs(dx)+Math.abs(dy)===1;
function moveOnMap(room,uid,map,{dx,dy,step}={}){
  if(!validVector(dx,dy))throw error('每次只能向上下左右移動一格',400);
  if(!Number.isSafeInteger(step)||step<1||step>MAX_STEPS)
    throw error('移動序號無效',400);
  const member=room.members?.[uid];
  if(!member)throw error('你不是此副本的隊員',403);
  if(room.status!=='assembled')throw error('全隊集結完成後才能探索',409);
  const prior=Number.isSafeInteger(member.moveSeq)?member.moveSeq:0;
  // A retried, already committed step never consumes stamina twice.
  if(step===prior&&member.lastMove?.step===step&&
     member.lastMove?.dx===dx&&member.lastMove?.dy===dy)
    return {duplicate:true,members:room.members,member};
  if(step!==prior+1)throw error('移動已不同步，請重新取得隊伍位置',409);
  if(member.downed===true||Number.isSafeInteger(member.battleHealth)&&
     member.battleHealth<=0)
    throw error('修士已倒地，暫時無法移動；請等待隊友救援',409);
  const from=member.position&&walkable(map,member.position)?
    member.position:spawnFor(room,uid,map);
  const to={x:from.x+dx,y:from.y+dy};
  if(!walkable(map,to))throw error('前方是無法通行的地形',409);
  if((room.enemies||[]).some(enemy=>Boss.occupies(enemy,to)))
    throw error('靈獸擋住前方道路，請繞路或等待靈獸移動',409);
  const stamina=Number.isSafeInteger(member.explorationStamina)?
    member.explorationStamina:START_STAMINA;
  if(stamina<STEP_COST)throw error('探索體力不足，暫時無法移動',409);
  const nextMember={...member,position:to,explorationStamina:stamina-STEP_COST,
    moveSeq:step,lastMove:{step,dx,dy}};
  return {duplicate:false,member:nextMember,members:{
    ...room.members,[uid]:nextMember
  }};
}
module.exports={START_STAMINA,STEP_COST,MAX_STEPS,roomMap,spawnFor,
  startExplorationMembers,validVector,moveOnMap};
