'use strict';
const crypto=require('node:crypto');
const Rules=require('./public/cultivation/daily-meditation-rules.js');
const Literacy=require('./daily-meditation-literacy.cjs');
const Knowledge=require('./public/cultivation/knowledge-points.js');

// Private, server-only daily set. Never key it by the first player's grade or
// copy their solo queue, scope, adaptive state or AI session into this job.
const SETS='meditationDailySets';
const LEASE_MS=20*60*1000, RETRY_MS=60000;
const services=new WeakMap();
const dailyPlan=()=>Literacy.plan({profile:{educationLevel:'國中一年級'}});
const summary=record=>({date:record.date,status:record.status,ready:record.status==='ready',total:Literacy.TOTAL});
function makeQuestion(parsed,expected,random=Math.random){
  Literacy.assertQuestion(parsed,expected);
  const opts=[parsed.correct,...parsed.wrong].map(x=>String(x).trim());let ans=0;
  for(let i=opts.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];if(ans===i)ans=j;else if(ans===j)ans=i;}
  const hash=crypto.createHash('sha256').update(JSON.stringify([parsed.q,opts])).digest('hex').slice(0,12);
  return {id:'daily-'+expected.date+'-'+expected.index+'-'+hash,subject:expected.subject,source:'全服每日素養題 · '+expected.subject,
    data:{q:parsed.q.trim(),opts,ans,exp:parsed.exp.trim(),...Knowledge.metadata(parsed,expected.subject)}};
}
function createDailySet({db,now=Date.now,random=Math.random,generate,enqueue=setImmediate,logger=console,
  setTimer=setTimeout,clearTimer=clearTimeout,setHeartbeat=setInterval,clearHeartbeat=clearInterval}={}){
  const running=new Map(),readyDates=new Set(),retries=new Map();
  const today=()=>Rules.meditationDateKey(new Date(now()));
  const ref=date=>db.collection(SETS).doc(date);
  function cancelRetry(date){const retry=retries.get(date);if(retry){clearTimer(retry.timer);retries.delete(date);}}
  function retry(date,uid,delay){
    if(today()!==date)return;
    const wait=Math.max(1000,delay),at=now()+wait;
    if(retries.has(date)&&retries.get(date).at<=at)return;
    cancelRetry(date);
    const pending={at,timer:null};
    pending.timer=setTimer(()=>{
      if(retries.get(date)!==pending)return;
      retries.delete(date);
      if(today()===date)void ensure(uid).catch(()=>retry(date,uid,RETRY_MS));
    },wait);
    pending.timer?.unref?.();retries.set(date,pending);
  }
  async function update(date,leaseId,change){
    return db.runTransaction(async tx=>{
      const r=ref(date),snap=await tx.get(r),record=snap.exists?snap.data():null;
      if(today()!==date||!record||record.status!=='generating'||record.leaseId!==leaseId||record.leaseUntilMs<=now())return null;
      const next=change(record);tx.set(r,next);return next;
    });
  }
  async function run(record){
    const {date,leaseId}=record;
    let renewing=false;
    const heartbeat=setHeartbeat(()=>{
      if(renewing)return;renewing=true;
      void update(date,leaseId,row=>({...row,leaseUntilMs:now()+LEASE_MS}))
        .catch(()=>logger.warn?.('[Daily meditation] lease renewal unavailable')).finally(()=>{renewing=false;});
    },60000);
    heartbeat?.unref?.();
    try{
      while(record.questions.length<Literacy.TOTAL){
        record=await update(date,leaseId,row=>({...row,leaseUntilMs:now()+LEASE_MS}));
        if(!record)return;
        const index=record.questions.length,expected={date,index,...record.plan[index]};
        const parsed=await generate(expected,record.questions.map(q=>q.data.q));
        const question=makeQuestion(parsed,expected,random);
        record=await update(date,leaseId,row=>{
          if(row.questions.some(q=>q.data.q===question.data.q))throw Error('Duplicate daily meditation question');
          const questions=[...row.questions,question],done=questions.length===Literacy.TOTAL;
          return {...row,questions,status:done?'ready':'generating',leaseUntilMs:now()+LEASE_MS,
            ...(done?{readyAtMs:now(),reviewCount:1}:{}),updatedAtMs:now()};
        });
        if(!record)return;
      }
      readyDates.add(date);
      cancelRetry(date);
    }catch(error){
      logger.warn?.('[Daily meditation] background preparation failed:',error?.code||'generation-failed');
      await update(date,leaseId,row=>({...row,status:'failed',retryAfterMs:now()+RETRY_MS,updatedAtMs:now()}))
        .catch(()=>logger.warn?.('[Daily meditation] retry state unavailable'));
      retry(date,record?.ownerUid,RETRY_MS);
    }finally{clearHeartbeat(heartbeat);}
  }
  async function ensure(uid){
    const date=today();
    if(readyDates.has(date))return summary({date,status:'ready'});
    const leaseId=crypto.randomUUID();
    const record=await db.runTransaction(async tx=>{
      const r=ref(date),snap=await tx.get(r),old=snap.exists?snap.data():null;
      if(old?.status==='ready'||old?.status==='generating'&&old.leaseUntilMs>now()||old?.status==='failed'&&old.retryAfterMs>now())return old;
      const next={date,version:1,status:'generating',ownerUid:uid,leaseId,leaseUntilMs:now()+LEASE_MS,
        plan:old?.plan||dailyPlan(),questions:old?.questions||[],updatedAtMs:now()};
      tx.set(r,next);return next;
    });
    if(record.status==='ready'){
      readyDates.add(date);cancelRetry(date);
    }
    if(record.leaseId===leaseId){
      // Enqueue a separate server job. The status/login response and ordinary
      // quiz generation never await this promise or any AI call made by it.
      const work=new Promise(resolve=>enqueue(()=>resolve(run(record))));
      running.set(date,work);
      void work.finally(()=>{if(running.get(date)===work)running.delete(date);});
    }else if(record.status==='generating'||record.status==='failed'){
      retry(date,uid,(record.status==='generating'?record.leaseUntilMs:record.retryAfterMs)-now());
    }
    for(const key of readyDates)if(key!==date)readyDates.delete(key);
    for(const key of retries.keys())if(key!==date)cancelRetry(key);
    return summary(record);
  }
  return {ensure,whenIdle:date=>running.get(date)||Promise.resolve()};
}
function getDailySet(db,options={}){
  if(!services.has(db))services.set(db,createDailySet({db,...options,generate:require('./daily-meditation-generator.cjs').generateQuestion}));
  return services.get(db);
}
module.exports={SETS,LEASE_MS,RETRY_MS,dailyPlan,makeQuestion,createDailySet,getDailySet};
