import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

// Fire-and-forget. Player login and battle progress may request a refill,
// but neither waits for AI generation and no answers are stored client-side.
let lastUser='',lastAt=0;
let inflight=null;
export function warmTacticalBank(offset=1,{force=false}={}){
  const uid=getMainUser()?.uid||'';
  if(!uid)return Promise.resolve(null);
  const now=Date.now();
  if(lastUser!==uid){lastUser=uid;lastAt=0;inflight=null;}
  if(inflight)return inflight;
  if(!force&&now-lastAt<45000)return Promise.resolve(null);
  lastAt=now;
  const slot=Math.max(1,Math.min(10000,Math.trunc(Number(offset)||1)));
  const request=authenticatedMainFetch('/api/tactical/bank-warm',{
    method:'POST',body:JSON.stringify({offset:slot})
  }).then(async response=>{
    if(!response.ok)throw Error('題庫背景排程：'+response.status);
    return response.json();
  }).catch(error=>{
    console.warn('[Tactical question bank] Background refill unavailable:',error.message);
    return null;
  }).finally(()=>{if(inflight===request)inflight=null;});
  inflight=request;
  return request;
}
