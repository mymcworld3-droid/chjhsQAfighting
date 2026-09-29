'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = require('../invitation-api.cjs');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

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

test('client invitation lifecycle never reads or writes Firestore invitation documents', () => {
  const legacy = read('public/main-legacy.js');
  const repository = read('public/cultivation/data/player-repository.js');
  assert.match(legacy, /\/api\/invitations\/listen/);
  assert.match(legacy, /\/api\/invitations\/send/);
  assert.match(legacy, /\/api\/invitations\/remove/);
  assert.match(repository, /\/api\/invitations\/send/);
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
  assert.match(source, /verifyIdToken/);
});

test('server.js registers invitation API', () => {
  const server = read('server.js');
  assert.match(server, /require\('\.\/invitation-api\.cjs'\)/);
  assert.match(server, /registerInvitationApi\(app\)/);
});
