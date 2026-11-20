'use strict';
// Canonical stamina contract shared by dungeon combat, movement and charging.
// Match 問道試煉: 10 maximum stamina, one point per walked tile,
// four restored on a correct answer and one on an incorrect answer.
const MAX_STAMINA=10;
const START_STAMINA=10;
const STEP_COST=1;
const AUTO_REGEN_LAYOUT_VERSION=2,REGEN_PER_SECOND=1;
// Legacy v1 rooms continue to use the original question-reward rules.
const regenerates=room=>room?.mapVersion===AUTO_REGEN_LAYOUT_VERSION;
function replenishMembers(room,members,elapsedTicks){
  if(!regenerates(room)||!Number.isSafeInteger(elapsedTicks)||elapsedTicks<=0)
    return members;
  let result=members;
  for(const [uid,member] of Object.entries(members||{})){
    if(isDungeonAdmin(member))continue;
    const stamina=staminaFor(member),next=Math.min(MAX_STAMINA,
      stamina+elapsedTicks*REGEN_PER_SECOND);
    if(next!==stamina){
      if(result===members)result={...members};
      result[uid]={...member,explorationStamina:next};
    }
  }
  return result;
}
const RIGHT=4,WRONG=1;
const clampStamina=value=>{
  const numeric=Number(value);
  return Number.isSafeInteger(numeric)?
    Math.max(0,Math.min(MAX_STAMINA,numeric)):0;
};
// The flag is stamped from Firebase A users.isAdmin by the dungeon server.
// It is never accepted from a browser payload; only the current room member
// controls the special case. Every action still enforces geometry and timing.
const isDungeonAdmin=member=>member?.dungeonAdmin===true;
const staminaFor=member=>isDungeonAdmin(member)?
  MAX_STAMINA:clampStamina(member?.explorationStamina);
const staminaAfterCost=(member,cost)=>isDungeonAdmin(member)?
  MAX_STAMINA:staminaFor(member)-cost;
module.exports={MAX_STAMINA,START_STAMINA,STEP_COST,RIGHT,WRONG,
  AUTO_REGEN_LAYOUT_VERSION,REGEN_PER_SECOND,regenerates,replenishMembers,
  clampStamina,isDungeonAdmin,staminaFor,staminaAfterCost};
