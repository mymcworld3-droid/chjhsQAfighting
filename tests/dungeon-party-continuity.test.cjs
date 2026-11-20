'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const API=require('../dungeon-room-api.cjs').__test;
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const Boss=require('../dungeon-boss-battle.cjs');

const SEED='f0e1d2c3b4a5968778695a4b';
function store(initial={}){
  const records=new Map(Object.entries(initial));
  let serial=0,chain=Promise.resolve();
  const doc=(collection,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={id:name,key:collection+'/'+name};
    ref.get=async()=>snapshot(ref);
    return ref;
  };
  const snapshot=ref=>({id:ref.id,exists:records.has(ref.key),
    data:()=>structuredClone(records.get(ref.key))});
  return {records,collection(name){return {doc:id=>doc(name,id)};},
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let wrote=false;
        const tx={
          get:async ref=>{
            assert.equal(wrote,false,'Firestore transaction read after write');
            return snapshot(ref);
          },
          set:(ref,value)=>{wrote=true;changes.set(ref.key,structuredClone(value));},
          update:(ref,patch)=>{
            wrote=true;
            changes.set(ref.key,{...structuredClone(changes.get(ref.key)||records.get(ref.key)),
              ...structuredClone(patch)});
          }
        };
        const outcome=await fn(tx);
        for(const [key,value]of changes)records.set(key,value);
        return outcome;
      });
      chain=task.catch(()=>{});
      return task;
    }
  };
}
function fixture(){
  const a=store(Object.fromEntries('abc'.split('').map(uid=>[
    'users/'+uid,{uid,displayName:'修士'+uid,stats:{totalScore:40,gold:5}}
  ])));
  const c=store();
  let at=1800000000000;
  const handler=API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async uid=>({
      uid,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A
    })}}),
    resolveC:()=>({db:c}),seedFactory:()=>SEED,clock:()=>at,
    logger:{error(){}}
  });
  async function call(uid,action,payload={}){
    let status=200,body;
    await handler({body:{action,...payload},get:()=> 'Bearer '+uid},{
      set(){return this;},status(value){status=value;return this;},
      json(value){body=value;return this;}
    });
    return {status,body};
  }
  return {a,c,call,advance:ms=>{at+=ms;}};
}
async function assembled(f){
  const created=(await f.call('a','create')).body;
  const roomId=created.roomId;
  for(const uid of 'bc')
    assert.equal((await f.call(uid,'join-code',{roomCode:created.room.code})).status,200);
  for(const uid of 'abc')
    assert.equal((await f.call(uid,'ready',{roomId,ready:true})).status,200);
  assert.equal((await f.call('a','start',{roomId})).status,200);
  return roomId;
}
test('one departure during exploration never resets survivors or NPC clock',async()=>{
  const f=fixture(),roomId=await assembled(f);
  const before=(await f.call('b','get',{roomId})).body.room;
  const map=generateDungeonLayout(SEED,2);
  const p=before.members.b.position;
  const [dx,dy]=[[1,0],[0,1],[-1,0],[0,-1]]
    .find(([x,y])=>walkable(map,{x:p.x+x,y:p.y+y}));
  assert.equal((await f.call('b','move',{roomId,dx,dy,step:1})).status,200);
  const afterMove=(await f.call('b','get',{roomId})).body.room;
  assert.equal(afterMove.members.b.moveSeq,1);
  assert.equal(afterMove.members.b.explorationStamina,
    before.members.b.explorationStamina-1);
  const leaving=await f.call('a','leave',{roomId});
  assert.equal(leaving.status,200);
  const next=leaving.body.room;
  assert.equal(next.status,'assembled');
  assert.equal(next.hostUid,'b');
  assert.equal(next.members.a,undefined);
  assert.deepStrictEqual(next.members.b.position,afterMove.members.b.position);
  assert.equal(next.members.b.explorationStamina,afterMove.members.b.explorationStamina);
  assert.deepStrictEqual(next.enemies,afterMove.enemies);
  assert.deepStrictEqual(next.dungeonProgress,afterMove.dungeonProgress);
  assert.deepStrictEqual(next.battleClock,afterMove.battleClock);
  assert.equal((await f.call('a','reconnect')).body.room,null);
  assert.equal((await f.call('a','get',{roomId})).status,403);
  assert.equal((await f.call('b','reconnect')).body.room.status,'assembled');
  assert.equal((await f.call('a','join-code',{roomCode:next.code})).status,409);
  f.advance(1000);
  assert.equal((await f.call('b','clock',{roomId})).status,200,
    'surviving teammate can advance the battle clock');
  assert.equal((await f.call('c','leave',{roomId})).body.room.status,'assembled',
    'a one-person party can finish its shared adventure');
  const last=await f.call('b','leave',{roomId});
  assert.equal(last.body.room.status,'closed');
  assert.deepStrictEqual(last.body.room.enemies,[]);
  assert.equal(last.body.room.dungeonProgress,null);
});
test('leaving a live boss fight cannot teleport or reset the remaining players',async()=>{
  const f=fixture(),roomId=await assembled(f);
  const map=generateDungeonLayout(SEED,2);
  const stored=f.c.records.get(API.ROOMS+'/'+roomId);
  stored.dungeonProgress={...stored.dungeonProgress,guardianStatus:'defeated',
    keyAcquired:true,portalStatus:'open'};
  for(const uid of 'abc')stored.members[uid].position={...map.portalSite};
  const first=await f.call('a','enter-boss',{roomId});
  assert.equal(first.status,200);
  assert.equal(first.body.room.dungeonArena,'exploration',
    'the first YES may never drag teammates into the arena');
  assert.equal(first.body.room.bossPortalReady.readyCount,1);
  const second=await f.call('b','boss-ready',{roomId,ready:true});
  assert.equal(second.status,200);
  assert.equal(second.body.room.bossPortalReady.readyCount,2);
  const arrival=await f.call('c','enter-boss',{roomId});
  assert.equal(arrival.status,200,JSON.stringify(arrival.body));
  assert.equal(arrival.body.room.dungeonArena,'boss');
  const before=arrival.body.room;
  const leave=await f.call('a','leave',{roomId});
  assert.equal(leave.status,200);
  const next=leave.body.room;
  assert.equal(next.status,'assembled');
  assert.equal(next.dungeonArena,'boss');
  assert.equal(next.bossEncounter.status,'fighting');
  assert.equal(next.enemies[0].id,Boss.ID);
  assert.equal(next.enemies[0].battleHealth,Boss.HP);
  for(const uid of 'bc'){
    assert.deepStrictEqual(next.members[uid].position,before.members[uid].position);
    assert.equal(next.members[uid].battleHealth,before.members[uid].battleHealth);
  }
  const arena=Boss.mapFor(SEED),pos=next.members.b.position;
  const [dx,dy]=[[1,0],[0,1],[-1,0],[0,-1]]
    .find(([x,y])=>walkable(arena,{x:pos.x+x,y:pos.y+y}));
  const moved=await f.call('b','move',{roomId,dx,dy,step:1});
  assert.equal(moved.status,200,JSON.stringify(moved.body));
  assert.equal(moved.body.room.dungeonArena,'boss');
  assert.equal(moved.body.room.members.b.moveSeq,1);
  assert.equal((await f.call('c','get',{roomId})).body.room.bossEncounter.status,'fighting');
});

// Test helper: C stores a server-issued map; only the test arranges characters
// next to the portal so we can exercise voting independently of movement.
function openPortal(f,roomId){
  const map=generateDungeonLayout(SEED,2);
  const stored=f.c.records.get(API.ROOMS+'/'+roomId);
  stored.dungeonProgress={...stored.dungeonProgress,
    guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'};
  for(const uid of Object.keys(stored.members))
    stored.members[uid].position={...map.portalSite};
  return stored;
}
test('concurrent confirmations on one C room cause exactly one boss transition',async()=>{
  const f=fixture(),roomId=await assembled(f);
  openPortal(f,roomId);
  const outcomes=await Promise.all('abc'.split('').map(uid=>
    f.call(uid,'boss-ready',{roomId,ready:true})));
  assert.ok(outcomes.every(r=>r.status===200),JSON.stringify(outcomes));
  const results=outcomes.map(x=>x.body.room);
  assert.equal(results.filter(x=>x.dungeonArena==='boss').length,1,
    'only the final serialized transaction performs a transition');
  const final=(await f.call('a','get',{roomId})).body.room;
  assert.equal(final.dungeonArena,'boss');
  assert.equal(final.enemies.length,1);
  assert.equal(final.enemies[0].id,Boss.ID);
  assert.equal(final.enemies[0].battleHealth,Boss.HP);
  assert.equal(final.bossPortalReady,null);
  assert.equal((await f.call('a','boss-ready',{roomId,ready:false})).status,409);
  const before=final.revision;
  const retry=await f.call('a','enter-boss',{roomId});
  assert.equal(retry.status,200);
  assert.equal(retry.body.room.revision,before,'duplicate after arrival has no effect');
});
test('cancel vote, changed position and missing consent prevent premature boss entry',async()=>{
  const f=fixture(),roomId=await assembled(f);
  const stored=openPortal(f,roomId);
  assert.equal((await f.call('a','boss-ready',{roomId,ready:'true'})).status,400);
  assert.equal((await f.call('a','boss-ready',{roomId,ready:true})).status,200);
  let room=(await f.call('a','get',{roomId})).body.room;
  assert.equal(room.bossPortalReady.readyCount,1);
  const repeated=await f.call('a','boss-ready',{roomId,ready:true});
  assert.equal(repeated.body.room.revision,room.revision,'retry is idempotent');
  assert.equal((await f.call('a','boss-ready',{roomId,ready:false})).status,200);
  room=(await f.call('a','get',{roomId})).body.room;
  assert.equal(room.bossPortalReady.readyCount,0);
  await f.call('a','boss-ready',{roomId,ready:true});
  await f.call('b','boss-ready',{roomId,ready:true});
  f.c.records.get(API.ROOMS+'/'+roomId).members.a.moveSeq=1;
  // A committed movement invalidates the previous position/step vote token.
  const moved=(await f.call('a','get',{roomId})).body.room;
  assert.equal(moved.bossPortalReady.readyCount,1);
  const missing=await f.call('c','enter-boss',{roomId});
  assert.equal(missing.status,200);
  assert.equal(missing.body.room.dungeonArena,'exploration',
    'a stale vote must not count even though the client still displays it');
  assert.equal(missing.body.room.bossPortalReady.readyCount,2);
  const restored=await f.call('a','enter-boss',{roomId});
  assert.equal(restored.body.room.dungeonArena,'boss');
});
test('departure shrinks required roster without resetting ready teammates',async()=>{
  const f=fixture(),roomId=await assembled(f);
  openPortal(f,roomId);
  await f.call('a','boss-ready',{roomId,ready:true});
  await f.call('b','boss-ready',{roomId,ready:true});
  const departure=await f.call('c','leave',{roomId});
  assert.equal(departure.status,200);
  assert.equal(departure.body.room.status,'assembled');
  assert.equal(departure.body.room.bossPortalReady.requiredCount,2);
  assert.equal(departure.body.room.bossPortalReady.readyCount,2);
  assert.equal(departure.body.room.dungeonArena,'exploration');
  const final=await f.call('a','enter-boss',{roomId});
  assert.equal(final.status,200);
  assert.equal(final.body.room.dungeonArena,'boss');
  assert.equal(Object.keys(final.body.room.members).length,2);
});
test('stale disconnected teammates do not block two-person or solo transition',async()=>{
  const f=fixture(),roomId=await assembled(f);
  const stored=openPortal(f,roomId);
  stored.members.c.heartbeatAtMs=1;
  const first=await f.call('a','boss-ready',{roomId,ready:true});
  assert.equal(first.body.room.bossPortalReady.requiredCount,2);
  assert.equal(first.body.room.bossPortalReady.offlineCount,1);
  assert.equal(first.body.room.dungeonArena,'exploration');
  const last=await f.call('b','boss-ready',{roomId,ready:true});
  assert.equal(last.body.room.dungeonArena,'boss');
  assert.ok(last.body.room.members.c,'offline teammate can reconnect to the boss scene');
  assert.equal((await f.call('c','reconnect')).body.room.dungeonArena,'boss');
});
test('unactivated portal, distant players and downed members cannot give consent',async()=>{
  const f=fixture(),roomId=await assembled(f);
  assert.equal((await f.call('a','enter-boss',{roomId})).status,409);
  const stored=openPortal(f,roomId);
  stored.members.a.position={...generateDungeonLayout(SEED,2).spawn};
  assert.equal((await f.call('a','boss-ready',{roomId,ready:true})).status,409);
  stored.members.a.position={...generateDungeonLayout(SEED,2).portalSite};
  stored.members.a.downed=true;
  assert.equal((await f.call('a','boss-ready',{roomId,ready:true})).status,409);
  assert.equal((await f.call('d','boss-ready',{roomId,ready:true})).status,403);
  assert.equal((await f.call('a','get',{roomId})).body.room.dungeonArena,'exploration');
});

test('boss guard API is serialized and a retried packet cannot spend stamina twice',async()=>{
  const f=fixture(),roomId=await assembled(f);
  openPortal(f,roomId);
  for(const uid of 'abc'){
    const vote=await f.call(uid,'boss-ready',{roomId,ready:true});
    assert.equal(vote.status,200);
  }
  const stored=f.c.records.get(API.ROOMS+'/'+roomId);
  stored.members.a.position={x:7,y:13};
  stored.members.b.position={x:9,y:13};
  const guard=await f.call('a','boss-guard',{roomId,targetUid:'b',seq:1});
  assert.equal(guard.status,200,JSON.stringify(guard.body));
  assert.equal(guard.body.room.members.b.bossGuard.sourceUid,'a');
  assert.equal(guard.body.room.members.a.explorationStamina,7);
  const retry=await f.call('a','boss-guard',{roomId,targetUid:'b',seq:1});
  assert.equal(retry.status,200);
  assert.equal(retry.body.room.revision,guard.body.room.revision);
  assert.equal(retry.body.room.members.a.explorationStamina,7);
  assert.equal((await f.call('a','boss-guard',{roomId,targetUid:'ghost',seq:2})).status,403);
  assert.equal((await f.call('b','boss-guard',{roomId,targetUid:'a',seq:9})).status,409);
  assert.equal((await f.call('a','boss-guard',{roomId,targetUid:'b',seq:2})).status,409,
    'active guard cannot be overwritten at another stamina cost');
  assert.equal((await f.call('a','get',{roomId})).body.room.members.a.explorationStamina,7);
  const outsider=await f.call('d','boss-guard',{roomId,targetUid:'b',seq:1});
  assert.equal(outsider.status,403);
});
