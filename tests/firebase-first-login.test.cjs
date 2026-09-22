const test = require('node:test');
const assert = require('node:assert/strict');
const {
  projectPlayerData, createPlayerProfile, createPlayerProvisionHandler
} = require('../firebase-player-provision-api.cjs');
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function fakeStore(rows = {}) {
  const calls = [];
  return {
    rows, calls,
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            async get() {
              const row = rows[name]?.[id];
              return { exists: row !== undefined, data: () => row };
            }
          };
        }
      };
    },
    async runTransaction(fn) {
      const pending = [];
      const tx = {
        async get(ref) { return ref.get(); },
        create(ref, value) {
          if (rows.playerProfiles?.[ref.id]) throw new Error('already exists');
          pending.push({ id: ref.id, value });
        }
      };
      const result = await fn(tx);
      for (const row of pending) {
        (rows.playerProfiles ||= {})[row.id] = row.value;
        calls.push(row.id);
      }
      return result;
    }
  };
}
function request(token = 'valid-main-token') {
  return { get: key => key === 'authorization' ? 'Bearer ' + token : '' };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(key, val) { this.headers[key] = val; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}
function setup({ verified = true, migration = { status: 'ready', ready: true }, missingA = false } = {}) {
  const uid = 'uid-123';
  const original = {
    uid, email: 'private@example.test', isAdmin: true, friends: ['other-user'],
    displayName: '遠山修士', equipped: { avatar: 'avatar-1', frame: 'frame-2' },
    inventory: [{ material: 'rare' }], stats: { gold: 99999, totalScore: 8000 },
    storyProgressV1: { gender: 'female' }
  };
  const a = fakeStore({ users: missingA ? {} : { [uid]: original } });
  const bd = fakeStore(), c = fakeStore();
  const services = {
    A: { app: { options: { projectId: PROJECT_IDS.A } }, db: a, auth: {
      async verifyIdToken() {
        if (!verified) throw new Error('revoked');
        return { uid, aud: PROJECT_IDS.A, iss: 'https://securetoken.google.com/' + PROJECT_IDS.A };
      }
    } },
    BD: { app: { options: { projectId: PROJECT_IDS.BD } }, db: bd },
    C: { app: { options: { projectId: PROJECT_IDS.C } }, db: c }
  };
  const errors = [];
  const handler = createPlayerProvisionHandler({
    resolve: role => services[role],
    migrationStatus: async () => migration,
    logger: { error(...args) { errors.push(args); } }
  });
  return { uid, original, a, bd, c, handler, errors };
}

test('first entry creates minimal BD/C player records from trusted A data, never private balances', async () => {
  const setupData = setup();
  const res = await setupData.handler(request(), response());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.uid, setupData.uid);
  assert.deepEqual(res.body.profiles, { BD: 'created', C: 'created' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(setupData.bd.rows.playerProfiles[setupData.uid].uid, setupData.uid);
  assert.equal(setupData.c.rows.playerProfiles[setupData.uid].gender, 'female');
  for (const role of ['bd', 'c']) {
    const profile = setupData[role].rows.playerProfiles[setupData.uid];
    for (const name of ['email', 'friends', 'isAdmin', 'inventory', 'stats', 'gold', 'totalScore']) {
      assert.equal(Object.hasOwn(profile, name), false, role + ' must not replicate ' + name);
    }
  }
});

test('existing BD/C player records are not written repeatedly on every login', async () => {
  const context = setup();
  assert.equal((await context.handler(request(), response())).statusCode, 200);
  const next = await context.handler(request(), response());
  assert.equal(next.statusCode, 200);
  assert.deepEqual(next.body.profiles, { BD: 'existing', C: 'existing' });
  assert.equal(context.bd.calls.length, 1);
  assert.equal(context.c.calls.length, 1);
});

test('partial first-login failure can retry without overwriting the earlier profile', async () => {
  const context = setup();
  const original = createPlayerProfile;
  const failing = createPlayerProvisionHandler({
    resolve: role => ({
      A: { app: { options: { projectId: PROJECT_IDS.A } }, auth: {
        verifyIdToken: async () => ({
          uid: context.uid, aud: PROJECT_IDS.A,
          iss: 'https://securetoken.google.com/' + PROJECT_IDS.A
        })
      }, db: context.a },
      BD: { app: { options: { projectId: PROJECT_IDS.BD } }, db: context.bd },
      C: { app: { options: { projectId: PROJECT_IDS.C } }, db: context.c }
    }[role]),
    migrationStatus: async () => ({ status: 'ready', ready: true }),
    create(db, uid, data) {
      if (db === context.c) throw new Error('C unavailable');
      return original(db, uid, data);
    },
    logger: { error() {} }
  });
  assert.equal((await failing(request(), response())).statusCode, 503);
  assert.equal(context.bd.calls.length, 1);
  const retry = await context.handler(request(), response());
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.body.profiles, { BD: 'existing', C: 'created' });
  assert.equal(context.bd.calls.length, 1);
  assert.equal(context.c.calls.length, 1);
});

test('invalid A token, unverified cave copy and missing A user block provisioning', async () => {
  for (const opts of [
    { verified: false, expected: 401 },
    { migration: { status: 'legacy', ready: true }, expected: 503 },
    { migration: { status: 'running', ready: false }, expected: 503 },
    { missingA: true, expected: 404 }
  ]) {
    const context = setup(opts);
    const res = await context.handler(request(), response());
    assert.equal(res.statusCode, opts.expected);
    assert.equal(context.bd.calls.length, 0);
    assert.equal(context.c.calls.length, 0);
  }
});

test('frontend waits for verified player initialization before releasing gameplay modules', () => {
  const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
  const main = readFileSync(join(__dirname, '../public/main.js'), 'utf8');
  assert.match(legacy, /await waitForVerifiedPlayerMigration\(user\)/);
  assert.match(legacy, /\/api\/game-startup-player/);
  assert.match(legacy, /window\.__xiuxianMigrationApproved = true;/);
  assert.match(main, /if \(!window\.__xiuxianMigrationApproved\)/);
});
