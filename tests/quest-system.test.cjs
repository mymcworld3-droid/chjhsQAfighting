'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../public/cultivation/quest-rules.js');
const { questTransaction, createHandler } = require('../quest-api.cjs').__test;
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const now = new Date('2026-10-02T12:00:00Z'), date = rules.dateKey(now);

function fakeDb(user, state) {
  const docs = new Map([['users/u1', structuredClone(user)]]);
  if (state) docs.set('questStates/u1', structuredClone(state));
  let queue = Promise.resolve();
  function applyPatch(source, patch) {
    const data = structuredClone(source);
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'), leaf = parts.pop(); let target = data;
      for (const part of parts) target = target[part] ||= {};
      target[leaf] = value && value.__increment !== undefined ? (Number(target[leaf]) || 0) + value.__increment : structuredClone(value);
    }
    return data;
  }
  const snap = key => ({ exists: docs.has(key), data: () => structuredClone(docs.get(key)) });
  return { docs,
    collection(name) { return { doc(id) { return { key: `${name}/${id}`, get: async () => snap(`${name}/${id}`) }; } }; },
    runTransaction(worker) {
      const result = queue.then(async () => {
        let writing = false; const pending = new Map();
        const tx = {
          get: async ref => { assert.equal(writing, false, 'reads must precede writes'); return snap(ref.key); },
          update(ref, patch) { writing = true; assert.ok(docs.has(ref.key)); pending.set(ref.key, applyPatch(docs.get(ref.key), patch)); },
          set(ref, value) { writing = true; pending.set(ref.key, structuredClone(value)); },
          create(ref, value) { writing = true; assert.ok(!docs.has(ref.key)); pending.set(ref.key, structuredClone(value)); }
        };
        const value = await worker(tx);
        for (const [key, data] of pending) docs.set(key, data);
        return value;
      });
      queue = result.catch(() => {}); return result;
    }
  };
}
const sample = () => ({ uid: 'u1', stats: { gold: 20, totalScore: 28, totalCorrect: 10 }, gameSettings: { focusedUnits: [{ path: '數學', detail: '方程式' }] } });
const W = require('../public/cultivation/weapon-dungeon-rules.js');
const dungeonWallet = 'tacticalBattlePlayers/u1';
const seedTickets = (db, tickets = 0) => db.docs.set(dungeonWallet, {weaponDungeonV1:{tickets, grantDay:W.day(now.getTime())}});
const tickets = db => db.docs.get(dungeonWallet)?.weaponDungeonV1?.tickets;
const ticketQuests = rules.PATH.filter(q=>q.reward.weaponDungeonTicket);
const beforeQuest = id => ({ version: 2, pathClaimed: rules.PATH.slice(0, rules.PATH.findIndex(q => q.id === id)).map(q => q.id) });
const withBattleProgress = db => db.docs.set(dungeonWallet,{trial:{best:10,stage:11},weaponDungeonV1:{tickets:0,grantDay:W.day(now.getTime()),clears:[1]}});
test('new path excludes retired activities and only selected milestones award dungeon tickets', () => {
  assert.equal(rules.PATH.length,22);
  assert.ok(rules.PATH.every(q=>q.metric!=='raid'&&q.metric!=='dongtian'&&!Object.keys(q.reward.materials).length));
  assert.deepEqual(ticketQuests.map(q=>[q.id,q.reward.weaponDungeonTicket]),[
    ['path-foundation',1],['path-golden',1],['path-weapon-dungeon-first',2],['path-nascent',2],['path-solo-hundred',2]
  ]);
  assert.equal(rules.PATH.filter(q=>q.metric==='story'&&q.reward.weaponDungeonTicket).length,0);
  assert.ok(rules.DAILY.every(q=>!q.reward.weaponDungeonTicket));
});
test('complete new chain grants eight tickets, retains existing draw tickets and prevents replay', async()=>{
  const user=sample();user.stats.totalScore=3000;user.stats.totalCorrect=100;user.soulboundDrawTickets=7;
  user.questProgress={totals:{solo:100,meditation:1,battle:5,dongtian:1}};
  user.storyProgressV1={seen:Object.fromEntries(rules.PATH.filter(q=>q.chapterId).map(q=>[q.chapterId,true]))};
  const db=fakeDb(user);withBattleProgress(db);
  let total=0;
  for(const q of rules.PATH){
    const paid=await questTransaction(db,'u1',{kind:'path',id:q.id,weaponDungeonTicket:999},now);
    assert.equal(paid.awarded,true,q.id);
    total+=q.reward.weaponDungeonTicket||0;
    assert.equal(tickets(db),total);
    assert.equal((await questTransaction(db,'u1',{kind:'path',id:q.id},now)).awarded,false);
  }
  assert.equal(total,8);assert.equal(db.docs.get('users/u1').soulboundDrawTickets,7);
  const final=await questTransaction(db,'u1',null,now);
  assert.equal(final.quests.path,null);assert.equal(final.quests.pathCompleted,22);
  assert.deepEqual(final.quests.pathTicketRewards,[]);
});
test('concurrent milestone claims award exactly once',async()=>{
  const {fakeDb:inventoryDb}=require('./helpers/inventory-db.cjs');
  const db=inventoryDb(sample());db.docs.set('questStates/u1',beforeQuest('path-golden'));seedTickets(db);db.retryNextTransaction();
  const results=await Promise.all(Array.from({length:5},()=>questTransaction(db,'u1',{kind:'path',id:'path-golden'},now)));
  assert.equal(results.filter(r=>r.awarded).length,1);assert.equal(tickets(db),1);
  assert.equal(db.docs.get('users/u1').stats.gold,220);
});
test('old paid and retired IDs are preserved but not shown or re-awarded',async()=>{
  const state={version:2,pathClaimed:[...rules.LEGACY_PATH.map(q=>q.id),...rules.PATH.filter(q=>q.metric==='story').map(q=>q.id)],
    pathTicketsClaimed:['path-golden','path-raid-ten','path-nascent','path-solo-hundred'],
    pathTicketAmounts:{'path-golden':1,'path-raid-ten':5,'path-nascent':3,'path-solo-hundred':5}};
  const db=fakeDb(sample(),state);seedTickets(db);
  const first=await questTransaction(db,'u1',null,now);
  assert.equal(first.quests.path.id,'path-trial-first');
  assert.equal(first.quests.pathCompleted,18);
  assert.deepEqual(first.quests.pathTicketRewards.map(q=>[q.id,q.reward.weaponDungeonTicket]),[['path-foundation',1]]);
  assert.equal((await questTransaction(db,'u1',{kind:'path',id:'path-foundation'},now)).awarded,true);
  assert.equal(tickets(db),1);
  const stored=db.docs.get('questStates/u1');
  assert.ok(stored.pathClaimed.includes('path-raid-ten'));
  assert.equal(stored.pathTicketAmounts['path-raid-ten'],5);
  assert.equal(stored.pathTicketAmounts['path-nascent'],3);
  assert.deepEqual((await questTransaction(db,'u1',null,now)).quests.pathTicketRewards,[]);
  await assert.rejects(questTransaction(db,'u1',{kind:'path',id:'path-raid-ten'},now),/找不到/);
});
test('new battle objectives require server-owned clears, not client counters or merely opening the mode',async()=>{
  const user=sample();user.tacticalTrialV1={best:999};user.weaponDungeonV1={clears:[999]};
  const db=fakeDb(user,beforeQuest('path-trial-first'));
  await assert.rejects(questTransaction(db,'u1',{kind:'path',id:'path-trial-first'},now),/尚未完成/);
  withBattleProgress(db);
  assert.equal((await questTransaction(db,'u1',{kind:'path',id:'path-trial-first'},now)).awarded,true);
  db.docs.set('questStates/u1',beforeQuest('path-weapon-dungeon-first'));
  db.docs.set(dungeonWallet,{trial:{best:10},weaponDungeonV1:{tickets:3,grantDay:W.day(now.getTime()),clears:[0]}});
  await assert.rejects(questTransaction(db,'u1',{kind:'path',id:'path-weapon-dungeon-first'},now),/尚未完成/);
  withBattleProgress(db);
  assert.equal((await questTransaction(db,'u1',{kind:'path',id:'path-weapon-dungeon-first'},now)).awarded,true);
  assert.equal(tickets(db),2);
});
test('failed dungeon ticket deposits roll back the quest claim; spent tickets cannot be reclaimed', async () => {
  const { fakeDb: inventoryDb } = require('./helpers/inventory-db.cjs');
  const db = inventoryDb(sample()); const state = beforeQuest('path-golden'); db.docs.set('questStates/u1', state);
  seedTickets(db);
  const run = db.runTransaction;
  db.runTransaction = worker => run(tx => worker({ ...tx, set() { throw Error('database unavailable'); } }));
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now), /database unavailable/);
  assert.equal(tickets(db), 0);
  assert.equal(db.docs.get('users/u1').stats.gold, 20); assert.deepEqual(db.docs.get('questStates/u1'), state);
  db.runTransaction = run;
  await questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now);
  assert.equal(tickets(db),1);
  seedTickets(db);
  const replay = await questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now);
  assert.equal(replay.awarded,false); assert.equal(replay.weaponDungeonTickets,0);
});

test('unfinished and out-of-order ticket quests cannot be claimed with caller-selected ticket amounts', async () => {
  const user = sample(); user.stats.totalScore = 27;
  const db = fakeDb(user, beforeQuest('path-golden'));
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden', weaponDungeonTicket: 999 }, now), /尚未完成/);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-nascent', weaponDungeonTicket: 999 }, now), /尚未完成/);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, undefined);
  assert.equal(tickets(db),undefined);
});




test('quest dates use Taiwan midnight, while totals survive daily resets', () => {
  assert.equal(rules.dateKey(new Date('2026-10-02T15:59:59Z')), '2026-10-02');
  assert.equal(rules.dateKey(new Date('2026-10-02T16:00:00Z')), '2026-10-03');
  let p = rules.recordEvent(null, 'solo', '2026-10-02');
  p = rules.recordEvent(p, 'solo', '2026-10-03');
  assert.equal(p.totals.solo, 2); assert.equal(p.daily.counts.solo, 1);
  assert.equal(rules.normalizeProgress(p, '2026-10-04').daily.counts.solo, 0);
  assert.throws(() => rules.recordEvent(p, 'forged'), /Unknown/);
});

test('only the current path quest is exposed; existing achievements do not auto-claim', () => {
  const v = rules.view(sample(), {}, date);
  assert.equal(v.path.id, 'path-story-prologue-enter-sect'); assert.equal(v.path.claimable, false);
  assert.equal(v.pathIndex, 0); assert.equal(v.daily.length, 4);
  assert.equal(v.daily.find(q => q.metric === 'solo').current, 0, 'lifetime answers are not today answers');
  assert.equal(rules.view(sample(), { version: 2, pathClaimed: rules.PATH.map(q => q.id) }, date).path, null);
});

test('retired raid objectives never appear in the new path even for old raid winners',async()=>{
  const user=sample();user.questProgress={totals:{raid:10}};
  const db=fakeDb(user,beforeQuest('path-nascent'));withBattleProgress(db);
  const next=await questTransaction(db,'u1',null,now);
  assert.equal(next.quests.path.id,'path-nascent');
  assert.equal(next.quests.pathTotal,rules.PATH.length);
  assert(next.quests.pathRows.every(q=>q.metric!=='raid'));
});

test('concurrent repeated path claims award exactly once and advance exactly one step', async () => {
  const db = fakeDb(sample(), { version: 2, pathClaimed: ['path-story-prologue-enter-sect'] });
  const r = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-scope' }, now)));
  assert.equal(r.filter(x => x.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, 50);
  assert.equal(db.docs.get('questStates/u1').pathIndex, 2);
  assert.equal(r.at(-1).quests.path.id, 'path-first-answer');
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now), /尚未完成/);
});

test('unfinished quests and forged reward values do not change balances or advance the chain', async () => {
  const user = sample(); user.gameSettings.focusedUnits = [];
  const state = { version: 2, pathClaimed: ['path-story-prologue-enter-sect'] };
  const db = fakeDb(user, state);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-scope', gold: 999999 }, now), /尚未完成/);
  assert.deepEqual(db.docs.get('users/u1'), user);
  assert.deepEqual(db.docs.get('questStates/u1'), state);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'wrong', id: 'path-scope' }, now), /類型/);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'daily', id: 'invented', date }, now), /找不到/);
});

test('daily rewards are independent, idempotent, and reset without resetting the path', async () => {
  const user = sample(); let p;
  for (let i = 0; i < 10; i++) p = rules.recordEvent(p, 'solo', date);
  user.questProgress = p;
  const db = fakeDb(user, { pathIndex: 8, dailyDate: date, dailyClaimed: [] });
  const a = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date }, now);
  const b = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-ten', date }, now);
  const again = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date }, now);
  assert.equal(a.awarded, true); assert.equal(b.awarded, true); assert.equal(again.awarded, false);
  assert.equal(again.balances.gold, 140); assert.equal(again.balances.totalScore, 30);
  assert.equal(again.quests.pathCompleted, 7);
  const tomorrow = new Date('2026-10-02T16:00:01Z');
  const fresh = await questTransaction(db, 'u1', null, tomorrow);
  assert.equal(fresh.quests.daily[0].current, 0); assert.equal(fresh.quests.daily[0].claimed, false);
  assert.equal(fresh.quests.pathCompleted, 7);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date }, tomorrow), /跨日/);
  const remote = db.docs.get('users/u1');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  const next = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date: '2026-10-03' }, tomorrow);
  assert.equal(next.awarded, true); assert.equal(next.balances.gold, 180);
});

test('realm locks prevent activity rewards before foundation; meditation uses its persisted date', async () => {
  const user = sample(); user.stats.totalScore = 5;
  user.questProgress = rules.recordEvent(null, 'battle', date);
  user.dailyMeditation = { lastDate: date, totalDays: 1 };
  const v = rules.view(user, {}, date);
  assert.equal(v.daily.find(q => q.id === 'daily-battle').claimable, false);
  assert.equal(v.daily.find(q => q.id === 'daily-meditation').claimable, true);
  await assert.rejects(questTransaction(fakeDb(user), 'u1', { kind: 'daily', id: 'daily-battle', date }, now), /尚未完成/);
});

test('raid quest deposits stamps without overwriting other inventory', async () => {
  const user = sample(); user.questProgress = rules.recordEvent(null, 'raid', date);
  user.materialSystem = { inventory: { 'qi-spirit-iron': 5, 'raid-refine-key-ii': 2 }, equipped: 'unchanged' };
  const db = fakeDb(user);
  const r = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-raid', date }, now);
  assert.equal(r.awarded, true); assert.equal(r.materials['raid-refine-key-ii'], 3);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['qi-spirit-iron'], 5);
  assert.equal(db.docs.get('users/u1').materialSystem.equipped, 'unchanged');
});

test('existing battle, raid, and cave settlements record activities only on first claim', async () => {
  const battle = require('../battle-reward-api.cjs').__test;
  const cave = require('../dongtian-settlement-api.cjs').__test;
  const raid = require('../raid-reward-api.cjs').__test;
  const db = fakeDb(sample());
  const fieldValue = { serverTimestamp: () => 1, increment: n => ({ __increment: n }) };
  // The Firebase FieldValue implementation is used by battle and cave and can
  // be recognized by the fake patcher without changing production code.
  await battle.awardBattle(db, 'u1', 'room_12345678', { outcome: 'draw', gold: 0, cultivation: 0, role: 'host' });
  await battle.awardBattle(db, 'u1', 'room_12345678', { outcome: 'draw', gold: 0, cultivation: 0, role: 'host' });
  assert.equal(db.docs.get('users/u1').questProgress.totals.battle, 1);
  const won = { finishedAtMs: now.getTime(), partySize: 1, totalDamage: 100, bossMaxHp: 100 };
  await raid.awardRaidReward(db, 'u1', 'raid_12345678', won, { fieldValue });
  await raid.awardRaidReward(db, 'u1', 'raid_12345678', won, { fieldValue });
  assert.equal(db.docs.get('users/u1').questProgress.totals.raid, 1);
  // Replayed cave completion: no currency/spirit update, but a new receipt
  // counts this finished run exactly once.
  db.docs.set('dongtianPlays/u1__cave1', { completed: true, learningRewardV2:{version:2,masteredKeys:[],creditedCorrect:0,goldPaid:30,soulClaimed:false,ownerRewardClaimed:true} });
  const u = db.docs.get('users/u1'); u.stats.totalScore = 10;
  const e = { id: 'eligible1', dongtianId: 'cave1', runId: 'run1', ownerUid: 'u1', correct: 0, total: 1 };
  await cave.awardProgress(db, 'u1', e); await cave.awardProgress(db, 'u1', e);
  assert.equal(db.docs.get('users/u1').questProgress.totals.dongtian, 1);
});

test('quest endpoint rejects absent or wrong-project authentication and takes UID only from token', async () => {
  const db = fakeDb(sample());
  function response() { return { code: 200, set() {}, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; } }; }
  let token = { uid: 'u1', aud: 'wrong', iss: '' };
  const handler = createHandler({ resolveA: () => ({ db, auth: { verifyIdToken: async () => token } }), now: () => now });
  let res = response(); await handler({ get: () => '' }, res); assert.equal(res.code, 401);
  res = response(); await handler({ get: () => 'Bearer token' }, res); assert.equal(res.code, 401);
  token = { uid: 'u1', aud: PROJECT_IDS.A, iss: 'https://securetoken.google.com/' + PROJECT_IDS.A };
  res = response(); await handler({ get: () => 'Bearer token', body: { uid: 'someone-else' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.quests.path.id, 'path-story-prologue-enter-sect');
});

test('every chapter has one viewing quest with the same unlock threshold as the real script', async () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../public/cultivation/story/story-scripts.js'), 'utf8');
  const { STORY_CHAPTERS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const watching = rules.PATH.filter(q => q.metric === 'story');
  assert.equal(watching.length, STORY_CHAPTERS.length);
  assert.equal(new Set(rules.PATH.map(q => q.id)).size, rules.PATH.length);
  for (const chapter of STORY_CHAPTERS) {
    const tasks = watching.filter(q => q.chapterId === chapter.id);
    assert.equal(tasks.length, 1, chapter.id);
    assert.equal(tasks[0].minScore, chapter.minScore);
    assert.equal(tasks[0].reward.cultivation, 0);
  }
});

test('opening a chapter does not satisfy its quest; completing and claiming it awards only once', async () => {
  const user = sample();
  user.storyProgressV1 = { seen: { 'prologue-enter-sect': { openedAtMs: now.getTime() } } };
  const db = fakeDb(user);
  const id = 'path-story-prologue-enter-sect';
  assert.equal(rules.view(user, {}, date).path.current, 0);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id }, now), /尚未完成/);
  assert.equal(db.docs.get('users/u1').stats.gold, 20);
  db.docs.get('users/u1').storyProgressV1.seen['prologue-enter-sect'].completedAtMs = now.getTime();
  const results = await Promise.all(Array.from({ length: 6 }, () => questTransaction(db, 'u1', { kind: 'path', id }, now)));
  assert.equal(results.filter(r => r.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, 50);
  assert.equal(db.docs.get('users/u1').stats.totalScore, 28);
  assert.equal(results.at(-1).quests.path.id, 'path-scope');
  assert.equal(results.at(-1).quests.pathCompleted, 1);
});

test('legacy path indices retain claimed rewards while inserted story quests remain available', async () => {
  const user = sample();
  user.storyProgressV1 = { seen: { 'prologue-enter-sect': true, 'qi-one-ask-dao': { completedAtMs: 1 } } };
  const legacy = { pathIndex: 8, dailyDate: date, dailyClaimed: ['daily-solo-three'] };
  const db = fakeDb(user, legacy);
  const before = await questTransaction(db, 'u1', null, now);
  assert.equal(before.quests.pathCompleted, 7);
  assert.equal(before.quests.path.id, 'path-story-prologue-enter-sect');
  assert.equal(before.quests.daily.find(q => q.id === 'daily-solo-three').claimed, true);
  const first = await questTransaction(db, 'u1', { kind: 'path', id: before.quests.path.id }, now);
  assert.equal(first.awarded, true);
  assert.equal(first.quests.path.id, 'path-story-qi-five-dongtian', 'already claimed original tasks are skipped');
  assert.equal(first.quests.pathCompleted, 8);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-cave' }, now), /找不到/);
  assert.equal(db.docs.get('users/u1').stats.gold, 50);
  const stored = db.docs.get('questStates/u1');
  assert.equal(stored.version, 2);
  for (const q of rules.LEGACY_PATH.slice(0, 8)) assert.ok(stored.pathClaimed.includes(q.id));
  assert.equal(rules.view(user, { pathIndex: 21 }, date).pathCompleted, 16);
  assert.equal(rules.view(user, { pathIndex: 21 }, date).path.id, 'path-story-prologue-enter-sect');
});

test('saved previews below a chapter threshold cannot earn viewing rewards', async () => {
  const id = 'path-story-qi-five-dongtian';
  const index = rules.PATH.findIndex(q => q.id === id);
  const user = sample();
  user.stats.totalScore = 4;
  user.storyProgressV1 = { seen: { 'qi-five-dongtian': { completedAtMs: 1 } } };
  const state = { version: 2, pathClaimed: rules.PATH.slice(0, index).map(q => q.id) };
  const db = fakeDb(user, state);
  const q = rules.view(user, state, date).path;
  assert.equal(q.complete, true);
  assert.equal(q.locked, true);
  assert.equal(q.claimable, false);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id }, now), /尚未完成/);
  db.docs.get('users/u1').stats.totalScore = 5;
  const earned = await questTransaction(db, 'u1', { kind: 'path', id }, now);
  assert.equal(earned.awarded, true);
  assert.equal(earned.balances.totalScore, 5);
});

 test('optional Dongtian activity never appears as an active quest or grants quest rewards',async()=>{
 const user=sample();user.questProgress=rules.recordEvent({},'dongtian',date);
 const db=fakeDb(user,{pathClaimed:['path-cave']});
 const v=await questTransaction(db,'u1',null,now);
 for(const q of [...v.quests.pathRows,...v.quests.daily,...v.quests.weekly,...v.quests.commissions])assert.notEqual(q.metric,'dongtian');
 await assert.rejects(questTransaction(db,'u1',{kind:'daily',id:'daily-dongtian',date},now),/找不到/);
 assert.equal(db.docs.get('users/u1').stats.gold,20);
 assert.ok(db.docs.get('questStates/u1').pathClaimed.includes('path-cave'));
});
