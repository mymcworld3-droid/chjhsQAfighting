'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createSparePool}=require('../quiz-spare-pool.cjs');
const router=require('../ai-router');
const server=fs.readFileSync('server.js','utf8');

test('scope is isolated by owner, quiz mode, rank, topic, difficulty, level and diagnostics',()=>{
  const pool=createSparePool();
  const opts={owner:'session:random-very-long-0123456789',mode:'battle-fast',subject:'數學',level:'國中一年級',topic:'一次方程式',difficulty:'easy',rank:3,knowledge:'40%'};
  const k=pool.key(opts);
  assert.equal(k.length,64);
  for(const field of Object.keys(opts)){
    assert.notEqual(pool.key({...opts,[field]:opts[field]+'different'}),k,field);
  }
  assert.equal(pool.key({...opts,owner:''}),'');
});

test('unused valid results survive for next request; duplicate stems and skeletons are rejected',()=>{
  const similar=(a,b)=>String(a).replace(/\s+/g,'')===String(b).replace(/\s+/g,'');
  const pool=createSparePool({similar,maxPerScope:2});
  const key=pool.key({owner:'session:abcdefghijklmnopqrstuvwxyz',subject:'數學',topic:'一元一次方程式'});
  const a={data:{q:'解方程式 1',template_id:'T1'}},b={data:{q:'解方程式 2',template_id:'T2'}},c={data:{q:'解方程式 3',template_id:'T3'}};
  pool.markServed(key,a.data);
  assert.equal(pool.offer(key,a),false,'already served questions may not reappear');
  assert.equal(pool.offer(key,b),true);
  assert.equal(pool.offer(key,{data:{q:'解方程式 9',template_id:'T2'}}),false,'duplicate solving template');
  assert.equal(pool.offer(key,c),true);
  assert.equal(pool.count(key),2);
  const first=pool.take(key,()=>true);
  assert.equal(first.data.q,b.data.q);
  assert.equal(pool.offer(key,b),false);
  const second=pool.take(key,()=>true);
  assert.equal(second.data.q,c.data.q);
  assert.equal(pool.count(key),0);
  assert.equal(pool.take(key,()=>true),null);
});

test('old history invalidates saved candidates on reuse and expiration discards stale results',()=>{
  let clock=0;
  const pool=createSparePool({now:()=>clock,ttlMs:1000,similar:(a,b)=>a===b});
  const key=pool.key({owner:'session:abcdefghijklmnopqrstuvwxyz',subject:'英文',topic:'閱讀理解'});
  const question={data:{q:'閱讀後選出正確答案',template_id:'reading'}};
  assert.equal(pool.offer(key,question),true);
  assert.equal(pool.take(key,()=>false),null);
  assert.equal(pool.count(key),0);
  pool.offer(key,question);
  clock=1001;
  assert.equal(pool.take(key,()=>true),null,'expired pool cannot be used');
  assert.equal(pool.count(key),0);
});

test('every model result is useful: first valid answer returned, slow two collected for later without a second billable request',async()=>{
  const envKeys=['GEMINI_API_KEYS','GEMINI_API_KEY','OPENAI_API_KEY','OPENAI_MODEL','AI_PROVIDERS_JSON','AI_PROVIDER_STRATEGY'];
  const original=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
  const fetchBefore=global.fetch;
  const results=[],calls=[];
  try {
    delete process.env.GEMINI_API_KEYS;delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_MODEL;
    process.env.AI_PROVIDER_STRATEGY='round-robin';
    process.env.AI_PROVIDERS_JSON=JSON.stringify(['first','second','third'].map(name=>({
      name,baseUrl:'https://'+name+'.test/v1',type:'openai-compatible',apiKey:'key-'+name,model:'quiz'
    })));
    global.fetch=async(url)=>{
      const name=new URL(url).hostname.split('.')[0];
      calls.push(name);
      await new Promise(resolve=>setTimeout(resolve,name==='first'?5:name==='second'?20:35));
      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({q:name+' question with full stem',correct:'1',wrong:['2','3','4'],exp:'完整解析正確步驟'})}}]})};
    };
    let delivered='';
    const routed=await router.generateJSON('new quiz',{
      parallel:true,validate:data=>{if(!data.q||!data.exp)throw Error('bad quiz');},
      onWinner:item=>{delivered=item.data.q;},
      onSpare:item=>results.push(item.data.q)
    });
    assert.equal(delivered,routed.data.q);
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.deepEqual(new Set(calls),new Set(['first','second','third']));
    assert.equal(results.length,2);
    assert.ok(results.every(q=>q!==routed.data.q));
    // Future uses cached candidate instead of initiating an extra API request.
    const spare=results.shift();
    assert.ok(spare);
    assert.equal(calls.length,3);
  }finally{
    global.fetch=fetchBefore;
    for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});

test('all quiz callers supply a private session; team tickets are issued at actual delivery',()=>{
  const files=['public/main-legacy.js','public/cultivation/battle-mode-v2.js','public/cultivation/five-immortals.js'];
  for(const path of files)assert.match(fs.readFileSync(path,'utf8'),/quizSessionId:/,path);
  assert.match(server,/sessionOwner = raidTicketMode \? `raid:\$\{raidIdentity\}:\$\{raidRoomId\}`/);
  assert.match(server,/quizSparePool\.take\(spareKey, validateCandidate\)/);
  assert.match(server,/onSpare: spare => quizSparePool\.offer\(spareKey, spare\)/);
  const cache=server.indexOf('const saved = attempts === 0 ? quizSparePool.take(');
  const ticket=server.indexOf('const ticket = issueRaidQuestionTicket(',cache);
  assert.ok(cache>0&&ticket>cache,'cached quiz content must not store pre-issued tickets');
});
