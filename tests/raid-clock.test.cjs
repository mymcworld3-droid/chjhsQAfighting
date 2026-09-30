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

test('background scheduler stops without overlapping scans', async () => {
  let callback, release, scans = 0, cleared = false;
  const errors = [];
  const db = {collection:()=>({where:()=>({get:async()=>{
    scans++; await new Promise(resolve=>{release=resolve;}); return {docs:[]};
  }})})};
  const scheduler = startRaidScheduler({resolveDb:()=>db, logger:{error:(...args)=>errors.push(args)},
    setIntervalFn(fn){callback=fn;return{unref(){}};},clearIntervalFn(){cleared=true;}});
  await Promise.resolve();
  await scheduler.tick();
  assert.equal(scans, 1);
  release(); await new Promise(resolve=>setImmediate(resolve));
  scheduler.stop(); callback(); await scheduler.tick();
  assert.equal(cleared, true); assert.equal(scans, 1); assert.deepEqual(errors, []);
});

test('a failed room does not prevent a different room from settling', async () => {
  const good = dbFor(room());
  const failedRef = {id:'broken'};
  const errors = [];
  const db = {runTransaction:fn=>good.runTransaction(tx=>fn({
    ...tx, get:ref=>ref.id==='broken'?Promise.reject(new Error('broken room')):tx.get(ref)
  })), collection:()=>({where:()=>({get:async()=>({docs:[{ref:failedRef},{ref:good.ref}]})})})};
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
