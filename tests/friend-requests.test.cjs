'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers/d1-db.cjs');
const register = require('../friend-requests-api.cjs');
const { perform } = register;
const CLOCK = 2000000000;
const options = { now: () => CLOCK, makeId: () => 'request-1' };
async function fixture() {
  const { db } = setup();
  for (const [uid, code] of [['alice', 'ALICE1'], ['bob', 'BOB123'], ['eve', 'EVE123']]) await db.doc('users/' + uid).set({ uid, displayName: uid, friendCode: code, friends: [] });
  return db;
}
const send = (db, uid = 'alice', peerUid = 'bob', opts = options) => perform(db, uid, { action: 'send', peerUid, name: 'forged' }, opts);
const respond = (db, uid = 'bob', decision = 'accept', opts = options) => perform(db, uid, { action: 'respond', requestId: 'request-1', decision }, opts);
test('friend requests persist without creating friendships until explicit authenticated acceptance', async () => {
  const db = await fixture();
  await send(db);
  assert.deepEqual((await db.doc('users/alice').get()).data().friends, []);
  const inbox = await perform(db, 'bob', { action: 'status' }, options);
  assert.equal(inbox.pending[0].name, 'alice');
  assert.equal(inbox.pending[0].fromUid, 'alice');
  await assert.rejects(respond(db, 'eve'), /不存在/);
  const accepted = await respond(db);
  assert.deepEqual(accepted.friends, ['alice']);
  assert.deepEqual((await db.doc('users/alice').get()).data().friends, ['bob']);
  assert.deepEqual((await db.doc('friendRequestInboxes/bob').get()).data().pending, []);
  assert.equal((await respond(db, 'bob', 'decline')).decision, 'accept');
});
test('duplicate sends and concurrent accepts are idempotent and keep both friend arrays consistent', async () => {
  const db = await fixture();
  await Promise.all([send(db), send(db)]);
  assert.equal((await db.doc('friendRequestInboxes/bob').get()).data().pending.length, 1);
  assert.equal((await db.doc('friendRequestOutboxes/alice').get()).data().sent.length, 1);
  await Promise.all([respond(db), respond(db)]);
  assert.deepEqual((await db.doc('users/bob').get()).data().friends, ['alice']);
  assert.deepEqual((await db.doc('users/alice').get()).data().friends, ['bob']);
  assert.equal((await send(db)).alreadyFriends, true);
});
test('decline leaves friends unchanged and prevents immediate re-invitation', async () => {
  const db = await fixture(); await send(db); await respond(db, 'bob', 'decline');
  assert.deepEqual((await db.doc('users/bob').get()).data().friends, []);
  await assert.rejects(send(db), error => error.status === 429);
  assert.equal((await send(db, 'alice', 'bob', { ...options, now: () => CLOCK + 86400001 })).sent, true);
});
test('players can stop new requests, retain old ones, and re-enable requests', async () => {
  const db = await fixture(); await send(db);
  await perform(db, 'bob', { action: 'preferences', acceptRequests: false }, options);
  await assert.rejects(send(db, 'eve'), /不接受好友邀請/);
  const state = await perform(db, 'bob', { action: 'status' }, options);
  assert.equal(state.acceptRequests, false); assert.equal(state.pending.length, 1);
  await respond(db);
  await perform(db, 'bob', { action: 'preferences', acceptRequests: true }, options);
  assert.equal((await send(db, 'eve')).sent, true);
});
test('friend code lookup, invalid IDs, and missing players are handled without arbitrary writes', async () => {
  const db = await fixture();
  assert.equal((await perform(db, 'alice', { action: 'send', friendCode: ' bob123 ' }, options)).sent, true);
  for (const peer of ['alice', 'missing', '../bob', '']) await assert.rejects(send(db, 'alice', peer));
  await assert.rejects(perform(db, 'alice', { action: 'send', friendCode: 'XXXXXX' }, options), /找不到/);
});
test('crossed invites are cleared atomically when either side accepts', async () => {
  const db = await fixture(); await send(db);
  await send(db, 'bob', 'alice', { ...options, makeId: () => 'reverse' });
  await respond(db);
  assert.deepEqual((await db.doc('friendRequestInboxes/alice').get()).data().pending, []);
  assert.equal((await perform(db, 'alice', { action: 'respond', requestId: 'reverse', decision: 'accept' }, options)).alreadyResolved, true);
});
test('expired requests cannot be accepted and inbox and sender limits are bounded', async () => {
  const db = await fixture(); await send(db);
  await assert.rejects(respond(db, 'bob', 'accept', { ...options, now: () => CLOCK + 7 * 86400000 }), /過期/);
  await db.doc('friendRequestInboxes/bob').set({ pending: Array.from({ length: 50 }, (_, i) => ({ id: String(i), fromUid: 'u' + i, createdAtMs: CLOCK })) });
  await assert.rejects(send(db), /已滿/);
  await db.doc('friendRequestInboxes/bob').set({ pending: [] });
  await db.doc('friendRequestOutboxes/alice').set({ sent: Array(20).fill(CLOCK) });
  await assert.rejects(send(db), /每小時/);
});
test('acceptance with full friends list fails atomically and keeps request reviewable', async () => {
  const db = await fixture(); await send(db);
  await db.doc('users/alice').update({ friends: Array.from({ length: 100 }, (_, i) => 'friend-' + i) });
  await assert.rejects(respond(db), /上限/);
  assert.deepEqual((await db.doc('users/bob').get()).data().friends, []);
  assert.equal((await db.doc('friendRequestInboxes/bob').get()).data().pending.length, 1);
});
test('API authenticates main-project tokens and publishes hints only after persistence', async () => {
  const db = await fixture(); let handler; const hints = [];
  register({ post: (_path, cb) => { handler = cb; } }, {
    resolveA: () => ({ db, auth: { verifyIdToken: async token => ({ uid: 'alice', aud: token === 'bad' ? 'wrong' : 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) } }),
    hub: { push: (uid, data) => hints.push({ uid, data }) }
  });
  const res = () => ({ code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } });
  for (const token of ['', 'Bearer bad']) { const response = res(); await handler({ get: () => token, body: { action: 'send', peerUid: 'bob' } }, response); assert.equal(response.code, 401); }
  assert.equal(hints.length, 0);
  const response = res(); await handler({ get: () => 'Bearer good', body: { action: 'send', peerUid: 'bob', uid: 'eve' } }, response);
  assert.equal(response.data.ok, true); assert.equal(hints[0].uid, 'bob'); assert.equal(hints[0].data.type, 'friend-request');
  assert.equal((await db.doc('friendRequestInboxes/bob').get()).data().pending[0].fromUid, 'alice');
  assert.equal(response.data.notifyUid, undefined);
});
