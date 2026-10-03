'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const rules = require('../public/cultivation/battle-cultivation-rules.js');
const api = require('../battle-reward-api.cjs').__test;
const room = (patch = {}) => ({ modeVersion: 2, battleCultivationVersion: 1, battleCultivationLedger: {},
  status: 'finished', winner: 'h', round: 1, maxRounds: 15,
  host: { uid: 'h', totalScore: 10 }, guest: { uid: 'g', totalScore: 28 }, ...patch });

test('both correct answers contribute even when the second player dies before attacking', () => {
  const r = room({ battleCultivationLedger: { 1: { host: true, guest: true } }, battleLog: [{ actorRole: 'host' }] });
  assert.deepEqual(rules.summary(r), { host: 1, guest: 2, pool: 3 });
  assert.equal(api.battleReward(r, 'h').cultivation, 3);
  assert.equal(api.battleReward(r, 'g').cultivation, 1.5);
  assert.equal(api.battleReward(r, 'h').gold, 500);
  assert.equal(api.battleReward(r, 'g').gold, 200);
});

test('per-round ledger survives answer clearing, duplicate submissions and truncated combat logs', () => {
  let r = room({ status: 'playing' });
  for (let i = 1; i <= 15; i++) {
    r.round = i;
    r.battleCultivationLedger = rules.recordAnswer(r, 'host', true);
    r.battleCultivationLedger = rules.recordAnswer(r, 'host', false);
    r.battleCultivationLedger = rules.recordAnswer(r, 'guest', i % 2 === 1);
  }
  r.battleLog = []; r.host.answerRound = null; r.guest.answerRound = null;
  assert.deepEqual(rules.summary(r), { host: 15, guest: 16, pool: 31 });
  assert.equal(Object.keys(r.battleCultivationLedger).length, 15);
});

test('wrong answers, timeouts, malformed and future entries grant no cultivation', () => {
  const r = room({ battleCultivationLedger: { 0: { host: true }, 1: { host: false, guest: 900 }, 2: { host: true }, 99: { guest: true } } });
  r.guest.answerRound = 1; r.guest.answerCorrect = true; r.guest.timedOut = true;
  assert.equal(rules.summary(r).pool, 0);
  assert.equal(api.battleReward(r, 'h').cultivation, 0);
  assert.deepEqual(rules.recordAnswer(r, 'outsider', true), r.battleCultivationLedger);
  assert.deepEqual(rules.recordAnswer({ ...r, round: 16 }, 'host', true), r.battleCultivationLedger);
});

test('forfeit and disconnect include the current submitted answer exactly once', () => {
  for (const finishReason of ['forfeit', 'disconnect']) {
    const r = room({ round: 2, finishReason, battleCultivationLedger: { 1: { host: true, guest: false } } });
    r.guest.answerRound = 2; r.guest.answerCorrect = true;
    assert.equal(rules.summary(r).pool, 3);
    r.battleCultivationLedger = rules.recordAnswer(r, 'guest', true);
    assert.equal(rules.summary(r).pool, 3);
    r.host.answerRound = 1; r.host.answerCorrect = true;
    assert.equal(rules.summary(r).pool, 3);
  }
});

test('draws split the pool exactly; old rooms and invalid participants retain their guards', () => {
  const r = room({ winner: 'draw', battleCultivationLedger: { 1: { host: true, guest: true } } });
  for (const uid of ['h', 'g']) {
    assert.equal(api.battleReward(r, uid).cultivation, 1.5);
    assert.equal(api.battleReward(r, uid).gold, 0);
  }
  assert.equal(api.battleReward(room({ battleCultivationVersion: undefined }), 'h').cultivation, 5);
  assert.equal(api.battleReward(r, 'outsider'), null);
  assert.equal(api.battleReward({ ...r, status: 'playing' }, 'h'), null);
  assert.equal(api.battleReward({ ...r, winner: 'outsider' }, 'h'), null);
  assert.equal(api.battleReward({ ...r, guest: { uid: 'h' } }, 'h'), null);
});

function memoryDb() {
  const docs = new Map(['h', 'g'].map(uid => ['users/' + uid, { uid, stats: { totalScore: 10, gold: 0 } }]));
  let queue = Promise.resolve();
  const snap = ref => ({ exists: docs.has(ref.key), data: () => structuredClone(docs.get(ref.key)) });
  const db = { collection: name => ({ doc: id => ({ key: name + '/' + id }) }),
    runTransaction(worker) {
      const job = queue.then(async () => {
        const pending = new Map(); let writing = false;
        const value = await worker({ get: async ref => { assert.equal(writing, false); return snap(ref); },
          update(ref, patch) {
            writing = true; const data = structuredClone(docs.get(ref.key));
            for (const [key, val] of Object.entries(patch)) {
              const path = key.split('.'); let target = data;
              for (const part of path.slice(0, -1)) target = target[part] ||= {};
              target[path.at(-1)] = val;
            }
            pending.set(ref.key, data);
          },
          create(ref, data) { writing = true; assert.ok(!docs.has(ref.key)); pending.set(ref.key, data); }
        });
        for (const [key, data] of pending) docs.set(key, data);
        return value;
      }); queue = job.catch(() => {}); return job;
    } };
  return { db, docs };
}

test('concurrent winner/loser claims and retries deposit their pooled amounts once', async () => {
  const { db, docs } = memoryDb();
  const r = room({ battleCultivationLedger: { 1: { host: true, guest: true } } });
  const awards = await Promise.all(['h', 'g', 'h', 'g', 'h'].map(uid => api.awardBattle(db, uid, 'room12345', api.battleReward(r, uid))));
  assert.equal(awards.filter(a => a.awarded).length, 2);
  assert.equal(docs.get('users/h').stats.totalScore, 13);
  assert.equal(docs.get('users/g').stats.totalScore, 11.5);
  assert.equal(docs.get('users/h').stats.gold, 500);
  assert.equal(docs.get('users/g').stats.gold, 200);
  assert.equal(docs.get('users/g').stats.battleMatches, 1);
  const retry = await api.awardBattle(db, 'g', 'room12345', { role: 'guest', outcome: 'loss', gold: 999, cultivation: 999 });
  assert.equal(retry.cultivationAdded, 1.5); assert.equal(retry.goldAdded, 200);
});

test('actual browser submit transaction preserves both players and rejects replayed answers', async () => {
  const source = readFileSync(require.resolve('../public/cultivation/battle-mode-v2.js'), 'utf8');
  const start = source.indexOf('  async function submitAnswer(choice) {');
  const end = source.indexOf('  async function timeoutMissingAnswer', start);
  let live = room({ status: 'playing', currentQuestion: { id: 'q1', ans: 0 } });
  let updates = 0;
  const context = vm.createContext({ cultivationRules: rules, console,
    state: { roomId: 'room12345', role: 'host', room: live }, nowMs: () => 1000,
    db: () => ({}), roomRef: () => ({}), playerForRole: (r, role) => r[role], otherRole: role => role === 'host' ? 'guest' : 'host',
    hasSubmittedAnswer: (p, n) => p.answerRound === n && typeof p.answerCorrect === 'boolean',
    renderQuestion() {}, showCorrectAnswerFeedback() {}, toast() {}, me: () => ({ uid: 'h' }), serverTimestamp: () => 1000,
    runTransaction: async (_, worker) => worker({ get: async () => ({ exists: () => true, data: () => structuredClone(live) }),
      update(_, patch) {
        updates++;
        for (const [key, value] of Object.entries(patch)) {
          const path = key.split('.'); let target = live;
          for (const part of path.slice(0, -1)) target = target[part];
          target[path.at(-1)] = value;
        }
      } })
  });
  vm.runInContext(source.slice(start, end) + '\nthis.submit = submitAnswer;', context);
  await context.submit(0);
  context.state.role = 'guest'; context.state.pendingAnswer = null;
  await context.submit(0);
  context.state.pendingAnswer = null;
  await context.submit(1);
  assert.equal(updates, 2);
  assert.equal(rules.summary(live).pool, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(live.battleCultivationLedger)), { 1: { host: true, guest: true } });
});

test('reward endpoint derives the pool from the room and ignores caller-selected cultivation or UID', async () => {
  const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
  const r = room({ battleCultivationLedger: { 1: { host: true, guest: true } } });
  let paid, payload;
  const handler = api.createHandler({
    resolveA: () => ({ db: {}, auth: { verifyIdToken: async () => ({ uid: 'g', aud: PROJECT_IDS.A,
      iss: 'https://securetoken.google.com/' + PROJECT_IDS.A }) } }),
    resolveC: () => ({ db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => r }), update: async () => {} }) }) } }),
    award: async (_, uid, roomId, reward) => { paid = { uid, roomId, reward }; return { awarded: true, role: reward.role, cultivationAdded: reward.cultivation }; }
  });
  await handler({ body: { roomId: 'room12345', uid: 'h', cultivation: 999999, cultivationPool: 999999 }, get: () => 'Bearer fake-token' },
    { set() {}, status() { return this; }, json: data => { payload = data; } });
  assert.equal(paid.uid, 'g'); assert.equal(paid.reward.cultivation, 1.5);
  assert.equal(payload.cultivationAdded, 1.5); assert.equal(payload.ok, true);
});
