'use strict';
// Co-op dungeon aid: always computed inside the Firebase C room transaction.
// There is no client-specified HP, price, distance, or resurrection count.
const {walkable}=require('./dungeon-map-generator.cjs');
const {isAlive,clampHealth,HEALTH_MAX}=require('./dungeon-enemy-combat.cjs');
const ALLY_COST=8,ALLY_HP=40,ALLY_LIMIT=2,SELF_COST=25,SELF_HP=25,SELF_LIMIT=1;
const MAX_SEQ=1000000;
const fail=(text,status=409)=>Object.assign(new Error(text),{status});
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function help(room,uid,map,{targetUid,seq}={}){
  if(room?.mode!=='dungeon'||room.status!=='assembled')
    throw fail('副本尚未開始，無法救援');
  if(room.dungeonArena==='boss'&&room.bossEncounter?.status==='defeated')
    throw fail('首領已被擊敗，不需要再進行戰鬥救援');
  if(typeof targetUid!=='string'||targetUid.length<1||targetUid.length>160||
      !Number.isSafeInteger(seq)||seq<1||seq>MAX_SEQ)
    throw fail('救援操作資料無效',400);
  const member=room.members?.[uid],target=room.members?.[targetUid];
  if(!member)throw fail('你不是此副本的隊員',403);
  if(!target)throw fail('救援對象已不在隊伍中',404);
  const before=Number.isSafeInteger(member.rescueSeq)?member.rescueSeq:0;
  if(seq===before&&member.lastRescue?.targetUid===targetUid)
    return {duplicate:true,members:room.members,result:member.lastRescue};
  if(seq!==before+1)throw fail('救援指令已不同步，請重新取得隊伍狀態');
  if(!walkable(map,member.position)||!walkable(map,target.position))
    throw fail('隊員所在位置無法進行救援');
  if(isAlive(target))throw fail('隊友尚未倒地，不能重複救援');
  const self=targetUid===uid;
  const price=self?SELF_COST:ALLY_COST;
  const hp=self?SELF_HP:ALLY_HP;
  if(self){
    if((member.selfRescueCount||0)>=SELF_LIMIT)
      throw fail('本場副本已使用過凝神復起，請等待隊友救援');
  }else{
    if(!isAlive(member))throw fail('已倒地無法救助他人，請先自救或等待隊友');
    if(dist(member.position,target.position)>1)
      throw fail('必須走到倒地隊友上下左右相鄰一格');
    if((target.allyReviveCount||0)>=ALLY_LIMIT)
      throw fail('這位隊友本場可接受的援助次數已達上限');
  }
  const stamina=Number.isSafeInteger(member.explorationStamina)?
    Math.max(0,member.explorationStamina):0;
  if(stamina<price)
    throw fail('救援體力不足，可以繼續答題補充體力');
  const result={seq,targetUid,kind:self?'self':'ally',cost:price,
    recoveredHp:Math.min(HEALTH_MAX,hp),
    tick:Number.isSafeInteger(room.battleAppliedTick)?room.battleAppliedTick:0};
  const members={...room.members};
  if(self)members[uid]={...member,downed:false,battleHealth:hp,
    explorationStamina:stamina-price,
    selfRescueCount:(member.selfRescueCount||0)+1,
    rescueSeq:seq,lastRescue:result};
  else{
    members[uid]={...member,explorationStamina:stamina-price,
      rescueSeq:seq,lastRescue:result};
    members[targetUid]={...target,downed:false,battleHealth:hp,
      allyReviveCount:(target.allyReviveCount||0)+1};
  }
  return {duplicate:false,members,result};
}
module.exports={ALLY_COST,ALLY_HP,ALLY_LIMIT,SELF_COST,SELF_HP,SELF_LIMIT,
  MAX_SEQ,help};
