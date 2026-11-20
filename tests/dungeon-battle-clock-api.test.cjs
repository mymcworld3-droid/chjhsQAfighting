'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,LAYOUT_VERSION}=require('../dungeon-map-generator.cjs');
const SECRET='0a1b2c3d4e5f60718293a4b5';

function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),data:()=>clone(records.get(ref.key))});
  const doc=(collection,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={id:name,key:collection+'/'+name};
    ref.get=async()=>snap(ref);
    return ref;
  };
  return {records,collection(collection){return {doc:id=>doc(collection,id)};},
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let written=false;
        const tx={
          get:async ref=>{
            assert.equal(written,false,'Firestore transactions must read before writes');
            return snap(ref);
          },
          set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
          update:(ref,value)=>{
            written=true;changes.set(ref.key,{
              ...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)
            });
          }
        };
        const result=await fn(tx);
        for(const [id,value]of changes)records.set(id,value);
        return result;
      });
      chain=task.catch(()=>{});
      return task;
    }
  };
}
function fixture(){
  const players=Object.fromEntries('abcd'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50},raidTickets:{count:4}}]));
  const a=store(players),c=store();let at=1800000000000;
  const build=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('expired');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),seedFactory:()=>SECRET,
    clock:()=>at,logger:{error(){}}
  });
  const handlers=[build(),build()];
  async function call(uid,action,body={},instance=0){
    let status=200,result;
    await handlers[instance]({
      body:{action,...body},
      get:field=>field==='authorization'?'Bearer '+uid:''
    },{
      set(){return this;},
      status(value){status=value;return this;},
      json(value){result=value;return this;}
    });
    return {status,body:result};
  }
  return {a,c,call,clock:advance=>{at+=advance;}};
}

const {TICK_MS}=require('../dungeon-battle-clock.cjs');
const {walkable}=require('../dungeon-map-generator.cjs');
async function assembledRoom(f){
  const created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code},1);
  await f.call('a','ready',{roomId:id,ready:true});
  await f.call('b','ready',{roomId:id,ready:true},1);
  const result=await f.call('a','start',{roomId:id},0);
  assert.equal(result.status,200);
  return {id,room:result.body.room};
}
test('clock is anchored once at assembly and projected from server time in member snapshots',async()=>{
  const f=fixture(),{id,room}=await assembledRoom(f);
  assert.equal(room.battleClock.version,1);
  assert.equal(room.battleClock.tickMs,TICK_MS);
  assert.equal(room.battleClock.tick,0);
  assert.equal(room.battleClock.appliedTick,0);
  assert.ok(room.battleClock.startedAtMs>0);
  f.clock(5600);
  const lookup=await f.call('b','get',{roomId:id},1);
  assert.equal(lookup.body.room.battleClock.tick,5);
  assert.equal(lookup.body.room.battleClock.elapsedMs,5600);
  assert.equal(lookup.body.room.battleClock.appliedTick,0);
  assert.equal((await f.call('b','clock',{roomId:id},1)).body.clock.tick,5);
  const persisted=f.c.records.get('dungeonRooms/'+id);
  assert.equal(persisted.battleAppliedTick,5);
  assert.equal(persisted.battleStartedAtMs,room.battleClock.startedAtMs);
});
test('concurrent clock pulses across two backends are transaction-idempotent',async()=>{
  const f=fixture(),{id,room}=await assembledRoom(f);
  f.clock(15455);
  const pulses=await Promise.all(
    Array.from({length:12},(_,i)=>f.call(i%2?'b':'a','clock',{roomId:id},i%2)));
  assert.ok(pulses.every(x=>x.status===200));
  assert.ok(pulses.every(x=>x.body.clock.tick===15));
  assert.ok(pulses.every(x=>x.body.clock.appliedTick===15));
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,room.revision+1);
  assert.equal(f.c.records.get('dungeonRooms/'+id).battleAppliedTick,15);
  const repeated=await f.call('a','clock',{roomId:id},0);
  assert.equal(repeated.body.clock.tick,15);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,room.revision+1);
  f.clock(1500);
  const later=await f.call('b','clock',{roomId:id},1);
  assert.equal(later.body.clock.tick,16);
  assert.equal(later.body.clock.appliedTick,16);
});
test('idle reconnect and movement catch up without game tick depending on player action',async()=>{
  const f=fixture(),{id,room}=await assembledRoom(f);
  const original=structuredClone(f.a.records.get('users/a'));
  f.clock(17000);
  const restored=(await f.call('b','reconnect',{},1)).body.room;
  assert.equal(restored.battleClock.tick,17);
  assert.equal(restored.battleClock.appliedTick,0);
  const map=generateDungeonLayout(SECRET,2),from=room.members.a.position;
  const [dx,dy]=[[0,1],[1,0],[0,-1],[-1,0]]
    .find(([dx,dy])=>walkable(map,{x:from.x+dx,y:from.y+dy}));
  const move=await f.call('a','move',{roomId:id,dx,dy,step:1},0);
  assert.equal(move.status,200);
  assert.equal(move.body.room.battleClock.appliedTick,17);
  assert.equal(move.body.room.members.a.explorationStamina,9);
  assert.deepStrictEqual(f.a.records.get('users/a'),original);
  const duplicate=await f.call('a','move',{roomId:id,dx,dy,step:1},1);
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.body.room.battleClock.tick,17);
  f.clock(16000);
  const heartbeat=await f.call('b','heartbeat',{roomId:id},1);
  assert.equal(heartbeat.status,200);
  const roomAfter=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(roomAfter.battleClock.appliedTick,33);
});
test('unauthorized spectators and waiting/expired/closed rooms cannot advance clock',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  assert.equal((await f.call('a','clock',{roomId:id})).status,409);
  assert.equal((await f.call('b','clock',{roomId:id})).status,403);
  assert.equal((await f.call('invalid','clock',{roomId:id})).status,401);
  await f.call('a','ready',{roomId:id,ready:true});
  const assembled=await f.call('a','start',{roomId:id});
  assert.equal(assembled.body.room.battleClock.tick,0);
  f.clock(3000);
  assert.equal((await f.call('b','clock',{roomId:id})).status,403);
  assert.equal((await f.call('a','clock',{roomId:id,serverNowMs:1e14,
    tick:1000000,paused:true})).body.clock.tick,3);
  f.clock(2*60*60*1000+1);
  assert.equal((await f.call('a','clock',{roomId:id})).status,410);
  const another=fixture(),newRoom=(await another.call('a','create')).body;
  await another.call('a','ready',{roomId:newRoom.roomId,ready:true});
  await another.call('a','start',{roomId:newRoom.roomId});
  await another.call('a','disband',{roomId:newRoom.roomId});
  assert.equal((await another.call('a','clock',{roomId:newRoom.roomId})).status,410);
});
test('cancel assembly stops clock and a new assembly resets the epoch',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  await f.call('a','ready',{roomId:id,ready:true});
  const before=(await f.call('a','start',{roomId:id})).body.room;
  f.clock(5000);
  assert.equal((await f.call('a','clock',{roomId:id})).body.clock.tick,5);
  assert.equal((await f.call('a','cancel-start',{roomId:id})).status,200);
  const waiting=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(waiting.battleClock,null);
  assert.equal((await f.call('a','clock',{roomId:id})).status,409);
  f.clock(5000);
  await f.call('a','ready',{roomId:id,ready:true});
  const restarted=(await f.call('a','start',{roomId:id})).body.room;
  assert.equal(restarted.battleClock.tick,0);
  assert.notEqual(restarted.battleClock.startedAtMs,before.battleClock.startedAtMs);
});
test('old stage-7 rooms with only assembledAtMs use stable clock without migration',async()=>{
  const f=fixture(),{id,room}=await assembledRoom(f);
  const record=f.c.records.get('dungeonRooms/'+id);
  delete record.battleClockVersion;
  delete record.battleStartedAtMs;
  delete record.battleAppliedTick;
  delete record.battleAppliedAtMs;
  f.clock(22000);
  const clockReply=await f.call('a','clock',{roomId:id});
  assert.equal(clockReply.status,200);
  assert.equal(clockReply.body.clock.startedAtMs,room.assembledAtMs);
  assert.equal(clockReply.body.clock.tick,22);
  assert.equal(f.c.records.get('dungeonRooms/'+id).battleAppliedTick,22);
});
