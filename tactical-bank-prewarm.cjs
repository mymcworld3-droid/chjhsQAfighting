'use strict';

// Refill the durable, independently reviewed AI question bank before battle.
// Work is queued only on an authenticated player's server-derived scope.
// No answers or unreviewed candidates are ever sent to the browser.
const keyOf = target => JSON.stringify([
  target.subject, target.level, target.topic, target.difficulty
]);

function createTacticalBankPrewarmer({bank,generate,logger=console,now=Date.now,
  lowWater=5,maxTargets=2,maxConcurrent=2,maxPerTarget=5,similar=()=>false}={}){
  if(!bank||typeof generate!=='function')throw Error('Bank and generator are required');
  const queue=new Map(),working=new Set(),cooldown=new Map();
  let pumpPending=false;

  const pump=()=>{
    if(pumpPending)return;
    pumpPending=true;
    queueMicrotask(()=>{
      pumpPending=false;
      while(working.size<maxConcurrent&&queue.size){
        const [key,entry]=queue.entries().next().value;
        queue.delete(key);working.add(key);
        const {target,excluded}=entry;
        const accepted=bank.schedule(target,async()=>{
          let count=0;
          try{
            let inventory=await bank.find(target,excluded,similar,{deadlineMs:90000});
            if(!inventory.ready)throw Error('AI question bank unavailable');
            count=inventory.count;
            const newlyGenerated=[];
            for(let i=0;i<maxPerTarget&&count<lowWater;i++){
              // The generator uses the main quiz quality pipeline and publishes
              // only after an independent answer/consistency review.
              const result=await generate(target,{avoidQuestions:[...excluded,...newlyGenerated]});
              if(!result?.stored)break;
              newlyGenerated.push(result.q);
              inventory=await bank.find(target,excluded,similar,{deadlineMs:90000});
              if(!inventory.ready)break;
              count=inventory.count;
            }
            cooldown.set(key,now()+(count>=lowWater?10*60*1000:60*1000));
          }catch(error){
            cooldown.set(key,now()+60*1000);
            logger.warn?.('[Tactical bank] background refill failed:',String(error?.message||error).slice(0,160));
          }finally{
            working.delete(key);
            // Let the shared bank scheduler release its active slot first;
            // a microtask here could outrun its Promise.finally().
            setTimeout(pump,0);
          }
        });
        if(!accepted){
          // The shared bank may be busy reviewing normal questions. Retry a
          // bounded number of times without bypassing its concurrency/quota.
          working.delete(key);
          const tries=Number(entry.retries||0);
          const delay=30000*(tries+1);
          cooldown.set(key,now()+delay);
          if(tries<3){
            const retry=setTimeout(()=>{
              if(!queue.has(key)&&!working.has(key)){
                queue.set(key,{...entry,retries:tries+1});
                pump();
              }
            },delay);
            retry.unref?.();
          }
          continue;
        }
      }
    });
  };

  function enqueue(targets,excluded=[]){
    if(!bank.enabled)return {enabled:false,queued:0,pending:0};
    let added=0;
    const seen=new Set();
    const avoided=[...new Set((Array.isArray(excluded)?excluded:[])
      .map(q=>String(q||'').trim().slice(0,4000)).filter(Boolean))].slice(-24);
    for(const target of (Array.isArray(targets)?targets:[]).slice(0,maxTargets)){
      if(!target?.subject||!target?.level||!target?.difficulty)continue;
      const key=keyOf(target);
      if(seen.has(key))continue;
      seen.add(key);
      if(queue.has(key)){
        const queued=queue.get(key);
        queued.excluded=[...new Set([...queued.excluded,...avoided])].slice(-48);
        continue;
      }
      if(working.has(key)||now()<(cooldown.get(key)||0))continue;
      queue.set(key,{target:{subject:String(target.subject),level:String(target.level),
        topic:String(target.topic||''),difficulty:String(target.difficulty)},
        excluded:avoided.slice()});
      added++;
    }
    // Keep queue bounded if many players trigger this in the same process.
    while(queue.size>16)queue.delete(queue.keys().next().value);
    pump();
    return {enabled:true,queued:added,pending:queue.size+working.size};
  }

  return {enqueue,statistics:()=>({queued:queue.size,running:working.size})};
}

module.exports={createTacticalBankPrewarmer,keyOf};
