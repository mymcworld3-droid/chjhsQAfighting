import { authenticatedMainFetch } from './project-repository.js';

async function postReward(path,body,fallback){
  const response=await authenticatedMainFetch(path,{method:'POST',body:JSON.stringify(body||{})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload.ok!==true)throw new Error(payload.error||fallback);
  return payload;
}
export const rewardRepository=Object.freeze({
  domain:'settlement',role:'A',
  async claimRaid(roomId){return postReward('/api/raid/reward',{roomId},'團本獎勵尚未完成入帳');},
  async claimBattle(roomId){return postReward('/api/battle/reward',{roomId},'鬥法獎勵尚未完成入帳');},
  async claimDongtian({dongtianId,runId,answers}={}){
    return postReward('/api/dongtian/settle',{dongtianId,runId,answers:Array.isArray(answers)?answers:[]},'洞天獎勵尚未完成入帳');
  }
});
