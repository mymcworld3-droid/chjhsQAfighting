'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {__test:STREAM}=require('../dungeon-room-stream.cjs');

function database(initial={}){
  const records=new Map(Object.entries(initial)),listeners=new Map();
  let next=0,chain=Promise.resolve();
  const clone=v=>structuredClone(v);
  const key=ref=>ref.collection+'/'+ref.id;
  const snap=ref=>({
    exists:records.has(key(ref)),id:ref.id,data:()=>clone(records.get(key(ref)))
  });
  const fire=ref=>{
    const subs=listeners.get(key(ref));
    for(const callback of subs||[])callback(snap(ref));
  };
  const doc=(collection,id)=>{
    const ref={id:id||'dungroom'+String(++next).padStart(8,'0'),collection};
    ref.get=async()=>snap(ref);
    ref.onSnapshot=(onNext,onError)=>{
      const id=key(ref);
      if(!listeners.has(id))listeners.set(id,new Set());
      listeners.get(id).add(onNext);
      queueMicrotask(()=>{if(listeners.get(id)?.has(onNext))onNext(snap(ref));});
      return ()=>listeners.get(id)?.delete(onNext);
    };
    return ref;
  };
  const db={
    records,listeners,collection(name){
      const query={
        doc:id=>doc(name,id),
        where(){return query;},limit(){return query;},
        async get(){return {docs:[]};}
      };
      return query;
    },
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let wrote=false;
        const tx={
          get:async ref=>{
            assert.equal(wrote,false,'Firestore reads must precede transaction writes');
            return snap(ref);
          },
          set:(ref,value)=>{wrote=true;changes.set(key(ref),clone(value));},
          update:(ref,value)=>{
            wrote=true;
            changes.set(key(ref),{...clone(changes.get(key(ref))||records.get(key(ref))),...clone(value)});
          }
        };
        const result=await fn(tx);
        for(const [id,data]of changes){
          records.set(id,data);
          const split=id.indexOf('/');
          fire(doc(id.slice(0,split),id.slice(split+1)));
        }
        return result;
      });
      chain=task.catch(()=>{});return task;
    },
    listenerCount(roomId){
      return listeners.get('dungeonRooms/'+roomId)?.size||0;
    },
    forceRoom(roomId,patch){
      const k='dungeonRooms/'+roomId;
      records.set(k,{...clone(records.get(k)),...clone(patch)});
      fire(doc('dungeonRooms',roomId));
    }
  };
  return db;
}
function fixture(){
  let at=Date.now();
  const players=Object.fromEntries('abcdef'.split('').map(uid=>['users/'+uid,{
    uid,displayName:'修士'+uid,stats:{totalScore:30},raidTickets:{count:5}
  }]));
  const a=database(players),c=database();
  const make=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('expired token');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),clock:()=>at,logger:{error(){}}
  });
  const handlers=[make(),make()]; // distinct server instances, shared Firestore
  async function call(uid,action,payload={},instance=0){
    const req=new EventEmitter();
    req.aborted=false;req.body={action,...payload};
    req.get=key=>key==='authorization'?'Bearer '+uid:'';
    const res=new EventEmitter();
    res.writes=[];res.statusCode=200;res.writableLength=0;
    res.destroyed=false;res.writableEnded=false;
    res.set=function(value){this.headers={...this.headers,...value};return this;};
    res.status=function(value){this.statusCode=value;return this;};
    res.json=function(value){this.body=value;return this;};
    res.write=function(text){this.writes.push(String(text));return true;};
    res.flushHeaders=()=>{};
    res.end=function(){this.writableEnded=true;this.emit('close');};
    await handlers[instance](req,res);
    await new Promise(resolve=>setImmediate(resolve));
    return {req,res,status:res.statusCode,body:res.body};
  }
  const advance=ms=>{at+=ms;};
  const close=session=>{session.req.aborted=true;session.req.emit('aborted');};
  const packets=session=>session.res.writes.filter(x=>x.startsWith('data: '))
    .map(x=>JSON.parse(x.slice(6).trim()));
  return {a,c,advance,call,close,packets,get at(){return at;}};
}
test('signed Firebase A stream works across instances and rejects non-members',async()=>{
  const f=fixture();
  const created=(await f.call('a','create')).body;
  const noAccess=await f.call('b','subscribe',{roomId:created.roomId});
  assert.equal(noAccess.status,403);
  assert.equal(noAccess.res.writes.length,0);
  const invalid=await f.call('invalid','subscribe',{roomId:created.roomId});
  assert.equal(invalid.status,401);
  const owner=await f.call('a','subscribe',{roomId:created.roomId},0);
  assert.equal(owner.res.headers['Content-Type'],'text/event-stream; charset=utf-8');
  assert.equal(owner.res.headers['X-Accel-Buffering'],'no');
  assert.equal(f.c.listenerCount(created.roomId),1);
  assert.equal(f.packets(owner).length,1,'initial + snapshot must not duplicate the same revision');
  assert.equal(f.packets(owner)[0].room.revision,1);
  const joined=await f.call('b','join-code',{roomCode:created.room.code},1);
  assert.equal(joined.status,200);
  assert.equal(f.packets(owner).at(-1).room.revision,2);
  const second=await f.call('b','subscribe',{roomId:created.roomId},1);
  assert.equal(f.c.listenerCount(created.roomId),2);
  await f.call('b','ready',{roomId:created.roomId,ready:true},1);
  assert.equal(f.packets(owner).at(-1).room.members.b.ready,true);
  assert.equal(f.packets(second).at(-1).room.members.b.ready,true);
  assert.equal(f.packets(owner).at(-1).room.revision,3);
  f.close(owner);f.close(second);
  assert.equal(f.c.listenerCount(created.roomId),0);
});
test('kicked members stop receiving new room state, and disband terminates streams',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  await f.call('b','join-code',{roomCode:created.room.code});
  const member=await f.call('b','subscribe',{roomId:created.roomId});
  const captain=await f.call('a','subscribe',{roomId:created.roomId});
  await f.call('a','kick',{roomId:created.roomId,targetUid:'b'});
  assert.equal(f.packets(member).at(-1).status,403);
  assert.equal(member.res.writableEnded,true);
  assert.equal(f.c.listenerCount(created.roomId),1);
  assert.equal(f.packets(captain).at(-1).room.members.b,undefined);
  await f.call('a','disband',{roomId:created.roomId});
  assert.equal(f.packets(captain).at(-1).status,410);
  assert.equal(captain.res.writableEnded,true);
  assert.equal(f.c.listenerCount(created.roomId),0);
});
test('out-of-order snapshot revisions cannot roll back a connected player',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  const watcher=await f.call('a','subscribe',{roomId:created.roomId});
  await f.call('a','ready',{roomId:created.roomId,ready:true});
  const count=f.packets(watcher).length;
  f.c.forceRoom(created.roomId,{revision:1});
  assert.equal(f.packets(watcher).length,count);
  f.close(watcher);
});
test('presence heartbeat is rate-limited and leaves ready flags unchanged',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  assert.equal(created.room.members.a.online,true);
  assert.equal((await f.call('a','heartbeat',{roomId:id})).body.revision,1);
  f.advance(API.HEARTBEAT_MIN_MS-1);
  assert.equal((await f.call('a','heartbeat',{roomId:id})).body.revision,1);
  f.advance(1);
  const beat=await f.call('a','heartbeat',{roomId:id});
  assert.equal(beat.status,200);
  assert.equal(beat.body.revision,2);
  assert.equal(beat.body.heartbeatAtMs,f.at);
  assert.equal((await f.call('a','heartbeat',{roomId:id})).body.revision,2);
  const room=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(room.members.a.ready,false);
  assert.equal(room.members.a.online,true);
  f.advance(API.PRESENCE_STALE_MS+1);
  assert.equal((await f.call('a','get',{roomId:id})).body.room.members.a.online,false);
  assert.equal((await f.call('b','heartbeat',{roomId:id})).status,403);
  assert.deepEqual(f.a.records.get('users/a').raidTickets,{count:5});
});
test('heartbeat renews the room and code lease before expiration, without admitting outsiders',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  const oldExpiry=created.room.expiresAtMs;
  f.advance(API.RENEW_IF_LESS_THAN_MS+1);
  // Move into the final renewal window of a two-hour lobby.
  f.advance((oldExpiry-f.at)-API.RENEW_IF_LESS_THAN_MS+1);
  const beat=await f.call('a','heartbeat',{roomId:id});
  assert.equal(beat.status,200);
  const renewed=(await f.call('a','get',{roomId:id})).body.room;
  assert.ok(renewed.expiresAtMs>oldExpiry);
  assert.equal(f.c.records.get(API.CODES+'/'+created.room.code).expiresAtMs,renewed.expiresAtMs);
  assert.equal((await f.call('b','subscribe',{roomId:id})).status,403);
  // No heartbeat may restore membership after disband.
  await f.call('a','disband',{roomId:id});
  assert.equal((await f.call('a','heartbeat',{roomId:id})).status,410);
});
test('streamed room never leaks data to an expired lobby and abort closes listener',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body;
  const stream=await f.call('a','subscribe',{roomId:created.roomId});
  assert.equal(f.c.listenerCount(created.roomId),1);
  f.close(stream);
  assert.equal(f.c.listenerCount(created.roomId),0);
  f.advance(2*60*60*1000+1);
  assert.equal((await f.call('a','subscribe',{roomId:created.roomId})).status,410);
  assert.equal((await f.call('a','heartbeat',{roomId:created.roomId})).status,410);
});
test('protocol sends keepalive with bounded stream lifetime constants',()=>{
  assert.equal(STREAM.KEEPALIVE_MS,15000);
  assert.equal(STREAM.STREAM_TTL_MS,240000);
  assert.equal(STREAM.MAX_PENDING_BYTES,1024*1024);
  const fs=require('node:fs'),path=require('node:path');
  const client=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-room.js'),'utf8');
  const lobby=fs.readFileSync(path.join(__dirname,'../public/cultivation/dungeon-lobby.js'),'utf8');
  assert.match(client,/readRoomEvents\(/);
  assert.match(client,/authenticatedMainFetch\(ENDPOINT/);
  assert.match(client,/subscribeDungeonRoom/);
  assert.match(client,/heartbeatDungeonRoom/);
  assert.match(lobby,/nextFallbackAt/);
  assert.match(lobby,/revision<roomRevision/);
  assert.match(lobby,/stopRoomStream\(\)/);
  assert.match(lobby,/streamConnected\?'即時同步'/);
});
