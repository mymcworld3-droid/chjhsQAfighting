const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdminAccountHandler } = require('../admin-account-api.cjs').__test;

function response() {
  return {
    code: 0, body: null, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function resolver({ admin = true } = {}) {
  const docs = new Map([
    ['admin-uid', {
      isAdmin: admin, displayName: '管理員', email: 'admin@example.com',
      lastActive: { toMillis: () => 2000 }
    }],
    ['player-uid', {
      displayName: '玩家甲', email: 'player@example.com', friendCode: 'ABCD1234',
      stats: { totalScore: 188 }, privateToken: 'do-not-send',
      createdAt: { toMillis: () => 1000 }, lastActive: { toMillis: () => 1500 }
    }]
  ]);
  const db = {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return { async get() {
            const data = docs.get(uid);
            return { exists: !!data, id: uid, data: () => data };
          }};
        },
        async get() {
          return {
            docs: [...docs].map(([id, data]) => ({ id, data: () => data }))
          };
        }
      };
    }
  };
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      assert.equal(token, 'good-token');
      assert.equal(checkRevoked, true);
      return {
        uid: 'admin-uid',
        aud: 'question-learning',
        iss: 'https://securetoken.google.com/question-learning'
      };
    }
  };
  return () => ({ db, auth, app: { options: { projectId: 'question-learning' } } });
}

function request(body, token = 'good-token') {
  return {
    body,
    get(name) { return String(name).toLowerCase() === 'authorization' ? 'Bearer ' + token : ''; }
  };
}

test('admin account API lists summaries only after a verified admin token', async () => {
  const handler = createAdminAccountHandler({ resolve: resolver(), logger: { warn() {}, error() {} } });
  const res = response();
  await handler(request({ action: 'list' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.entries[0].uid, 'admin-uid');
  assert.equal(res.body.entries[1].uid, 'player-uid');
  assert.equal(res.body.entries[1].data.friendCode, 'ABCD1234');
  assert.equal('stats' in res.body.entries[1].data, false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('non-admin cannot enumerate accounts', async () => {
  const handler = createAdminAccountHandler({ resolve: resolver({ admin: false }), logger: { warn() {}, error() {} } });
  const res = response();
  await handler(request({ action: 'list' }), res);
  assert.equal(res.code, 403);
  assert.match(res.body.error, /沒有管理員權限/);
});

test('detail response redacts secret-looking fields and serializes timestamps', async () => {
  const handler = createAdminAccountHandler({ resolve: resolver(), logger: { warn() {}, error() {} } });
  const res = response();
  await handler(request({ action: 'detail', uid: 'player-uid' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.uid, 'player-uid');
  assert.equal(res.body.data.privateToken, '[已遮蔽]');
  assert.equal(res.body.data.stats.totalScore, 188);
  assert.equal(res.body.data.createdAt, '1970-01-01T00:00:01.000Z');
});

test('invalid detail UID is rejected before Firestore document lookup', async () => {
  const handler = createAdminAccountHandler({ resolve: resolver(), logger: { warn() {}, error() {} } });
  const res = response();
  await handler(request({ action: 'detail', uid: 'bad/path' }), res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /UID 無效/);
});
