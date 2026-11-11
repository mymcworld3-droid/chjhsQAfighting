'use strict';

// Refill the durable, independently reviewed AI question bank before battle.
// Work is queued only on an authenticated player's server-derived scope.
// No answers or unreviewed candidates are ever sent to the browser.
const keyOf = target => JSON.stringify([
  target.subject, target.level, target.topic, target.difficulty
]);

function createTacticalBankPrewarmer({bank,generate,logger=console,now=Date.now,
  lowWater=5,maxTargets=2,maxConcurrent=2,maxPerTarget=5}={}){
  if(!bank||typeof generate!=='function')throw Error('Bank and generator are required');
  const queue=new Map(),working=new Set(),cooldown=new Map();
  let pumpPending=false;

  const pump=()=>{
    if(pumpPending)return;
    pumpPending=true;
    queueMicrotask(()=>{
      pumpPending=false;
      while(working.size<maxConcurrent&&queue.size){
        const [key,target]=queue.entries().next().value;
        queue.delete(key);working.add(key);
        const accepted=bank.schedule(target,async()=>{
          let count=0;
          try{
            let inventory=await bank.find(target,[],()=>false);
            if(!inventory.ready)throw Error('AI question bank unavailable');
            count=inventory.count;
            const newlyGenerated=[];
            for(let i=0;i<maxPerTarget&&count<lowWater;i++){
              // The generator uses the main quiz quality pipeline and publishes
              // only after an independent answer/consistency review.
              const result=await generate(target,{avoidQuestions:newlyGenerated});
              if(!result?.stored)break;
              newlyGenerated.push(result.q);
              inventory=await bank.find(target,[],()=>false);
              if(!inventory.ready)break;
              count=inventory.count;
            }
            cooldown.set(key,now()+(count>=lowWater?10*60*1000:60*1000));
          }catch(error){
            cooldown.set(key,now()+60*1000);
            logger.warn?.('[Tactical bank] background refill failed:',String(error?.message||error).slice(0,160));
          }finally{
            working.delete(key);
            pump();
          }
        });
        if(!accepted){
          // The existing bank scheduler may be busy with ordinary study
          // questions or have reached its hourly quota. Never bypass it.
          working.delete(key);
          cooldown.set(key,now()+30*1000);
          continue;
        }
      }
    });
  };

  function enqueue(targets){
    if(!bank.enabled)return {enabled:false,queued:0,pending:0};
    let added=0;
    const seen=new Set();
    for(const target of (Array.isArray(targets)?targets:[]).slice(0,maxTargets)){
      if(!target?.subject||!target?.level||!target?.difficulty)continue;
      const key=keyOf(target);
      if(seen.has(key))continue;
      seen.add(key);
      if(queue.has(key)||working.has(key)||now()<(cooldown.get(key)||0))continue;
      queue.set(key,{subject:String(target.subject),level:String(target.level),
        topic:String(target.topic||''),difficulty:String(target.difficulty)});
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
