'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const api = require('../invitation-api.cjs');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('disconnected listeners cannot drain a queued invitation on reconnect', () => {
  const hub = api.__test.createInvitationHub();
  const invitation = { id: 'reconnect-1', createdAtMs: Date.now() };
  hub.push('recipient', invitation);
  hub.listen('recipient', { destroyed: true, json() { assert.fail('dead response'); } });
  let delivered;
  hub.listen('recipient', { json(value) { delivered = value; } });
  assert.equal(delivered.invitations[0], invitation);
});

test('listener closing during authentication never registers a dead waiter', async () => {
  const handlers = new Map();
  let verify;
  let listens = 0;
  api({ post(route, handler) { handlers.set(route, handler); } }, {
    resolveA: () => ({ auth: { verifyIdToken: () => new Promise(resolve => { verify = resolve; }) } }),
    hub: { listen() { listens++; } }
  });
  const res = { set() {}, destroyed: false };
  const job = handlers.get('/api/invitations/listen')({ get: () => 'Bearer valid.token' }, res);
  res.destroyed = true;
  verify({ uid: 'recipient', aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' });
  await job;
  assert.equal(listens, 0);
});

test('a closed socket awaiting its close event does not consume an invitation', () => {
  const hub = api.__test.createInvitationHub();
  const res = { destroyed: false, json() { assert.fail('dead socket'); }, once() {} };
  hub.listen('recipient', res);
  res.destroyed = true;
  hub.push('recipient', { id: 'still-queued', createdAtMs: Date.now() });
  let delivered;
  hub.listen('recipient', { json(value) { delivered = value; } });
  assert.equal(delivered.invitations[0].id, 'still-queued');
});

test('send checks room and friendship concurrently and only delivers after both pass', async () => {
  const handlers = new Map();
  let resolveSender, roomRead = false;
  const sent = [];
  api({ post(route, handler) { handlers.set(route, handler); } }, {
    resolveA: () => ({
      auth: { verifyIdToken: async () => ({ uid: 'host', aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) },
      db: { collection: () => ({ doc: () => ({ get: () => new Promise(resolve => { resolveSender = resolve; }) }) }) }
    }),
    resolveC: () => ({ db: { collection: () => ({ doc: () => ({ get: async () => {
      roomRead = true;
      return { exists: true, data: () => ({ status: 'waiting', host: { uid: 'host' }, modeVersion: 2 }) };
    } }) }) } }),
    hub: { isOnline: () => true, push(uid, invite) { sent.push({ uid, invite }); } }
  });
  let result;
  const res = { set() {}, json(value) { result = value; }, status() { return this; } };
  const job = handlers.get('/api/invitations/send')({
    get: () => 'Bearer valid.token',
    body: { friendUids: ['friend', 'stranger'], invitation: { roomId: 'room-1234', modeVersion: 2 } }
  }, res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(roomRead, true);
  assert.equal(sent.length, 0);
  resolveSender({ exists: true, data: () => ({ friends: ['friend'], photoURL: 'https://example.test/account.jpg', equipped: { avatar: '' } }) });
  await job;
  assert.equal(result.ok, true);
  assert.deepEqual(sent.map(item => item.uid), ['friend']);
  assert.equal(sent[0].invite.hostAvatar, 'https://example.test/account.jpg');
});

function requestContext(getIdToken, fetch) {
  const timers = new Map();
  let timerId = 0;
  const context = {
    auth: { currentUser: { getIdToken } }, AbortController, fetch,
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  };
  const legacy = read('public/main-legacy.js');
  vm.runInNewContext(legacy.slice(legacy.indexOf('async function invitationServerRequest('), legacy.indexOf('function inviteHandlerReady(')), context);
  return { context, timers };
}

test('stalled token refresh times out instead of blocking invitations forever', async () => {
  const { context, timers } = requestContext(() => new Promise(() => {}), () => assert.fail('fetch before token'));
  const job = context.invitationServerRequest('/api/invitations/listen');
  assert.equal([...timers.values()][0].ms, 30000);
  [...timers.values()][0].fn();
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(timers.size, 0);
});

test('stalled network requests abort and release the request watchdog', async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const { context, timers } = requestContext(async () => 'token', (_path, { signal }) => {
    started();
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  const job = context.invitationServerRequest('/api/invitations/listen');
  await began;
  [...timers.values()][0].fn();
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(timers.size, 0);
});

test('request timeout reconnects; stopping the listener prevents another reconnect', async () => {
  let calls = 0, resolveSecond;
  const context = {
    auth: { currentUser: { uid: 'recipient' } }, currentUserData: {},
    window: { __xiuxianMigrationApproved: true }, inviteUnsub: null,
    AbortController, Date, console: { warn() {} },
    setTimeout(fn) { fn(); }, receiveIncomingInvite() {}, flushPendingIncomingInvites() {},
    invitationServerRequest() {
      calls++;
      if (calls === 1) return Promise.reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
      return new Promise(resolve => { resolveSecond = resolve; });
    }
  };
  const legacy = read('public/main-legacy.js');
  vm.runInNewContext(legacy.slice(legacy.indexOf('function startInvitationListener()'), legacy.indexOf('function refreshInvitationListener(')), context);
  context.startInvitationListener();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  context.inviteUnsub();
  resolveSecond({ invitations: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(context.inviteUnsub, null);
});

test('resume forces a fresh connection even when the old poll started recently', () => {
  let timer, starts = 0, stops = 0;
  const context = {
    auth: { currentUser: { uid: 'recipient' } }, currentUserData: {},
    window: { __xiuxianMigrationApproved: true }, inviteRefreshForced: false,
    inviteRefreshTimer: null, inviteUnsub() { stops++; context.inviteUnsub = null; },
    setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {},
    startInvitationListener() { starts++; }, flushPendingIncomingInvites() {}
  };
  const legacy = read('public/main-legacy.js');
  vm.runInNewContext(legacy.slice(legacy.indexOf('function refreshInvitationListener('), legacy.indexOf("window.addEventListener('online'")), context);
  context.refreshInvitationListenerAfterResume();
  // Feature-ready events cannot downgrade the pending resume reconnect.
  context.scheduleInvitationListenerRefresh();
  timer();
  assert.equal(stops, 1);
  assert.equal(starts, 1);
});

test('server invitation hub tracks online listeners and delivers queued invitations', async () => {
  let clock = 1000;
  const hub = api.__test.createInvitationHub({
    now: () => clock,
    listenTimeoutMs: 20,
    onlineTtlMs: 1000,
    ttlMs: 5000
  });
  let payload = null;
  const res = {
    headersSent: false,
    json(value) { this.headersSent = true; payload = value; },
    once() {}
  };
  hub.listen('u2', res);
  assert.equal(hub.isOnline('u2'), true);
  hub.push('u2', { id: 'i1', createdAtMs: clock });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(payload, { ok: true, invitations: [{ id: 'i1', createdAtMs: 1000 }] });
  clock += 1001;
  assert.equal(hub.isOnline('u2'), false);
});

test('queued invitation survives a short listener suspension and is delivered on reconnect', () => {
  let clock = 2000;
  const hub = api.__test.createInvitationHub({
    now: () => clock,
    listenTimeoutMs: 20,
    onlineTtlMs: 1000,
    ttlMs: 5000
  });
  hub.push('u3', { id: 'queued-1', createdAtMs: clock });
  clock += 500;
  let payload = null;
  const res = {
    headersSent: false,
    json(value) { this.headersSent = true; payload = value; },
    once() {}
  };
  hub.listen('u3', res);
  assert.deepEqual(payload, { ok: true, invitations: [{ id: 'queued-1', createdAtMs: 2000 }] });
});

test('client invitation lifecycle never reads or writes Firestore invitation documents', () => {
  const legacy = read('public/main-legacy.js');
  const repository = read('public/cultivation/data/player-repository.js');
  assert.match(legacy, /\/api\/invitations\/listen/);
  assert.match(legacy, /\/api\/invitations\/send/);
  assert.match(legacy, /\/api\/invitations\/remove/);
  assert.match(repository, /\/api\/invitations\/send/);
  assert.match(legacy, /pendingIncomingInvites/);
  assert.match(legacy, /window\.addEventListener\('pageshow'/);
  assert.match(legacy, /window\.addEventListener\('online'/);
  assert.match(legacy, /window\.addEventListener\('focus'/);
  assert.match(legacy, /document\.addEventListener\('visibilitychange'/);
  assert.match(legacy, /startInvitationListener\(\);[\s\S]{0,300}載入可選功能/);
  assert.doesNotMatch(legacy, /["']invitations["']/);
  assert.doesNotMatch(repository, /["']invitations["']/);
  assert.doesNotMatch(repository, /sendInvitationsToActiveFriends/);
});

test('server validates room ownership and trusted friendship before delivery', () => {
  const source = read('invitation-api.cjs');
  assert.match(source, /sender\.friends/);
  assert.match(source, /friends\.has\(uid\)/);
  assert.match(source, /room\.host\?\.uid !== uid/);
  assert.match(source, /room\.hostUid !== uid/);
  assert.match(source, /hub\.isOnline\(uid\)/);
  assert.match(source, /for \(const uid of requested\)/);
  assert.match(source, /queuedTo: requested/);
  assert.match(source, /Safari \/ iPad 暫時背景休眠者/);
  assert.match(source, /verifyIdToken/);
});

test('server.js registers invitation API', () => {
  const server = read('server.js');
  assert.match(server, /require\('\.\/invitation-api\.cjs'\)/);
  assert.match(server, /registerInvitationApi\(app\)/);
});
