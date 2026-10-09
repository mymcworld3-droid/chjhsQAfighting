const Growth=require('../public/cultivation/nascent-growth.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { awardRaidSpirit, eligibleCorrect } = require('../raid-spirit-reward.cjs');
const { createHandler } = require('../raid-room-api.cjs').__test;
const { issueRaidQuestionTicket } = require('../raid-question-ticket.cjs');

function memoryDb(initial) {
  const docs = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const snap = ref => ({ exists:docs.has(ref.key), data:()=>structuredClone(docs.get(ref.key)) });
  const db = {
    collection: collection => ({doc:id=>({id,key:collection+'/'+id,get:async()=>snap({key:collection+'/'+id})})}),
    runTransaction(worker) {
      const pending = new Map();
      const job = queue.then(async () => {
        const tx = { get:async ref=>snap(ref), set(ref,value){pending.set(ref.key,structuredClone(value));},
          update(ref,patch){
            const value = structuredClone(pending.get(ref.key) || docs.get(ref.key));
            for (const [key,next] of Object.entries(patch)) {
              const path=key.split('.'); let current=value;
              for(const segment of path.slice(0,-1)) current=current[segment] ||= {};
              current[path.at(-1)]=structuredClone(next);
            }
            pending.set(ref.key,value);
          }};
        const result=await worker(tx);
        for(const [key,value] of pending) docs.set(key,value);
        return result;
      });
      queue=job.catch(()=>{});return job;
    }
  };
  return {db,docs};
}

test('raid spirit uses eligible server-recorded new correct answers only',()=>{
  assert.equal(eligibleCorrect({totalScore:67,spiritCorrect:8,correct:8,attempts:8}),0);
  assert.equal(eligibleCorrect({totalScore:68,correct:8,attempts:8}),0); // no retroactive farming
  assert.equal(eligibleCorrect({totalScore:68,spiritCorrect:8,correct:3,attempts:2}),2);
});

test('concurrent, replayed and older cumulative claims grant each correct answer once',async()=>{
  const f=memoryDb({'users/a':{uid:'a',stats:{totalScore:68,nascentSoulSpirit:12,gold:25}}});
  const member=n=>({totalScore:68,spiritCorrect:n,correct:n,attempts:n});
  const results=await Promise.all([3,3,1,5,2,5].map(n=>awardRaidSpirit(f.db,'a','room12345',member(n))));
  assert.equal(results.reduce((sum,r)=>sum+r.awarded,0),5);
  assert.equal(f.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],17);
  assert.equal(f.docs.get('users/a').stats.gold,25);
  assert.equal(f.docs.get('users/a').stats.totalScore,68);
  assert.equal((await awardRaidSpirit(f.db,'a','room12345',member(5))).awarded,0);
});

test('failed A transaction leaves no receipt or partial spirit award',async()=>{
  const f=memoryDb({});
  await assert.rejects(awardRaidSpirit(f.db,'a','room12345',
    {totalScore:68,spiritCorrect:1,correct:1,attempts:1}),/玩家資料不存在/);
  assert.equal(f.docs.size,0);
});

function raidFixture({score=68,failFirst=false}={}) {
  const now=Date.now();
  const a=memoryDb({'users/a':{uid:'a',stats:{totalScore:score,nascentSoulSpirit:10}}});
  const member={uid:'a',host:true,online:true,alive:true,ready:true,hp:1000,maxHp:1000,atk:200,
    totalScore:score,heartbeatAtMs:now,damage:0,correct:0,attempts:0,artifactShield:0,
    artifactBattle:{version:1,effects:[]},lastBossActionSeen:0};
  const c=memoryDb({'raidRooms/room12345':{version:2,status:'active',hostUid:'a',
    startedAtMs:now,createdAtMs:now,bossHp:1800,bossMaxHp:1800,bossBaseAttack:70,
    bossActionCount:0,members:{a:member}}});
  let failed=false;
  const options={resolveA:()=>({db:a.db,auth:{verifyIdToken:async()=>({uid:'a',aud:'question-learning',
    iss:'https://securetoken.google.com/question-learning'})}}),resolveC:()=>({db:c.db}),logger:{error(){}},
    awardSpirit:async(...args)=>{if(failFirst&&!failed){failed=true;throw Error('temporary failure');}return awardRaidSpirit(...args);}};
  let handler=createHandler(options);
  const env={FIREBASE_A_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',project_id:'question-learning',
    private_key:'-----BEGIN PRIVATE KEY-----\nfake-test-key\n-----END PRIVATE KEY-----',client_email:'test@question-learning.iam.gserviceaccount.com'})};
  async function request(action,extra={}) {
    let status=200,payload;
    // Only a synthetic test credential is installed, and restored after the route finishes.
    const previous=process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
    process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
    try {
      await handler({body:{action,roomId:'room12345',...extra},get:()=> 'Bearer fake-token'},
        {set(){},status(n){status=n;return this;},json(value){payload=value;return this;}});
    } finally {
      if(previous===undefined)delete process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON;
      else process.env.FIREBASE_A_SERVICE_ACCOUNT_JSON=previous;
    }
    assert.equal(status,200,JSON.stringify(payload));return payload;
  }
  function answer(id,choice=0) {
    const questionId='question-'+id;
    const ticket=issueRaidQuestionTicket({uid:'a',roomId:'room12345',actionId:id,questionId,
      answerIndex:0,explanation:'test explanation'},{env});
    return request('player-action',{actionId:id,questionId,choice,ticket,correct:true,spiritGain:999});
  }
  return {request,answer,a,c,restart(){handler=createHandler(options);}};
}

test('signed player-action resolves damage and spirit, ignores client correctness and rewards',async()=>{
  const f=raidFixture();
  const correct=await f.answer(1);
  assert.equal(correct.resolution.correct,true);
  assert.ok(correct.resolution.damage>0);
  assert.equal(correct.room.bossHp,1800-correct.resolution.damage);
  assert.equal(correct.resolution.spiritGain,1);
  assert.equal(correct.spiritReward.totalFragments,11);
  await f.answer(1);
  const wrong=await f.answer(2,1);
  assert.equal(wrong.resolution.correct,false);
  assert.equal(wrong.resolution.damage,0);
  assert.equal(wrong.resolution.spiritGain,0);
  assert.equal(f.a.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],11);
  assert.equal(wrong.room.members.a.correct,1);
  assert.equal(f.a.docs.get('users/a').stats.totalScore,69);
  assert.equal(f.a.docs.get('users/a').stats.gold,20);
  assert.equal(wrong.resolution.cultivationGain,0);
  assert.equal(wrong.resolution.goldGain,0);
  assert.equal((await f.request('get')).spiritReward.learningAwarded,0);
});

test('pre-nascent raid answers grant no spirit',async()=>{
  const f=raidFixture({score:67});
  assert.equal((await f.answer(1)).resolution.spiritGain,0);
  assert.equal(f.a.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],10);
});

test('failed spirit grant is recovered by polling after loss, reconnect and server restart never duplicate',async()=>{
  const f=raidFixture({failFirst:true});
  assert.equal((await f.answer(1)).spiritReward.status,'pending');
  assert.equal(f.c.docs.get('raidRooms/room12345').members.a.correct,1);
  f.c.docs.get('raidRooms/room12345').status='lost';
  assert.equal((await f.request('get')).spiritReward.totalFragments,11);
  f.restart();
  const recovered=await f.request('reconnect');
  assert.equal(recovered.room.status,'lost');
  assert.equal(recovered.spiritReward.awarded,0);
  assert.equal(recovered.spiritReward.learningAwarded,0);
  assert.equal(f.a.docs.get('users/a').stats.totalScore,69);
  assert.equal(f.a.docs.get('users/a').stats.gold,20);
  assert.equal(f.a.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],11);
});

test('killing answer settles spirit even when room is already won',async()=>{
  const f=raidFixture();
  f.c.docs.get('raidRooms/room12345').bossHp=1;
  const result=await f.answer(1);
  assert.equal(result.room.status,'won');
  assert.equal(result.spiritReward.totalFragments,11);
  await f.request('get');
  assert.equal(f.a.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],11);
});

test('new answer earnings are cumulative, survive loss and do not retroactively reward old answers',async()=>{
  const f=memoryDb({'users/a':{uid:'a',stats:{totalScore:28,gold:25}}});
  const member=n=>({totalScore:28,learningCorrect:n,correct:n+5,attempts:n+7});
  const results=await Promise.all([3,3,1,5,2].map(n=>awardRaidSpirit(f.db,'a','lost_room',member(n))));
  assert.equal(results.reduce((sum,r)=>sum+r.learningAwarded,0),5);
  assert.equal(f.docs.get('users/a').stats.totalScore,33);
  assert.equal(f.docs.get('users/a').stats.gold,125);
  assert.deepEqual(f.docs.get('users/a').raidLearningRewards,{cultivation:5,gold:100,fragments:0});
  assert.equal((await awardRaidSpirit(f.db,'a','lost_room',member(5))).learningAwarded,0);
});
test('old spirit receipts are retained when new cultivation and gold begin',async()=>{
  const {createHash}=require('node:crypto');
  const id=createHash('sha256').update('old_room\na').digest('hex');
  const f=memoryDb({'users/a':{uid:'a',stats:{totalScore:68,gold:0,nascentSoulSpirit:10}},
    ['raidSpiritClaims/'+id]:{settledCorrect:5}});
  const r=await awardRaidSpirit(f.db,'a','old_room',{totalScore:68,spiritCorrect:6,learningCorrect:1,correct:6,attempts:6});
  assert.equal(r.awarded,1);assert.equal(r.learningAwarded,1);
  assert.equal(f.docs.get('users/a').materialSystem.inventory[Growth.ITEM_ID],11);
  assert.equal(f.docs.get('users/a').stats.gold,20);
});
