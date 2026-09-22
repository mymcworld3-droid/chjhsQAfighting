const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectTokenHandler } = require('../firebase-project-auth-api.cjs');
const { parseServiceAccount, PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const { parseArgs, COLLECTIONS, migrate } = require('../scripts/migrate-dongtian-to-bd.cjs');

function request({ roles = ['BD'], bearer = 'a-valid-token' } = {}) {
  return {
    body: { roles },
    get(name) { return name === 'authorization' ? 'Bearer ' + bearer : ''; }
  };
}
function response() {
  return {
    statusCode: 200, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}
function authServices({ uid = 'player123', projectId = PROJECT_IDS.A, revoked = false } = {}) {
  const calls = [];
  const services = Object.fromEntries(['A', 'BD', 'C'].map(role => [role, {
    auth: {
      async verifyIdToken(token, checkRevoked) {
        calls.push(['verify', role, token, checkRevoked]);
        if (revoked) throw new Error('revoked');
        return { uid, aud: projectId, iss: 'https://securetoken.google.com/' + projectId };
      },
      async createCustomToken(tokenUid, claims) {
        calls.push(['sign', role, tokenUid, claims]);
        return role + '.SIGNED';
      }
    }
  }]));
  return { calls, services, resolve: role => services[role] };
}

test('A token is verified before minting project-specific BD/C custom tokens', async () => {
  const mock = authServices();
  const handler = createProjectTokenHandler({ resolve: mock.resolve });
  const res = await handler(request({ roles: ['BD', 'C'] }), response());
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.uid, 'player123');
  assert.equal(res.body.tokens.BD, 'BD.SIGNED');
  assert.equal(res.body.tokens.C, 'C.SIGNED');
  assert.deepEqual(mock.calls.map(call => call[0] + ':' + call[1]), ['verify:A', 'sign:BD', 'sign:C']);
  assert.equal(mock.calls[0][3], true, 'revoked A accounts must be denied');
});

test('token exchange rejects missing/foreign/revoked ID tokens and unknown roles', async () => {
  const normal = authServices();
  const handler = createProjectTokenHandler({ resolve: normal.resolve });
  assert.equal((await handler({ body: { roles: ['BD'] }, get: () => '' }, response())).statusCode, 401);
  assert.equal((await handler(request({ roles: ['A'] }), response())).statusCode, 400);
  assert.equal((await handler(request({ roles: ['BD', 'BD'] }), response())).statusCode, 400);
  const foreign = authServices({ projectId: 'someone-else' });
  assert.equal((await createProjectTokenHandler({ resolve: foreign.resolve })(request(), response())).statusCode, 401);
  const revoked = authServices({ revoked: true });
  assert.equal((await createProjectTokenHandler({ resolve: revoked.resolve })(request(), response())).statusCode, 401);
});

test('missing server credentials fail closed before any custom token signing', async () => {
  const mock = authServices();
  const handler = createProjectTokenHandler({ resolve(role) {
    if (role === 'BD') throw new Error('Missing service credentials');
    return mock.resolve(role);
  } });
  const previous = console.error;
  console.error = () => {};
  try {
    const res = await handler(request(), response());
    assert.equal(res.statusCode, 503);
    assert.deepEqual(mock.calls, []);
  } finally { console.error = previous; }
});

test('service accounts must match the specific Firebase project and never use browser API keys', () => {
  for (const role of ['A', 'BD', 'C']) {
    assert.throws(() => parseServiceAccount(role, {}), /Missing server credential/);
    const mismatched = {
      type: 'service_account', project_id: 'wrong-project',
      private_key: '-----BEGIN PRIVATE KEY-----', client_email: 'service@example.test'
    };
    assert.throws(() => parseServiceAccount(role, {
      [role === 'A' ? 'FIREBASE_A_SERVICE_ACCOUNT_JSON' : role === 'BD' ? 'FIREBASE_BD_SERVICE_ACCOUNT_JSON' : 'FIREBASE_C_SERVICE_ACCOUNT_JSON']: JSON.stringify(mismatched)
    }), /requires a service account/);
  }
});

test('cave migration defaults to read-only and never copies A player reward receipts', () => {
  assert.equal(parseArgs([]), 'dry-run');
  assert.equal(parseArgs(['--verify-only']), 'verify');
  assert.equal(parseArgs(['--execute']), 'execute');
  assert.throws(() => parseArgs(['--execute', '--verify-only']));
  assert.deepEqual(COLLECTIONS, ['dongtianIndex', 'dongtians', 'dongtianReports']);
});

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    collection(name) {
      return {
        async get() { return { docs: Object.entries(rows[name] || {}).map(([id, data]) => ({ id, data: () => data })) }; },
        doc(id) { return { name, id }; }
      };
    },
    async getAll(...refs) { return refs.map(ref => {
      const data = rows[ref.name]?.[ref.id];
      return { exists: Boolean(data), data: () => data };
    }); },
    batch() {
      const creates = [];
      return {
        create(ref, data) { creates.push({ ref, data }); },
        async commit() {
          calls.push(creates.map(x => x.ref.name + '/' + x.ref.id));
          creates.forEach(x => { (rows[x.ref.name] ||= {})[x.ref.id] = x.data; });
        }
      };
    }
  };
}

test('migration copies missing IDs exactly, verifies copies and keeps the A source untouched', async () => {
  const sourceRows = {
    dongtianIndex: { id1: { ownerUid: 'p1', status: 'active' } },
    dongtians: { id1: { ownerUid: 'p1', questions: [{ q: 'one' }] } },
    dongtianReports: {}
  };
  const destRows = { dongtianIndex: {}, dongtians: {}, dongtianReports: {} };
  const original = JSON.stringify(sourceRows);
  const source = fakeDb(sourceRows), dest = fakeDb(destRows), output = { log() {} };
  await migrate({ source, destination: dest, action: 'dry-run', output });
  assert.equal(dest.calls.length, 0);
  await migrate({ source, destination: dest, action: 'execute', output });
  assert.equal(destRows.dongtians.id1.questions[0].q, 'one');
  assert.equal(JSON.stringify(sourceRows), original);
  assert.equal(dest.calls.length, 2);
});

test('migration refuses to overwrite different content or unexpected BD documents', async () => {
  const source = fakeDb({ dongtianIndex: { a: { v: 1 } } });
  const target = fakeDb({ dongtianIndex: { a: { v: 2 } } });
  const output = { log() {} };
  await assert.rejects(migrate({ source, destination: target, action: 'execute', output }), /differs in BD/);
  assert.equal(target.calls.length, 0);
});
