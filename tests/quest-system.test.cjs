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
const legacyTicketQuestIds = ['path-golden', 'path-raid-one', 'path-nascent', 'path-raid-ten', 'path-solo-hundred'];
const beforeQuest = id => ({ version: 2, pathClaimed: rules.PATH.slice(0, rules.PATH.findIndex(q => q.id === id)).map(q => q.id) });

test('every path quest including stories and tutorials grants one to five tickets', () => {
  const quests = rules.PATH.filter(q => q.reward.drawTickets);
  assert.equal(quests.length, rules.PATH.length);
  assert.deepEqual(quests.filter(q => legacyTicketQuestIds.includes(q.id)).map(q => q.reward.drawTickets), [1, 2, 3, 5, 5]);
  assert.ok(quests.filter(q => !legacyTicketQuestIds.includes(q.id)).every(q => q.reward.drawTickets === 1));
  assert.ok(quests.every(q => q.reward.drawTickets >= 1 && q.reward.drawTickets <= 5));
  assert.ok(rules.DAILY.every(q => !q.reward.drawTickets));
});

test('the complete path deposits all quest ticket quantities, preserves an existing wallet and cannot replay', async () => {
  const user = sample(); user.stats.totalScore = 3000; user.stats.totalCorrect = 100; user.soulboundDrawTickets = 7;
  user.questProgress = { totals: { solo: 100, meditation: 1, battle: 5, dongtian: 1, raid: 10 } };
  user.storyProgressV1 = { seen: Object.fromEntries(rules.PATH.filter(q => q.chapterId).map(q => [q.chapterId, true])) };
  user.storyDongtianTutorialV1 = { completed: true };
  const db = fakeDb(user); let ticketCount = 7;
  for (const q of rules.PATH) {
    const paid = await questTransaction(db, 'u1', { kind: 'path', id: q.id, drawTickets: 999 }, now);
    assert.equal(paid.awarded, true, q.id);
    ticketCount += q.reward.drawTickets;
    assert.equal(paid.drawTickets, ticketCount);
    assert.equal((await questTransaction(db, 'u1', { kind: 'path', id: q.id }, now)).awarded, false);
  }
  assert.equal(ticketCount, 55);
  const final = await questTransaction(db, 'u1', null, now);
  assert.equal(final.quests.path, null); assert.deepEqual(final.quests.pathTicketRewards, []);
  assert.deepEqual(db.docs.get('questStates/u1').pathTicketsClaimed, rules.PATH.map(q => q.id));
});

test('unclaimed milestones award currency and tickets atomically, including transaction retry and double-clicks', async () => {
  const { fakeDb: inventoryDb } = require('./helpers/inventory-db.cjs');
  const db = inventoryDb(sample()); db.docs.set('questStates/u1', beforeQuest('path-golden')); db.retryNextTransaction();
  const results = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now)));
  assert.equal(results.filter(r => r.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, 220);
  assert.equal(results.at(-1).drawTickets, 1);
  assert.ok(db.docs.get('questStates/u1').pathTicketsClaimed.includes('path-golden'));
});

test('older and fully completed paths can claim full ticket rewards without repeating original rewards', async () => {
  for (const state of [{ pathIndex: 21 }, { version: 2, pathClaimed: rules.PATH.map(q => q.id) }]) {
    const user = sample(); user.materialSystem = { inventory: { 'raid-refine-key-iii': 9 } };
    const db = fakeDb(user, state), before = structuredClone(db.docs.get('questStates/u1'));
    const view = await questTransaction(db, 'u1', null, now);
    assert.equal(view.quests.pathTicketRewards.length, view.quests.pathCompleted);
    const minted = db.docs.get('questStates/u1');
    assert.equal(minted.commissionDate, date, 'first view stores its daily assignment');
    assert.equal(minted.commissionIds.length,2);
    assert.equal(minted.pathClaimed.length,view.quests.pathCompleted,'reading preserves old path claims');
    const repeatView = await questTransaction(db,'u1',null,now);
    assert.deepEqual(db.docs.get('questStates/u1'),minted,'subsequent reads must not reshuffle commissions');
    assert.equal(repeatView.quests.pathCompleted,view.quests.pathCompleted);
    for (const {id} of view.quests.pathTicketRewards) {
      const results = await Promise.all([1, 2, 3].map(() => questTransaction(db, 'u1', { kind: 'path', id }, now)));
      assert.equal(results.filter(r => r.awarded).length, 1);
      assert.equal(results.find(r => r.awarded).reward.gold, 0);
    }
    const remote = db.docs.get('users/u1');
    assert.equal(remote.soulboundDrawTickets, state.pathIndex === 21 ? 32 : 48); assert.deepEqual(remote.stats, user.stats);
    assert.deepEqual(remote.materialSystem, user.materialSystem);
    const final = await questTransaction(db, 'u1', null, now);
    assert.equal(final.quests.pathCompleted, view.quests.pathCompleted);
    assert.equal(final.quests.path?.id, view.quests.path?.id);
    assert.deepEqual(final.quests.pathTicketRewards, []);
  }
});

test('the first one-ticket rollout migrates paid quantities and awards only differences even after spending', async () => {
  const user = sample(); user.soulboundDrawTickets = 0;
  const state = { version: 2, pathClaimed: rules.PATH.map(q => q.id), pathTicketsClaimed: legacyTicketQuestIds };
  const db = fakeDb(user, state);
  const first = await questTransaction(db, 'u1', null, now);
  assert.deepEqual(first.quests.pathTicketRewards.filter(q => legacyTicketQuestIds.includes(q.id)).map(q => [q.id, q.reward.drawTickets]),
    [['path-raid-one', 1], ['path-nascent', 2], ['path-raid-ten', 4], ['path-solo-hundred', 4]]);
  assert.equal(first.quests.pathTicketRewards.filter(q => !legacyTicketQuestIds.includes(q.id)).length, 32);
  assert.equal((await questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now)).awarded, false);
  for (const q of first.quests.pathTicketRewards) {
    const claims = await Promise.all([1, 2, 3].map(() => questTransaction(db, 'u1', { kind: 'path', id: q.id, drawTickets: 5 }, now)));
    assert.equal(claims.filter(r => r.awarded).length, 1);
    assert.equal(claims.find(r => r.awarded).reward.drawTickets, q.reward.drawTickets);
  }
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, 43, 'five already-issued tickets are not re-awarded');
  assert.deepEqual(db.docs.get('users/u1').stats, user.stats);
  assert.deepEqual(db.docs.get('questStates/u1').pathTicketAmounts,
    Object.fromEntries(rules.PATH.map(q => [q.id, q.reward.drawTickets])));
  db.docs.get('users/u1').soulboundDrawTickets = 0;
  const tomorrow = new Date('2026-10-03T12:00:00Z');
  assert.deepEqual((await questTransaction(db, 'u1', null, tomorrow)).quests.pathTicketRewards, []);
  assert.equal((await questTransaction(db, 'u1', { kind: 'path', id: 'path-raid-ten' }, tomorrow)).awarded, false);
});

test('a partially paid quest retains its amount across daily claims and concurrent supplemental retries', async () => {
  const user = sample(); user.soulboundDrawTickets = 2;
  for (let i = 0; i < 3; i++) user.questProgress = rules.recordEvent(user.questProgress, 'solo', date);
  const state = { version: 2, pathClaimed: rules.PATH.map(q => q.id), pathTicketsClaimed: ['path-raid-ten'],
    pathTicketAmounts: { 'path-raid-ten': 3 } };
  const db = fakeDb(user, state);
  await questTransaction(db, 'u1', { kind: 'daily', id: 'daily-solo-three', date }, now);
  const before = await questTransaction(db, 'u1', null, now);
  assert.equal(before.quests.pathTicketRewards.find(q => q.id === 'path-raid-ten').reward.drawTickets, 2);
  const claims = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-raid-ten' }, now)));
  assert.equal(claims.filter(r => r.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, 4);
  assert.equal(db.docs.get('questStates/u1').pathTicketAmounts['path-raid-ten'], 5);
});

test('players already paid the five previous milestone rewards can supplement the other thirty-two quests', async () => {
  const state = { version: 2, pathClaimed: rules.PATH.map(q => q.id), pathTicketsClaimed: legacyTicketQuestIds,
    pathTicketAmounts: Object.fromEntries(rules.PATH.filter(q => legacyTicketQuestIds.includes(q.id)).map(q => [q.id, q.reward.drawTickets])) };
  const user = sample(); user.soulboundDrawTickets = 0;
  const db = fakeDb(user, state), view = await questTransaction(db, 'u1', null, now);
  assert.equal(view.quests.pathTicketRewards.length, 32);
  assert.ok(view.quests.pathTicketRewards.every(q => q.reward.drawTickets === 1 && !legacyTicketQuestIds.includes(q.id)));
  const id = 'path-story-prologue-enter-sect';
  const paid = await questTransaction(db, 'u1', { kind: 'path', id }, now);
  assert.equal(paid.reward.drawTickets, 1); assert.equal(paid.reward.gold, 0);
  assert.equal(paid.drawTickets, 1); assert.equal(paid.quests.pathCompleted, 37);
  assert.equal((await questTransaction(db, 'u1', { kind: 'path', id }, now)).awarded, false);
  assert.deepEqual(db.docs.get('users/u1').stats, user.stats);
});

test('failed ticket deposits roll back the quest claim, and earned tickets can immediately pay for a draw', async () => {
  const { fakeDb: inventoryDb } = require('./helpers/inventory-db.cjs');
  const { transaction } = require('../soulbound-draw-api.cjs').__test;
  const pool = require('../public/cultivation/soulbound-pool.js');
  const db = inventoryDb(sample()); const state = beforeQuest('path-golden'); db.docs.set('questStates/u1', state);
  const run = db.runTransaction;
  db.runTransaction = worker => run(tx => worker({ ...tx, set() { throw Error('database unavailable'); } }));
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now), /database unavailable/);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, undefined);
  assert.equal(db.docs.get('users/u1').stats.gold, 20); assert.deepEqual(db.docs.get('questStates/u1'), state);
  db.runTransaction = run;
  await questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now);
  const drawn = await transaction(db, 'u1', 'draw', { requestId: 'quest-ticket-draw-001', count: 1, payment: 'ticket', poolVersion: pool.VERSION }, () => .5);
  assert.equal(drawn.drawTickets, 0); assert.equal(drawn.balance, 220); assert.equal(drawn.result.ticketsSpent, 1);
  assert.equal((await questTransaction(db, 'u1', { kind: 'path', id: 'path-golden' }, now)).drawTickets, 0, 'spending the ticket cannot make the quest claimable again');
});

test('unfinished and out-of-order ticket quests cannot be claimed with caller-selected ticket amounts', async () => {
  const user = sample(); user.stats.totalScore = 27;
  const db = fakeDb(user, beforeQuest('path-golden'));
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-golden', drawTickets: 999 }, now), /尚未完成/);
  await assert.rejects(questTransaction(db, 'u1', { kind: 'path', id: 'path-nascent', drawTickets: 999 }, now), /尚未完成/);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, undefined);
});

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

test('a saved lesson grants its fixed gold and one ticket once without counting as a formal cave', async () => {
  const index = rules.PATH.findIndex(q => q.id === 'path-dongtian-tutorial');
  const state = { version: 2, pathClaimed: rules.PATH.slice(0, index).map(q => q.id) };
  const user = sample();
  user.storyDongtianTutorialV1 = { completed: true, skipped: false };
  const db = fakeDb(user, state);
  const claims = await Promise.all(Array.from({ length: 5 }, () => questTransaction(db, 'u1', { kind: 'path', id: 'path-dongtian-tutorial' }, now)));
  assert.equal(claims.filter(r => r.awarded).length, 1);
  assert.equal(db.docs.get('users/u1').stats.gold, user.stats.gold + 50);
  assert.equal(db.docs.get('users/u1').soulboundDrawTickets, 1);
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
  assert.equal(before.quests.pathCompleted, 8);
  assert.equal(before.quests.path.id, 'path-story-prologue-enter-sect');
  assert.equal(before.quests.daily.find(q => q.id === 'daily-solo-three').claimed, true);
  const first = await questTransaction(db, 'u1', { kind: 'path', id: before.quests.path.id }, now);
  assert.equal(first.awarded, true);
  assert.equal(first.quests.path.id, 'path-story-qi-one-ask-dao', 'already claimed original tasks are skipped');
  assert.equal(first.quests.pathCompleted, 9);
  const duplicate = await questTransaction(db, 'u1', { kind: 'path', id: 'path-cave' }, now);
  assert.equal(duplicate.awarded, true, 'a previously claimed task can supplement only its new ticket');
  assert.deepEqual(duplicate.reward, { gold: 0, cultivation: 0, materials: {}, drawTickets: 1 });
  assert.equal((await questTransaction(db, 'u1', { kind: 'path', id: 'path-cave' }, now)).awarded, false);
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
