const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceRaidClock, advanceRaidRoom, startRaidScheduler } = require('../raid-clock.cjs');
const { createRaidBoss } = require('../raid-authority.cjs');

const START = 100000;
function member(uid, extra = {}) {
  return { uid, host: uid === 'a', joinedAtMs: START, heartbeatAtMs: START,
    online: true, ready: true, alive: true, hp: 1000, maxHp: 1000, atk: 200,
    damage: 0, lastBossActionSeen: 0, artifactShield: 0, coreShield: false,
    artifactBattle: {version: 1, effects: []}, ...extra };
}
function room(extra = {}) {
  return {status: 'active', hostUid: 'a', createdAtMs: START, startedAtMs: START,
    bossHp: 1800, bossMaxHp: 1800, bossBaseAttack: 70, bossActionCount: 0,
    members: {a: member('a'), b: member('b')}, ...extra};
}

test('no early hit; scheduled hit settles every member without browser acknowledgement', () => {
  const original = room({serverDrivenBoss: true});
  assert.equal(advanceRaidClock(original, 'room-test', START + 17999), null);
  const next = advanceRaidClock(original, 'room-test', START + 18000);
  assert.equal(next.bossActionCount, 1);
  assert.equal(next.lastBossAction.issuedAtMs, START + 18000);
  for (const player of Object.values(next.members)) {
    assert.equal(player.hp, 936);
    assert.equal(player.lastBossActionSeen, 1);
    assert.equal(player.lastBossResolution.damage, 64);
  }
  assert.equal(original.members.a.hp, 1000, 'pure transition must not mutate input');
  assert.equal(advanceRaidClock(next, 'room-test', START + 18000), null, 'duplicate tick cannot hit twice');
});


test('two unique teammates weaken the next Boss strike and the cooperation window resets', () => {
  const next = advanceRaidClock(room({
    teamCycle: 1,
    teamCorrectUids: ['a','b'],
    teamGuardReady: true,
    teamBurstTriggered: false
  }), 'room-test', START + 18000);
  assert.equal(next.lastBossAction.rawDamage, 64);
  assert.equal(next.lastBossAction.damage, 35);
  assert.equal(next.lastBossAction.teamGuarded, true);
  assert.deepEqual(next.lastBossAction.teamContributors, ['a','b']);
  assert.equal(next.members.a.hp, 965);
  assert.equal(next.members.b.hp, 965);
  assert.equal(next.members.a.lastBossResolution.teamGuarded, true);
  assert.equal(next.teamCycle, 2);
  assert.deepEqual(next.teamCorrectUids, []);
  assert.equal(next.teamGuardReady, false);
  assert.equal(next.teamBurstTriggered, false);
});

test('server restart catches up missed rounds at absolute scheduled timestamps', () => {
  const next = advanceRaidClock(room(), 'room-test', START + 37000);
  assert.equal(next.bossActionCount, 2);
  assert.equal(next.lastBossAction.issuedAtMs, START + 36000);
  assert.equal(next.members.a.hp, 872);
});

test('expired host is replaced, expired player forfeits and cannot block all-team defeat', () => {
  const initial = room({members:{a: member('a'), b: member('b', {heartbeatAtMs: START + 30000})}});
  const next = advanceRaidClock(initial, 'room-test', START + 46000);
  assert.equal(next.hostUid, 'b');
  assert.equal(next.members.a.host, false);
  assert.equal(next.members.b.host, true);
  assert.equal(next.members.a.alive, false);
  assert.equal(next.members.a.hp, 0);
  assert.equal(next.members.a.forfeitReason, 'connection-timeout');
  assert.equal(next.status, 'active');
  const lost = advanceRaidClock(next, 'room-test', START + 76000);
  assert.equal(lost.status, 'lost');
});

test('disconnect grace allows survival before 45 seconds and expires without a client', () => {
  const next = advanceRaidClock(room(), 'room-test', START + 44000);
  assert.equal(next.status, 'active');
  assert.equal(next.members.a.alive, true);
  assert.equal(advanceRaidClock(next, 'room-test', START + 45001).status, 'lost');
});

test('waiting room transfers captain and closes when everyone expires', () => {
  const initial = room({status:'waiting', members:{a: member('a'), b: member('b', {heartbeatAtMs: START + 30000})}});
  const next = advanceRaidClock(initial, 'room-test', START + 46000);
  assert.equal(next.hostUid, 'b');
  assert.equal(next.status, 'waiting');
  assert.equal(advanceRaidClock(next, 'room-test', START + 76000).status, 'closed');
});

test('leaving explicitly forfeits immediately rather than leaving a living ghost', () => {
  const next = advanceRaidClock(room({members:{a:member('a',{online:false})}}), 'room-test', START + 1000);
  assert.equal(next.status, 'lost');
  assert.equal(next.members.a.alive, false);
});

test('death, one-use shield and reflection use trusted combat effects for the whole team', () => {
  const next = advanceRaidClock(room({bossHp:20, members:{
    a:member('a',{hp:30, artifactBattle:{version:1,effects:[{type:'equip_reflect_percent',value:1}]} }),
    b:member('b',{coreShield:true})
  }}), 'room-test', START + 18000);
  assert.equal(next.status, 'won');
  assert.equal(next.bossHp, 0);
  assert.equal(next.members.a.hp, 0);
  assert.equal(next.members.a.alive, false);
  assert.ok(next.members.a.damage >= 20);
  assert.equal(next.members.b.hp, 1000);
  assert.equal(next.members.b.coreShield, false);
  assert.equal(next.members.b.lastBossResolution.guarded, true);
  assert.equal(next.members.a.lastBossResolution.bossHp, 0);
});

test('all players dying produces a terminal loss with no further scheduled attacks', () => {
  const next = advanceRaidClock(room({members:{a:member('a',{hp:1}),b:member('b',{hp:1})}}), 'room-test', START + 18000);
  assert.equal(next.status, 'lost');
  assert.equal(advanceRaidClock(next, 'room-test', START + 36000), null);
});

test('Boss stats are fixed for the three-person benchmark', () => {
  const boss = createRaidBoss([member('a'), member('b')]);
  assert.equal(boss.maxHp, 4800);
});

function dbFor(initial) {
  let value = structuredClone(initial), chain = Promise.resolve(), writes = 0;
  const ref = {id:'room-test'};
  return {ref, read:()=>value, writes:()=>writes,
    runTransaction(fn) {
      const job = chain.then(() => fn({get:async()=>({exists:true,data:()=>structuredClone(value)}),
        update(_ref, next) {value = structuredClone(next); writes++;}}));
      chain = job.catch(()=>{}); return job;
    }};
}
test('concurrent server ticks serialize through transactions and settle once', async () => {
  const db = dbFor(room());
  await Promise.all([advanceRaidRoom(db, db.ref, START+18000),advanceRaidRoom(db, db.ref, START+18000)]);
  assert.equal(db.read().bossActionCount, 1);
  assert.equal(db.read().members.a.hp, 936);
  assert.equal(db.writes(), 1);
});

test('background scheduler reuses one live query and stops without further reads', async () => {
  let callback, next, watches = 0, cleared = false, cancelled = 0;
  const errors = [];
  const db = {collection:()=>({where:()=>({onSnapshot(fn){
    watches++; next=fn; fn({docs:[]}); return ()=>cancelled++;
  }})})};
  const scheduler = startRaidScheduler({resolveDb:()=>db, logger:{error:(...args)=>errors.push(args)},
    setIntervalFn(fn){callback=fn;return{unref(){}};},clearIntervalFn(){cleared=true;}});
  for (let i=0;i<60;i++) await scheduler.tick();
  assert.equal(watches, 1);
  scheduler.stop(); callback(); await scheduler.tick();
  next({docs:[{data(){throw Error('late callbacks must be ignored');}}]});
  assert.equal(cleared, true); assert.equal(watches, 1); assert.equal(cancelled,1); assert.deepEqual(errors, []);
});

test('a failed room does not prevent a different room from settling', async () => {
  const good = dbFor(room());
  const failedRef = {id:'broken'};
  const errors = [];
  const db = {runTransaction:fn=>good.runTransaction(tx=>fn({
    ...tx, get:ref=>ref.id==='broken'?Promise.reject(new Error('broken room')):tx.get(ref)
  })), collection:()=>({where:()=>({onSnapshot(next){
    next({docs:[failedRef,good.ref].map(ref=>({id:ref.id,ref,data:()=>structuredClone(good.read())}))});return()=>{};
  }})})};
  // Keep the fake room near current time so scheduler time is deterministic.
  const started = Date.now()-18001;
  Object.assign(good.read(), {startedAtMs:started});
  for (const member of Object.values(good.read().members)) member.heartbeatAtMs=Date.now();
  const scheduler = startRaidScheduler({resolveDb:()=>db, logger:{error:(...args)=>errors.push(args)},
    setIntervalFn(){return{unref(){}};},clearIntervalFn(){}});
  await new Promise(resolve=>setImmediate(resolve));
  scheduler.stop();
  assert.equal(good.read().bossActionCount, 1);
  assert.equal(good.read().members.a.hp, 936);
  assert.equal(errors.length, 1);
});

function schedulerFixture(initial = room({serverDrivenBoss:true})) {
  const data = dbFor(initial), errors = [];
  let at = START, next, failure, watches = 0, reads = 0, cancelled = 0;
  const db = {runTransaction(fn){reads++;return data.runTransaction(fn);},
    collection:()=>({where:()=>({onSnapshot(n,e){next=n;failure=e;watches++;return()=>cancelled++;}})})};
  const scheduler = startRaidScheduler({resolveDb:()=>db,now:()=>at,logger:{error:(...args)=>errors.push(args)},
    setIntervalFn(){return{unref(){}};},clearIntervalFn(){}});
  return {...scheduler, data, errors, time:value=>{at=value;},
    emit(value=data.read()){next({docs:value?[{id:data.ref.id,ref:data.ref,data:()=>structuredClone(value)}]:[]});},
    fail:error=>failure(error),counts:()=>({reads,watches,cancelled})};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));

test('idle ticks make zero reads; due Boss action revalidates once and does not repeat', async () => {
  const f=schedulerFixture(); f.emit(); await flush();
  for(let i=1;i<18;i++){f.time(START+i*1000);await f.tick();}
  assert.equal(f.counts().reads,0);
  f.time(START+18000); await f.tick();
  assert.equal(f.data.read().bossActionCount,1);assert.equal(f.counts().reads,1);
  await f.tick();assert.equal(f.counts().reads,1,'transaction result advances the local schedule before the next push');
  f.emit(null);f.time(START+36000);await f.tick();assert.equal(f.counts().reads,1,'removed rooms are not scheduled');
  f.stop();
});

test('a stale schedule cannot expire a member whose heartbeat was refreshed on the server', async () => {
  const f=schedulerFixture(room({status:'waiting',serverDrivenBoss:true}));f.emit();await flush();
  for(const m of Object.values(f.data.read().members))m.heartbeatAtMs=START+30000;
  f.time(START+46000);await f.tick();
  assert.equal(f.data.read().status,'waiting');assert.equal(f.data.read().members.a.online,true);
  assert.equal(f.data.writes(),0);assert.equal(f.counts().reads,1);
  await f.tick();assert.equal(f.counts().reads,1);
  f.stop();
});

test('quota errors discard stale room schedules and back off query reconnection', async () => {
  const f=schedulerFixture();f.emit();await flush();
  f.fail(Object.assign(Error('Quota exceeded'),{code:8}));
  for(let i=1;i<60;i++){f.time(START+i*1000);await f.tick();}
  assert.deepEqual(f.counts(),{reads:0,watches:1,cancelled:1});
  f.time(START+60000);await f.tick();assert.equal(f.counts().watches,2);
  f.fail(Object.assign(Error('Quota exceeded'),{code:8}));
  f.time(START+179999);await f.tick();assert.equal(f.counts().watches,2);
  f.time(START+180000);await f.tick();assert.equal(f.counts().watches,3);
  f.stop();
});
