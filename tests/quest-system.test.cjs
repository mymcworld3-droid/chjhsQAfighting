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
  assert.equal(v.path.id, 'path-scope'); assert.equal(v.path.claimable, true);
  assert.equal(v.pathIndex, 0); assert.equal(v.daily.length, 6);
  assert.equal(v.daily.find(q => q.metric === 'solo').current, 0, 'lifetime answers are not today answers');
  assert.equal(rules.view(sample(), { pathIndex: rules.PATH.length }, date).path, null);
});

test('concurrent repeated path claims award exactly once and advance exactly one step', async () => {
  const db = fakeDb(sample());
  const r = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-scope' }, now)));
  assert.equal(r.filter(x => x.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, 50);
  assert.equal(db.docs.get('questStates/u1').pathIndex, 1);
  assert.equal(r.at(-1).quests.path.id, 'path-first-answer');
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now), /尚未完成/);
});

test('unfinished quests and forged reward values do not change balances or advance the chain', async () => {
  const user = sample(); user.gameSettings.focusedUnits = [];
  const db = fakeDb(user);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-scope', gold: 999999 }, now), /尚未完成/);
  assert.deepEqual(db.docs.get('users/u1'), user);
  assert.equal(db.docs.has('questStates/u1'), false);
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
  assert.equal(again.quests.pathIndex, 8);
  const tomorrow = new Date('2026-10-02T16:00:01Z');
  const fresh = await questTransaction(db, 'u1', null, tomorrow);
  assert.equal(fresh.quests.daily[0].current, 0); assert.equal(fresh.quests.daily[0].claimed, false);
  assert.equal(fresh.quests.pathIndex, 8);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date }, tomorrow), /跨日/);
  const remote = db.docs.get('users/u1');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  remote.questProgress = rules.recordEvent(remote.questProgress, 'solo', '2026-10-03');
  const next = await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date: '2026-10-03' }, tomorrow);
  assert.equal(next.awarded, true); assert.equal(next.balances.gold, 180);
});

test('realm locks prevent activity rewards before foundation; meditation uses its persisted date', async () => {
  const user = sample(); user.stats.totalScore = 9;
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
  db.docs.set('dongtianPlays/u1__cave1', { completed: true });
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
  assert.equal(res.code, 200); assert.equal(res.body.quests.path.id, 'path-scope');
});
