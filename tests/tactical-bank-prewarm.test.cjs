'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTacticalBankPrewarmer,keyOf}=require('../tactical-bank-prewarm.cjs');
const physics={subject:'物理',level:'高中二年級',topic:'圓周運動',difficulty:'medium'};
const history={subject:'歷史',level:'高中二年級',topic:'綜合測驗',difficulty:'medium'};

async function until(done){
  for(let i=0;i<100;i++){
    if(done())return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('background refill did not complete');
}
function fakeBank(counts,{enabled=true,deny=false}={}){
  let jobs=0;
  return {
    enabled,
    schedule(target,job){
      if(deny)return false;
      jobs++;
      Promise.resolve().then(job).catch(error=>{throw error});
      return true;
    },
    async find(target,_excluded,_similar,options){
      assert.equal(options?.deadlineMs,90000,'background should tolerate cold Drive');
      return {ready:true,count:counts.get(keyOf(target))||0};
    },
    get jobs(){return jobs;}
  };
}

test('on login a low-stock topic fills to five independently reviewed bank entries',async()=>{
  const counts=new Map([[keyOf(physics),2]]);
  const bank=fakeBank(counts),delivered=[];
  const warmer=createTacticalBankPrewarmer({bank,generate:async(target,context)=>{
    delivered.push({target,avoidQuestions:[...context.avoidQuestions]});
    const k=keyOf(target);counts.set(k,(counts.get(k)||0)+1);
    return {stored:true,q:'已審核題目 '+delivered.length};
  }});
  const first=warmer.enqueue([physics,physics]);
  assert.equal(first.enabled,true);
  assert.equal(first.queued,1,'duplicate scope queues only once');
  assert.equal(warmer.enqueue([physics]).queued,0,'an in-flight scope cannot be queued again');
  await until(()=>counts.get(keyOf(physics))===5&&warmer.statistics().running===0);
  assert.equal(delivered.length,3);
  assert.equal(delivered[0].avoidQuestions.length,0);
  assert.equal(delivered[1].avoidQuestions.length,0,'the first two candidates launch concurrently');
  assert.equal(delivered[2].avoidQuestions.length,2,'the next batch avoids both approved candidates');
  assert.equal(bank.jobs,1,'all five stock additions share one low-water job');
});

test('a stocked topic is not regenerated and cooldown prevents duplicate scheduling',async()=>{
  const counts=new Map([[keyOf(physics),5]]);
  const bank=fakeBank(counts);
  let generated=0;
  const warmer=createTacticalBankPrewarmer({bank,generate:async()=>{generated++;return {stored:true}}});
  assert.equal(warmer.enqueue([physics]).queued,1);
  await until(()=>warmer.statistics().running===0&&bank.jobs===1);
  assert.equal(generated,0);
  assert.equal(warmer.enqueue([physics]).queued,0);
});

test('bank prewarm honors the existing AI scheduler quota and never bypasses it',async()=>{
  const bank=fakeBank(new Map(),{deny:true});
  const warmer=createTacticalBankPrewarmer({bank,generate:async()=>{throw Error('must not generate')}});
  warmer.enqueue([physics]);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(bank.jobs,0);
  assert.equal(warmer.statistics().running,0);
});

test('no Google Drive bank means no background generation',()=>{
  const bank=fakeBank(new Map(),{enabled:false});
  const warmer=createTacticalBankPrewarmer({bank,generate:async()=>{throw Error('not allowed')}});
  assert.deepEqual(warmer.enqueue([physics]),{enabled:false,queued:0,pending:0});
});

test('two different subjects prewarm without mixing topic or grade',async()=>{
  const counts=new Map();
  const generated=[];
  const bank=fakeBank(counts);
  const warmer=createTacticalBankPrewarmer({bank,maxPerTarget:2,generate:async target=>{
    generated.push({...target});const k=keyOf(target);counts.set(k,(counts.get(k)||0)+1);
    return {stored:true,q:'new'};
  }});
  warmer.enqueue([physics,history]);
  await until(()=>generated.length===4&&warmer.statistics().running===0);
  assert.equal(generated.filter(t=>t.subject==='物理').length,2);
  assert.equal(generated.filter(t=>t.subject==='歷史').length,2);
  assert(generated.every(t=>t.level==='高中二年級'));
});

test('queued refills continue after the shared scheduler releases its two active jobs',async()=>{
  const topics=[physics,history,
    {...physics,topic:'等加速度運動'},{...history,topic:'世界史'}];
  const counts=new Map();let active=0,maxActive=0,scheduled=0;
  const bank={
    enabled:true,
    schedule(target,job){
      if(active>=2)return false;
      active++;scheduled++;maxActive=Math.max(maxActive,active);
      Promise.resolve().then(job).finally(()=>{active--;});
      return true;
    },
    async find(target){return {ready:true,count:counts.get(keyOf(target))||0};}
  };
  const warmer=createTacticalBankPrewarmer({bank,maxPerTarget:1,generate:async target=>{
    const key=keyOf(target);counts.set(key,(counts.get(key)||0)+1);
    return {stored:true,q:'approved'};
  }});
  warmer.enqueue(topics.slice(0,2));
  warmer.enqueue(topics.slice(2));
  await until(()=>topics.every(t=>counts.get(keyOf(t))===1));
  assert.equal(scheduled,4);
  assert.equal(maxActive,2);
});

test('stock counts exclude previously answered and still-reserved questions',async()=>{
  const stored=['old-1','old-2','fresh-1','fresh-2','fresh-3'];
  const excluded=['old-1','old-2'];
  const generated=[];
  const bank={
    enabled:true,
    schedule(_target,job){Promise.resolve().then(job);return true;},
    async find(_target,avoided,similar,options){
      assert.equal(options.deadlineMs,90000);
      return {ready:true,count:stored.filter(q=>!avoided.some(old=>similar(q,old))).length};
    }
  };
  const warmer=createTacticalBankPrewarmer({bank,similar:(a,b)=>a===b,
    generate:async(_target,{avoidQuestions})=>{
      generated.push(avoidQuestions);
      stored.push('fresh-'+(stored.length-1));
      return {stored:true,q:stored.at(-1)};
    }
  });
  warmer.enqueue([physics],excluded);
  await until(()=>generated.length===2&&warmer.statistics().running===0);
  assert.deepEqual(generated[0],excluded);
  assert.deepEqual(generated[1],excluded,'both initial requests are concurrent and use the same excluded set');
  assert.equal(stored.length,7,'restore five distinct usable questions');
});

test('a single scope starts two provider requests concurrently, never more than two',async()=>{
  const counts=new Map();let active=0,peak=0,done=0;
  const bank=fakeBank(counts);
  const warmer=createTacticalBankPrewarmer({
    bank,maxPerTarget:4,
    generate:async(target,{avoidQuestions})=>{
      assert(avoidQuestions.length<=done);
      active++;peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,8));
      active--;done++;
      const k=keyOf(target);counts.set(k,(counts.get(k)||0)+1);
      return {stored:true,q:'並行已審核題目 '+done};
    }
  });
  warmer.enqueue([physics]);
  await until(()=>done===4&&warmer.statistics().running===0);
  assert.equal(peak,2);
  assert.equal(counts.get(keyOf(physics)),4);
  assert.equal(bank.jobs,1);
});
