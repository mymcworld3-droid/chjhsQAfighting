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

test('the independent Dongtian tutorial quest follows the mid-Qi story and preserves all existing quest IDs', () => {
  const index = rules.PATH.findIndex(q => q.id === 'path-qi-five');
  assert.deepEqual(rules.PATH.slice(index, index + 4).map(q => q.id),
    ['path-qi-five', 'path-story-qi-five-dongtian', 'path-dongtian-tutorial', 'path-meditation']);
  assert.equal(rules.PATH.length, 37);
  const oldClaimed = rules.PATH.filter(q => q.id !== 'path-dongtian-tutorial').map(q => q.id);
  const migrated = rules.normalizeState({ version: 2, pathClaimed: oldClaimed }, date);
  assert.deepEqual(migrated.pathClaimed, oldClaimed);
  assert.equal(rules.view(sample(), migrated, date).path.id, 'path-dongtian-tutorial');
  assert.equal(rules.view(sample(), migrated, date).pathCompleted, 36);
});

test('watching the dream, starting a lesson, skipping, and completing formal caves cannot finish the lesson quest', () => {
  const index = rules.PATH.findIndex(q => q.id === 'path-dongtian-tutorial');
  const state = { version: 2, pathClaimed: rules.PATH.slice(0, index).map(q => q.id) };
  const user = sample();
  user.storyProgressV1 = { seen: { 'qi-five-dongtian': { completedAtMs: 1 } } };
  user.questProgress = { totals: { dongtian: 10 } };
  for (const marker of [undefined, { started: true }, { completed: false }, { completed: true, skipped: true }]) {
    user.storyDongtianTutorialV1 = marker;
    assert.equal(rules.view(user, state, date).path.claimable, false);
  }
  user.storyDongtianTutorialV1 = { completed: true, skipped: false };
  assert.equal(rules.view(user, state, date).path.claimable, true);
  user.storyDongtianTutorialV1 = { completed: true, skipped: true };
  user.qiFiveDongtianTutorialV1 = { completed: true, played: true, deleted: false };
  assert.equal(rules.view(user, state, date).path.claimable, false);
  user.qiFiveDongtianTutorialV1.deleted = true;
  assert.equal(rules.view(user, state, date).path.claimable, true, 'a fully completed legacy lesson counts');
});

test('a saved lesson grants only its fixed gold reward once and never counts as a formal cave', async () => {
  const index = rules.PATH.findIndex(q => q.id === 'path-dongtian-tutorial');
  const state = { version: 2, pathClaimed: rules.PATH.slice(0, index).map(q => q.id) };
  const user = sample();
  user.storyDongtianTutorialV1 = { completed: true, skipped: false };
  const db = fakeDb(user, state);
  const claims = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-dongtian-tutorial' }, now)));
  assert.equal(claims.filter(r => r.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, user.stats.gold + 50);
  assert.equal(db.docs.get('users/u1').stats.totalScore, user.stats.totalScore);
  assert.equal(db.docs.get('users/u1').questProgress, undefined);
  assert.equal(claims.at(-1).quests.path.id, 'path-meditation');
  user.stats.totalScore = 4;
  await assert.rejects(questTransaction(fakeDb(user, state), 'u1', { kind: 'path', id: 'path-dongtian-tutorial' }, now), /尚未完成/);
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
  assert.equal(v.pathIndex, 0); assert.equal(v.daily.length, 6);
  assert.equal(v.daily.find(q => q.metric === 'solo').current, 0, 'lifetime answers are not today answers');
  assert.equal(rules.view(sample(), { version: 2, pathClaimed: rules.PATH.map(q => q.id) }, date).path, null);
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
  assert.equal(again.quests.pathCompleted, 8);
  const tomorrow = new Date('2026-10-02T16:00:01Z');
  const fresh = await questTransaction(db, 'u1', null, tomorrow);
  assert.equal(fresh.quests.daily[0].current, 0); assert.equal(fresh.quests.daily[0].claimed, false);
  assert.equal(fresh.quests.pathCompleted, 8);
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
  assert.equal(before.quests.pathCompleted, 8);
  assert.equal(before.quests.path.id, 'path-story-prologue-enter-sect');
  assert.equal(before.quests.daily.find(q => q.id === 'daily-solo-three').claimed, true);
  const first = await questTransaction(db, 'u1', { kind: 'path', id: before.quests.path.id }, now);
  assert.equal(first.awarded, true);
  assert.equal(first.quests.path.id, 'path-story-qi-one-ask-dao', 'already claimed original tasks are skipped');
  assert.equal(first.quests.pathCompleted, 9);
  const duplicate = await questTransaction(db, 'u1', { kind: 'path', id: 'path-cave' }, now);
  assert.equal(duplicate.awarded, false, 'a previously claimed task after the current index must remain paid');
  assert.equal(duplicate.balances.gold, 50);
  const stored = db.docs.get('questStates/u1');
  assert.equal(stored.version, 2);
  for (const q of rules.LEGACY_PATH.slice(0, 8)) assert.ok(stored.pathClaimed.includes(q.id));
  assert.equal(rules.view(user, { pathIndex: 21 }, date).pathCompleted, 21);
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
