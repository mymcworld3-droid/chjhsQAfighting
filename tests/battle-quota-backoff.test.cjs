'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/cultivation/battle-mode-v2.js'), 'utf8');
const guardSource = fs.readFileSync(require.resolve('../public/cultivation/data/firestore-quota-guard.js'), 'utf8');
const { createFirestoreQuotaGuard } = vm.runInNewContext(guardSource.replace('export function', 'function') + '\n({createFirestoreQuotaGuard})');
const section = (a,b) => source.slice(source.indexOf(a), source.indexOf(b,source.indexOf(a)));
const quota = () => Object.assign(new Error('quota exceeded'), {code:'firestore/resource-exhausted'});

test('one quota failure blocks all operation types and concurrent failures share one cooldown', async () => {
  let now = 1000, calls = 0, notices = 0;
  const guard = createFirestoreQuotaGuard({now:()=>now,onExhausted:()=>notices++});
  const request = () => guard.run(async()=>{calls++;throw quota();});
  await Promise.allSettled([request(),request(),request()]);
  assert.equal(calls,3);assert.equal(notices,1);assert.equal(guard.retryAt(),61000);
  for(let i=0;i<100;i++) await assert.rejects(guard.run(()=>{calls++;}),{code:'resource-exhausted'});
  assert.equal(calls,3,'no underlying SDK calls while cooling down');
  now = 61000;await assert.rejects(request());assert.equal(guard.retryAt(),181000,'second failure backs off for two minutes');
  now = 181000;guard.success();await assert.rejects(request());assert.equal(guard.retryAt(),241000,'fresh server success resets backoff');
});

test('ordinary errors do not trip the quota gate and repeated exhaustion is capped at thirty minutes', async () => {
  let now=0;const guard=createFirestoreQuotaGuard({now:()=>now});
  await assert.rejects(guard.run(()=>{throw Object.assign(Error(),{code:'permission-denied'});}));
  assert.equal(guard.blocked(),false);
  for(let i=0;i<20;i++) {guard.failure(quota());assert.ok(guard.retryAt()-now<=1800000);now=guard.retryAt();}
  assert.equal(guard.retryAt(),now);
});

test('complete waiting snapshots avoid extra query reads, while full snapshots still paginate', async () => {
  let reads=0;
  const ctx={state:{matchSerial:1,waitingScanCursor:null},me:()=>({uid:'u'}),isMatchSessionActive:()=>true,
    getDocs:async()=>{reads++;return {docs:[]};},query:()=>({}),collection(){},db(){},where(){},limit(){},startAfter(){},
    ROOM_COLLECTION:'rooms',MATCH_SCAN_LIMIT:80,MATCH_SCAN_MAX_PAGES:4};
  vm.runInNewContext(section('  async function readWaitingRooms(', '  // 配對請求完成')+'\nthis.read=readWaitingRooms;',ctx);
  for(let i=0;i<30;i++) await ctx.read(()=>false,{docs:[{id:'own'}]});
  assert.equal(reads,0);
  await ctx.read(()=>false,{docs:Array.from({length:80},(_,i)=>({id:String(i)}))});assert.equal(reads,1);
});

test('slow heartbeat and lease-takeover requests cannot overlap on subsequent ticks', async () => {
  let writes=0,transactions=0,finishWrite,finishTx;
  const ctx={state:{roomId:'a',role:'host',room:{status:'playing'}},roomQuota:{blocked:()=>false},
    updateDoc:()=>{writes++;return new Promise(r=>{finishWrite=r;});},roomRef:()=>({}),nowMs:()=>1000,serverTimestamp:()=>1000,
    db:()=>({}),runTransaction:()=>{transactions++;return new Promise(r=>{finishTx=r;});},setTimeout:f=>{f();},me:()=>({uid:'me'}),questionLeaseExpired:()=>true};
  vm.runInNewContext(section('  async function heartbeat()', '  async function claimDisconnectedOpponent')+
    section('  async function takeoverQuestionLease(', '  async function advanceIntro(')+'\nthis.beat=heartbeat;this.take=takeoverQuestionLease;',ctx);
  const beat=ctx.beat();for(let i=0;i<100;i++) await ctx.beat();assert.equal(writes,1);finishWrite();await beat;
  const room={status:'preparing',questionOwnerUid:'other'};
  const lease=ctx.take(room);for(let i=0;i<100;i++) await ctx.take(room);assert.equal(transactions,1);finishTx();await lease;
});

test('waiting heartbeats update every twenty-four seconds while combat keeps its eight-second cadence', async () => {
  let now=100000,writes=0;
  const ctx={state:{roomId:'a',role:'host',room:{status:'waiting',host:{lastSeenAtMs:now}}},
    roomQuota:{blocked:()=>false},WAITING_HEARTBEAT_MS:24000,playerForRole:(room,role)=>room[role],
    updateDoc:async()=>{writes++;ctx.state.room.host.lastSeenAtMs=now;},
    roomRef:()=>({}),nowMs:()=>now,serverTimestamp:()=>now};
  vm.runInNewContext(section('  async function heartbeat()', '  async function claimDisconnectedOpponent')+'\nthis.beat=heartbeat;',ctx);
  for(let i=1;i<=9;i++){now=100000+i*8000;await ctx.beat();}
  assert.equal(writes,3,'nine waiting ticks require only three writes and their listener updates');
  ctx.state.room.status='playing';
  for(let i=0;i<3;i++){now+=8000;await ctx.beat();}
  assert.equal(writes,6,'active duel heartbeat remains unchanged');
});

test('quota reconnect ignores cached data, waits for server metadata, and cannot revive a cancelled room', () => {
  let now=1000,next,error,detaches=0;const timers=new Map();let id=0;
  const ctx={state:{roomId:'a',subscriptionSerial:0,matchSerial:1,role:'host',animationTimers:[]},
    HEARTBEAT_MS:8000,nowMs:()=>now,me:()=>({uid:'u'}),BATTLE_V2:{disconnectTtlMs:45000},roomRef:()=>({}),
    createFirestoreQuotaGuard,setText(){},toast(){},firebaseBattleErrorMessage:()=>'',logBattleFirestoreError(){},
    setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:i=>timers.delete(i),
    setInterval:()=>1,clearInterval(){},heartbeat(){},tickRoom(){},
    onSnapshot:(_,options,n,e)=>{assert.equal(options.includeMetadataChanges,true);next=n;error=e;return ()=>detaches++;},
    onRoomSnapshot:()=>{ctx.applied=(ctx.applied||0)+1;}};
  vm.runInNewContext('const roomQuota=createFirestoreQuotaGuard({now:nowMs,onExhausted:pauseForRoomQuota});'+
    section('  async function runRoomRequest(', '  function finite(')+
    section('  function detachRoomListener()', '  function stopTimers()')+
    section('  function subscribeRoom(', '  function storyOrTutorialOpen(')+'\nthis.sub=subscribeRoom;',ctx);
  ctx.sub('a');error(quota());assert.equal(ctx.state.syncPaused,true);assert.equal(detaches,1);assert.equal(timers.size,1);
  const retry=[...timers.values()][0];assert.equal(retry.ms,60000);now+=60000;retry.f();
  next({metadata:{fromCache:true}});assert.equal(ctx.applied,undefined);assert.equal(ctx.state.syncPaused,true);
  next({metadata:{fromCache:false,hasPendingWrites:true}});assert.equal(ctx.applied,undefined);
  next({metadata:{fromCache:false,hasPendingWrites:false}});assert.equal(ctx.applied,1);assert.equal(ctx.state.syncPaused,false);
  assert.equal(ctx.state.disconnectGraceUntilMs,now+45000);
  error(quota());const cancelled=[...timers.values()].at(-1);ctx.state.roomId=null;ctx.state.matchSerial++;cancelled.f();
  assert.equal(ctx.state.roomId,null);
});


test('paused battle ticks never settle, time out, or claim a disconnected opponent using old state', () => {
  let calls=0;
  const ctx={state:{roomId:'a',room:{status:'playing'},syncPaused:true},roomQuota:{blocked:()=>false},setText(){},
    document:{getElementById(){calls++;}},claimDisconnectedOpponent(){calls++;},settleRound(){calls++;}};
  vm.runInNewContext(section('  function tickRoom()', '  async function recordBattleResult(')+'\nthis.tick=tickRoom;',ctx);
  for(let i=0;i<100;i++) ctx.tick();assert.equal(calls,0);
});


function connectionHarness() {
  let next,error,id=0,detaches=0,requests=0,time=1000;
  const timers=new Map(),messages=[];
  const ctx={state:{roomId:'a',subscriptionSerial:0,matchSerial:1,role:'host',animationTimers:[]},
    HEARTBEAT_MS:8000,nowMs:()=>time,me:()=>({uid:'u'}),BATTLE_V2:{disconnectTtlMs:45000},roomRef:()=>({}),
    createFirestoreQuotaGuard,setText:(id,text)=>messages.push(text),toast(){},firebaseBattleErrorMessage:()=>'',logBattleFirestoreError(){},
    setTimeout:(f,ms)=>{timers.set(++id,{f,ms});return id;},clearTimeout:i=>timers.delete(i),
    setInterval:()=>1,clearInterval(){},heartbeat(){},tickRoom(){},
    onSnapshot:(_,options,n,e)=>{next=n;error=e;return ()=>detaches++;},
    onRoomSnapshot:()=>{ctx.applied=(ctx.applied||0)+1;}};
  vm.runInNewContext('const roomQuota=createFirestoreQuotaGuard({now:nowMs,onExhausted:pauseForRoomQuota});'+
    section('  async function runRoomRequest(', '  function finite(')+
    section('  function detachRoomListener()', '  function stopTimers()')+
    section('  function subscribeRoom(', '  function storyOrTutorialOpen(')+
    '\nthis.sub=subscribeRoom;this.request=runRoomRequest;',ctx);
  ctx.sub('a');
  return {ctx,timers,messages,snap:s=>next(s),fail:e=>error(e),get detaches(){return detaches;},
    request:()=>ctx.request(()=>{requests++;}),get requests(){return requests;},
    retry(){const [key,timer]=[...timers.entries()][0];timers.delete(key);time+=timer.ms;timer.f();return timer.ms;}};
}

test('an initial cached missing room does not eject the player, and cached updates pause an active battle', async () => {
  const h=connectionHarness();
  h.snap({metadata:{fromCache:true},exists:()=>false});
  assert.equal(h.ctx.applied,undefined);assert.equal(h.ctx.state.syncPauseReason,'offline');
  assert.equal(h.detaches,0,'keep the SDK listener alive for automatic reconnect');
  for(let i=0;i<30;i++) await assert.rejects(h.request(),{code:'unavailable'});
  assert.equal(h.requests,0);assert.equal(h.timers.size,0,'no parallel polling while SDK listener reconnects');
  h.snap({metadata:{fromCache:false,hasPendingWrites:false}});
  assert.equal(h.ctx.applied,1);assert.equal(h.ctx.state.syncPaused,false);
  await h.request();assert.equal(h.requests,1);
  h.snap({metadata:{fromCache:true}});assert.equal(h.ctx.applied,1);assert.equal(h.ctx.state.syncPaused,true);
});

test('terminated unavailable listeners retry with a short backoff, separate from quota cooldown', () => {
  const h=connectionHarness(),offline=()=>Object.assign(Error('network'),{code:'unavailable'});
  h.fail(offline());assert.equal(h.detaches,1);assert.equal(h.ctx.state.syncPauseReason,'offline');
  assert.equal(h.retry(),5000);h.fail(offline());assert.equal(h.retry(),10000);
  h.snap({metadata:{fromCache:false,hasPendingWrites:false}});assert.equal(h.ctx.state.connectionFailures,0);
  assert.equal(h.ctx.state.syncPaused,false);assert.equal(h.timers.size,0);
  h.fail(offline());assert.equal(h.retry(),5000,'server recovery resets network backoff');
});

test('unavailable RPCs pause the room and restart its listener; cancelled sessions cannot reconnect', async () => {
  const h=connectionHarness();h.snap({metadata:{fromCache:false,hasPendingWrites:false}});
  await assert.rejects(h.ctx.request(()=>{throw Object.assign(Error('network'),{code:'firestore/unavailable'});}),{code:'firestore/unavailable'});
  assert.equal(h.ctx.state.syncPauseReason,'offline');assert.equal(h.timers.size,1);
  const callback=[...h.timers.values()][0].f;
  h.ctx.state.roomId=null;h.ctx.state.matchSerial++;callback();assert.equal(h.ctx.state.roomId,null);
});
