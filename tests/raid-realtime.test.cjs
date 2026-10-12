const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {streamRaidRoom} = require('../raid-room-stream.cjs');
const {createHandler,reserveRaidTickets} = require('../raid-room-api.cjs').__test;
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const room = revision => ({id:'room12345',revision,status:'waiting',members:{a:{uid:'a',ready:false}}});

function streamFixture(settleSpirit = async () => null) {
  const req = new EventEmitter(), res = new EventEmitter();
  const writes = []; let next, cancelled = 0, ended = 0;
  Object.assign(res,{set(){},flushHeaders(){},write:value => {writes.push(value);return true;},end(){ended++;}});
  const ref = {id:'room12345',onSnapshot(fn){next=fn;return()=>cancelled++;}};
  streamRaidRoom({req,res,ref,uid:'a',initialRoom:room(1),settleSpirit});
  const packets = () => writes.filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(6)));
  return {req,res,packets,emit:value => next({exists:true,data:()=>value}),missing:()=>next({exists:false}),cancelled:()=>cancelled,ended:()=>ended};
}

test('Firebase pushes join, ready and start before slow A settlement completes, then closes its listener',async t => {
  let release; const f = streamFixture(() => new Promise(resolve => {release=resolve;}));
  t.after(()=>f.res.emit('close'));
  assert.equal(f.packets()[0].room.revision,1);
  f.emit({...room(2),members:{a:{uid:'a'},b:{uid:'b'}}});
  f.emit({...room(3),members:{a:{uid:'a',ready:true},b:{uid:'b',ready:true}}});
  f.emit({...room(4),status:'active'});
  assert.deepEqual(f.packets().map(packet => packet.room?.revision),[1,2,3,4]);
  release({uid:'a',status:'awarded'}); await flush();
  f.res.emit('close'); f.req.emit('aborted');
  assert.equal(f.cancelled(),1); assert.equal(f.ended(),1);
});

test('stream rejects removed members and deleted rooms without leaking a new snapshot',t => {
  const removed = streamFixture(); t.after(()=>removed.res.emit('close'));
  removed.emit({...room(2),members:{b:{uid:'b',private:'hidden'}}});
  assert.equal(removed.packets().at(-1).status,403);
  assert.equal(JSON.stringify(removed.packets()).includes('hidden'),false);
  assert.equal(removed.cancelled(),1);
  const deleted = streamFixture(); t.after(()=>deleted.res.emit('close'));
  deleted.missing(); assert.equal(deleted.packets().at(-1).status,404); assert.equal(deleted.cancelled(),1);
});

test('event parser handles byte-split Chinese text, CRLF, comments and server errors',async()=>{
  const source=read('public/cultivation/data/room-event-stream.js').replace(/^export /gm,'');
  const parse=vm.runInNewContext(source+'\nreadRoomEvents',{TextDecoder});
  const payload=': heartbeat\r\n\r\ndata: '+JSON.stringify({room:{name:'清霜試煉',revision:2}})+'\r\n\r\n';
  const bytes=new TextEncoder().encode(payload);
  const response=new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
  const packets=[];await parse(response,packet=>packets.push(packet),new AbortController().signal);
  assert.equal(packets.length,1);assert.equal(packets[0].room.name,'清霜試煉');
  await assert.rejects(()=>parse(new Response('data: {"error":"removed","status":403}\n\n',{headers:{'content-type':'text/event-stream'}}),()=>{},new AbortController().signal),error=>error.status===403);
});

function clientFixture() {
  let next, failure, connected, cancelled=0, result;
  const requests=[], timers=new Map();let timerId=0;
  const context={window:{getCurrentUserData:()=>null},localStorage:{setItem(){},removeItem(){}},
    setInterval(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id),
    raidRepository:{request:async action=>{requests.push(action);return result;},
      subscribeRoom(id,n,f,c){next=n;failure=f;connected=c;return()=>cancelled++;}}};
  const source=read('public/cultivation/raid-room.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  vm.runInNewContext(source+'\nthis.operations={subscribeRaidRoom,setRaidReady,startRaidRoom};',context);
  return {api:context.operations,requests,timers,emit:packet=>next(packet),connection:value=>connected(value),
    failure:error=>failure(error),setResult:value=>{result=value;},cancelled:()=>cancelled};
}

test('initial and operation responses update immediately; stale HTTP cannot roll back a newer Firebase push',async()=>{
  const f=clientFixture(), seen=[];
  const stop=f.api.subscribeRaidRoom('room12345',value=>seen.push(value),()=>{},{room:room(1)});
  assert.equal(seen.at(-1).revision,1);assert.equal(f.requests.length,0);
  f.connection(true);f.emit({room:room(3)});
  f.setResult({room:room(2)});await f.api.setRaidReady('room12345',true);
  assert.equal(seen.at(-1).revision,3);
  f.setResult({room:{...room(4),status:'active'}});await f.api.startRaidRoom('room12345');
  assert.equal(seen.at(-1).status,'active');assert.equal(f.timers.size,0);
  stop();f.emit({room:room(5)});assert.equal(seen.at(-1).revision,4);assert.equal(f.cancelled(),1);
});

test('disconnected stream gets fast fallback polling and recovers without leaving an extra poller',async()=>{
  const f=clientFixture(), seen=[];
  const stop=f.api.subscribeRaidRoom('room12345',value=>seen.push(value),()=>{},{room:room(1)});
  f.setResult({room:room(2)});f.connection(false);await flush();
  assert.equal(seen.at(-1).revision,2);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,500);
  f.connection(true);assert.equal(f.timers.size,0);
  f.failure({status:403,message:'removed'});assert.equal(seen.at(-1),null);assert.equal(f.cancelled(),1);
  stop();
});

test('all party ticket documents are read concurrently and deducted atomically',async()=>{
  const reads=[],pending=[],writes=[];
  const docs=new Map(['a','b','c','d'].map(uid=>['users/'+uid,{raidTickets:{count:3,lastGrantDate:'2026-10-12'}}]));
  const db={collection:name=>({doc:id=>({key:name+'/'+id})}),runTransaction:fn=>fn({
    get:ref=>{reads.push(ref.key);if(ref.key.startsWith('raidTicketReservations/'))return Promise.resolve({exists:false});
      return new Promise(resolve=>pending.push(()=>resolve({exists:true,data:()=>docs.get(ref.key)})));},
    update:(ref,data)=>writes.push({ref,data}),set:(ref,data)=>writes.push({ref,data})})};
  const reservation=reserveRaidTickets(db,'room12345',['a','b','c','d'].map(uid=>({uid})),Date.parse('2026-10-12T00:00:00Z'));
  await flush();assert.equal(reads.length,5);assert.equal(writes.length,0);
  pending.forEach(resolve=>resolve());const result=await reservation;
  assert.equal(result.memberUids.length,4);assert.equal(writes.length,5);
  assert.ok(writes.filter(write=>write.ref.key.startsWith('users/')).every(write=>write.data.raidTickets.count===2));
});

test('ready reads trusted A player and C room in parallel and returns the fresh authoritative snapshot',async()=>{
  let releaseA, releaseC, readsC=0;const reads=[];
  const current={...room(5),createdAtMs:Date.now(),hostUid:'a',members:{a:{uid:'a',host:true,online:true,heartbeatAtMs:Date.now(),joinedAtMs:1}}};
  const cSnap=()=>({exists:true,data:()=>structuredClone(current)});
  const ref={id:'room12345'};
  const db={collection:()=>({doc:()=>ref}),runTransaction:fn=>fn({get:()=>{
    reads.push('C');return readsC++===0?new Promise(resolve=>{releaseC=()=>resolve(cSnap());}):Promise.resolve(cSnap());},
    update:(_,patch)=>Object.assign(current,patch)})};
  const playerDb={collection:name=>({doc:()=>({get:()=>{
    if(name!=='users')return Promise.resolve({exists:false});reads.push('A');
    return new Promise(resolve=>{releaseA=()=>resolve({exists:true,data:()=>({stats:{totalScore:68,attack:240}})});});}})})};
  const handler=createHandler({resolveA:()=>({db:playerDb,auth:{verifyIdToken:async()=>({uid:'a',aud:'question-learning',iss:'https://securetoken.google.com/question-learning'})}}),resolveC:()=>({db}),logger:{error(){}}});
  let body;
  const request=handler({body:{action:'ready',roomId:ref.id,ready:true},get:()=> 'Bearer test-token'},
    {set(){},status(){return this;},json:value=>{body=value;}});
  await flush();assert.deepEqual(reads,['C','A']);releaseA();releaseC();await request;
  assert.equal(body.ok,true);assert.equal(body.room.members.a.ready,true);assert.equal(body.room.members.a.atk,240);
  assert.equal(body.room.revision,6);
});

test('starting the raid renders the arena while AI generation is still pending',async()=>{
  const source=read('public/cultivation/raid-mode.js');
  const start=source.indexOf('  async function beginActiveRaid('),end=source.indexOf('  function handleRoomSnapshot(',start);
  let release, arenas=0,questions=0;
  const current={...room(2),status:'active',startedAtMs:100,bossHp:4800,bossMaxHp:4800,bossBaseAttack:70,members:{a:{uid:'a',hp:1000}}};
  const context={state:{roomId:current.id,player:{uid:'a',hp:1000},status:'lobby',bossActionCount:0,lastBossActionSeen:0,playerActionCount:0},
    RAID_MVP:{},randomId:()=> 'run',myRoomMember:()=>current.members.a,shenPhaseForHp:()=>1,now:()=>100,
    startTick(){},renderArena:()=>arenas++,openNextQuestion:()=>questions++,
    prefetchQuestion:()=>new Promise(resolve=>{release=()=>{context.state.pendingQuestion={id:'q'};resolve();};})};
  vm.runInNewContext(source.slice(start,end)+'\nthis.begin=beginActiveRaid;',context);
  const opening=context.begin(current);await flush();assert.equal(arenas,1);assert.equal(questions,0);
  release();await opening;assert.equal(questions,1);
});

test('battle waiting-query updates merge simultaneous hosts without waiting for a scan timer',async()=>{
  const source=read('public/cultivation/battle-mode-v2.js');
  const start=source.indexOf('  function watchWaitingRooms()'),end=source.indexOf('  function stopTimers()',start);
  let next, unsub=0;const writes=[],subscribed=[];
  const state={roomId:'zzroom',role:'host',room:{status:'waiting'},unsub:null,reconcileBusy:false};
  const own={status:'waiting',host:{uid:'a'}},other={status:'waiting',host:{uid:'b'},modeVersion:2};
  const ref={id:'aaroom'};
  const snapshot={docs:[{id:'aaroom',ref,data:()=>other}]};
  const context={state,ROOM_COLLECTION:'rooms',MATCH_SCAN_LIMIT:80,BATTLE_V2:{modeVersion:2},console,
    collection(){},query(){},where(){},limit(){},onSnapshot(_,fn){next=fn;return()=>unsub++;},
    playerSnapshot:()=>({uid:'a'}),isRoomStale:()=>false,roomRef:id=>({id}),db:()=>({}),
    getDocs(){throw Error('unexpected polling');},guestJoinPatch:()=>({guest:{uid:'a'},status:'intro'}),
    runTransaction:async(_,fn)=>fn({get:async target=>({exists:()=>true,data:()=>target.id==='zzroom'?own:other}),
      update:(target,patch)=>writes.push({id:target.id,patch}),delete:target=>writes.push({deleted:target.id})}),
    subscribeRoom:id=>subscribed.push(id),scheduleReconcile(){},logBattleFirestoreError(){}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.watch=watchWaitingRooms;',context);
  context.watch();next(snapshot);await flush();
  assert.deepEqual(subscribed,['aaroom']);assert.equal(state.role,'guest');assert.equal(writes.length,2);assert.equal(unsub,1);
});
