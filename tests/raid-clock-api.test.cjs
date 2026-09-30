const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../raid-room-api.cjs').__test;

function fixture(status = 'active') {
  const now = Date.now();
  const player = uid => ({uid, host:uid==='a',online:true,alive:true,ready:true,hp:1000,maxHp:1000,atk:200,
    heartbeatAtMs:now,joinedAtMs:now,damage:0,correct:0,attempts:0,artifactShield:0,
    artifactBattle:{version:1,effects:[]},lastBossActionSeen:0});
  let room = {version:2,status,hostUid:'a',startedAtMs:now-18010,createdAtMs:now,
    bossHp:1800,bossMaxHp:1800,bossBaseAttack:70,bossActionCount:0,members:{a:player('a'),b:player('b')}};
  const snapshot = () => ({exists:true,data:()=>structuredClone(room)});
  const ref = {id:'room12345',get:async()=>snapshot()};
  let chain = Promise.resolve();
  const db = {collection:()=>({doc:()=>ref}),runTransaction(fn){
    const job=chain.then(()=>fn({get:async()=>snapshot(),update(_ref,patch){room={...room,...structuredClone(patch)};}}));
    chain=job.catch(()=>{});return job;
  }};
  const handler = createHandler({resolveA:()=>({db:{},auth:{verifyIdToken:async()=>({
    uid:'a',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'
  })}}),resolveC:()=>({db}),logger:{error(){}}});
  async function request(action, extra={}) {
    let payload, status=200;
    await handler({body:{action,roomId:ref.id,...extra},get:()=> 'Bearer fake-test-token'},
      {set(){},status(code){status=code;return this;},json(body){payload=body;return this;}});
    assert.equal(status,200,JSON.stringify(payload));return payload;
  }
  return {request,read:()=>room};
}

test('room API returns already settled all-party damage and legacy acknowledgements cannot hit again', async()=>{
  const f=fixture();
  const result=await f.request('get');
  assert.equal(result.room.members.a.hp,936);
  assert.equal(result.room.members.b.hp,936);
  assert.equal(result.room.serverDrivenBoss,true);
  const acknowledged=await f.request('boss-defense',{bossActionSeen:1});
  assert.equal(acknowledged.resolution.damage,64);
  await f.request('boss-defense',{bossActionSeen:1});
  await f.request('advance-boss');
  assert.equal(f.read().members.a.hp,936);
  assert.equal(f.read().bossActionCount,1);
});

test('start uses the ready party stats instead of passing a function to scaling',async()=>{
  const f=fixture('waiting');
  const result=await f.request('start');
  assert.equal(result.room.status,'active');
  assert.equal(result.room.bossMaxHp,3000);
  assert.equal(result.room.serverDrivenBoss,true);
});

test('returning to a completed fight restores result for pending reward claim',async()=>{
  const f=fixture('won');
  const result=await f.request('reconnect');
  assert.equal(result.roomId,'room12345');
  assert.equal(result.room.status,'won');
});
