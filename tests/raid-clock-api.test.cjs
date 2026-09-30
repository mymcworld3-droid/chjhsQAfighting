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
  const playerDocs = new Map([
    ['users/a',{uid:'a',raidTickets:{count:10,lastGrantDate:'2099-01-01'}}],
    ['users/b',{uid:'b',raidTickets:{count:10,lastGrantDate:'2099-01-01'}}],
    ['users/player1',{uid:'player1',raidTickets:{count:10,lastGrantDate:'2099-01-01'}}],
    ['users/player2',{uid:'player2',raidTickets:{count:10,lastGrantDate:'2099-01-01'}}],
    ['users/player3',{uid:'player3',raidTickets:{count:10,lastGrantDate:'2099-01-01'}}]
  ]);
  const playerSnapshot = ref => ({exists:playerDocs.has(ref.key),data:()=>structuredClone(playerDocs.get(ref.key))});
  const playerDb = {
    collection(name){return {doc(id){return {key:name+'/'+id,get:async()=>playerSnapshot({key:name+'/'+id})};}};},
    runTransaction(fn){
      const pending=new Map();
      return Promise.resolve(fn({
        get:async ref=>playerSnapshot(ref),
        set(ref,value){pending.set(ref.key,structuredClone(value));},
        update(ref,patch){
          const base=structuredClone(pending.get(ref.key)||playerDocs.get(ref.key)||{});
          pending.set(ref.key,{...base,...structuredClone(patch)});
        }
      })).then(result=>{for(const [key,value] of pending)playerDocs.set(key,value);return result;});
    }
  };
  const handler = createHandler({resolveA:()=>({db:playerDb,auth:{verifyIdToken:async()=>({
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

test('start assigns fixed Boss stats to the ready party',async()=>{
  const f=fixture('waiting');
  const result=await f.request('start');
  assert.equal(result.room.status,'active');
  assert.equal(result.room.bossMaxHp,4800);
  assert.equal(result.room.serverDrivenBoss,true);
  assert.equal(result.room.bossBaseAttack,70);
});

test('returning to a completed fight restores result for pending reward claim',async()=>{
  const f=fixture('won');
  const result=await f.request('reconnect');
  assert.equal(result.roomId,'room12345');
  assert.equal(result.room.status,'won');
});

test('room start assigns the same Boss HP and attack for one through four players',async()=>{
  for(const size of [1,2,3,4]) {
    const f=fixture('waiting'),room=f.read(),base=room.members.a;
    room.members=Object.fromEntries(Array.from({length:size},(_,i)=>{
      const uid=i===0?'a':'player'+i;
      return [uid,{...base,uid,host:i===0,atk:200*(i+1),maxHp:1000*(i+1)}];
    }));
    const result=await f.request('start');
    assert.equal(result.room.bossMaxHp,4800);
    assert.equal(result.room.bossBaseAttack,70);
  }
});
