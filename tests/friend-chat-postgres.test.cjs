'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPostgresChatStore, poolConfig, getFriendChatStore } = require('../friend-chat-store.cjs');
const { createHandlers, threadId } = require('../alliance-friend-chat-api.cjs');
const { migrate, parseArgs } = require('../scripts/migrate-friend-chat-to-postgres.cjs');

test('PostgreSQL connection credentials stay server-side and TLS cannot be disabled by URL options', () => {
  assert.throws(() => poolConfig({}), /Missing server credential/);
  assert.throws(() => poolConfig({ SUPABASE_DB_URL: 'https://example.com' }), /protocol/);
  const config = poolConfig({ SUPABASE_DB_URL: 'postgres://user:password@example.com/db?sslmode=disable&ssl=false' });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(config.connectionString).searchParams.has('ssl'), false);
  assert.equal(config.max, 4);
  assert.equal(getFriendChatStore({}), null);
  assert.throws(() => getFriendChatStore({ FRIEND_CHAT_STORAGE: 'typo' }), /Invalid/);
});
test('migration needs an explicit source write freeze and rejects conflicting/unknown modes', () => {
  assert.equal(parseArgs([]), 'dry-run');
  assert.equal(parseArgs(['--execute', '--source-frozen']), 'execute');
  assert.equal(parseArgs(['--verify-only']), 'verify');
  assert.throws(() => parseArgs(['--execute']), /Freeze/);
  assert.throws(() => parseArgs(['--execute', '--verify-only']), /exactly one/);
  assert.throws(() => parseArgs(['--force']), /Unknown/);
});
async function request(handler, body = {}, token = 'alice') {
  const result = {};
  await handler({ body, get: () => token ? 'Bearer ' + token : '' }, {
    set() {}, status(n) { result.status = n; return this; }, json(data) { result.data = data; }
  });
  return result;
}
function identity(players = { alice: ['bob'], bob: ['alice'] }) {
  return role => {
    assert.equal(role, 'A', 'PostgreSQL must never initialize or read Firebase BD');
    return { auth: { async verifyIdToken(token) { return { uid: token, aud: 'question-learning',
      iss: 'https://securetoken.google.com/question-learning' }; } }, db: {
      collection(name) {
        assert.equal(name, 'users');
        return { doc(uid) { return { async get() { return { exists: !!players[uid],
          data: () => ({ friends: players[uid], displayName: uid }) }; } }; } };
      }
    } };
  };
}
test('PostgreSQL handlers retain authentication, mutual-friend checks and migration freeze', async () => {
  let calls = 0;
  const store = { async thread() { calls++; return { messages: [], lastMessageId: '' }; },
    async send() { calls++; }, async read() { calls++; }, async inbox() { calls++; return []; } };
  const h = createHandlers({ projects: identity(), store, env: {}, cooldowns: new Map() });
  assert.equal((await request(h.thread, { peerUid: 'bob' }, '')).status, 401);
  assert.equal((await request(h.thread, { peerUid: 'bob' }, 'outsider')).status, 403);
  assert.equal(calls, 0);
  assert.equal((await request(h.thread, { peerUid: 'bob' })).data.ok, true);
  const frozen = createHandlers({ projects: identity(), store, env: { FRIEND_CHAT_READ_ONLY: '1' } });
  assert.equal((await request(frozen.send, { peerUid: 'bob', text: 'test' })).status, 503);
  assert.equal((await request(frozen.read, { peerUid: 'bob', lastMessageId: 'm' })).status, 503);
  assert.equal(calls, 1);
  assert.equal((await request(frozen.thread, { peerUid: 'bob' })).data.ok, true);
});
test('failed PostgreSQL requests do not fall back to a second source of truth', async () => {
  const h = createHandlers({ projects: identity(), env: {}, store: { async inbox() { throw new Error('db unavailable'); } } });
  const result = await request(h.inbox);
  assert.equal(result.status, 500);
  assert.equal(result.data.ok, false);
  assert.doesNotMatch(result.data.error, /db unavailable/);
});

// CI supplies a disposable PostgreSQL service. No production database URL is accepted here.
const databaseUrl = process.env.TEST_CHAT_DATABASE_URL;
test('real PostgreSQL: concurrent sends, read races, rollback, privacy roles and resumable migration',
  { skip: !databaseUrl }, async t => {
    const { Pool } = require('pg');
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, max: 8, options: '-c role=game_chat_backend' });
    try {
      // Disposable database only; a nonempty game schema must never be overwritten.
      const exists = await admin.query("select to_regnamespace('game_private') as schema");
      assert.equal(exists.rows[0].schema, null, 'Use a fresh, disposable test database');
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$`);
      const migrations = fs.readdirSync(path.join(__dirname, '../supabase/migrations')).filter(x => x.endsWith('.sql')).sort();
      for (const file of migrations) await admin.query(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'));
      const store = createPostgresChatStore(pool), id = threadId('alice', 'bob');
      await t.test('atomic send and shared cooldown across workers and conversations', async () => {
        const message = { id, uid: 'alice', peerUid: 'bob', names: { alice: 'A', bob: 'B' }, text: "' 你好 <script>", current: 10000 };
        const results = await Promise.allSettled([store.send(message), createPostgresChatStore(pool).send(message)]);
        assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
        assert.equal(results.find(x => x.status === 'rejected').reason.status, 429);
        await assert.rejects(store.send({ ...message, id: threadId('alice', 'carol'), peerUid: 'carol', current: 11000 }), { status: 429 });
        assert.equal((await store.inbox('bob'))[0].unread.bob, 1);
        assert.deepEqual(await store.inbox('outsider'), []);
        assert.equal((await store.thread(id)).messages[0].text, message.text);
      });
      await t.test('opposing simultaneous sends preserve all unread counts and order', async () => {
        await Promise.all([
          store.send({ id, uid: 'alice', peerUid: 'bob', names: {}, text: 'a', current: 12000 }),
          store.send({ id, uid: 'bob', peerUid: 'alice', names: {}, text: 'b', current: 12000 })
        ]);
        const inbox = (await store.inbox('bob'))[0];
        assert.equal(inbox.unread.bob, 2);
        assert.equal(inbox.unread.alice, 1);
        const thread = await store.thread(id);
        assert.equal(thread.messages.length, 3);
        assert.equal(thread.lastMessageId, thread.messages[0].id);
        assert.ok(thread.messages[0].sentAt > thread.messages[1].sentAt);
        assert.equal(await store.read(id, 'outsider', thread.lastMessageId), false);
        assert.equal(await store.read(id, 'bob', thread.messages[1].id), false);
        assert.equal(await store.read(id, 'bob', thread.lastMessageId), true);
        assert.equal((await store.inbox('bob'))[0].unread.bob, 0);
        assert.equal((await store.inbox('alice'))[0].unread.alice, 1);
      });
      await t.test('a failed insert rolls back the thread and cooldown permission', async () => {
        const attempt = { id: threadId('carol', 'dave'), uid: 'carol', peerUid: 'dave', names: {}, text: '', current: 14000 };
        await assert.rejects(store.send(attempt));
        assert.deepEqual(await store.inbox('carol'), []);
        await store.send({ ...attempt, text: 'fixed' }); // same instant: cooldown insert must also have rolled back
      });
      await t.test('anonymous and ordinary authenticated roles cannot access private chat', async () => {
        const result = await admin.query(`SELECT has_schema_privilege('anon','game_private','USAGE') AS anon,
          has_schema_privilege('authenticated','game_private','USAGE') AS authenticated,
          has_table_privilege('game_chat_backend','game_private.friend_chat_threads','DELETE') AS deletes`);
        assert.deepEqual(result.rows[0], { anon: false, authenticated: false, deletes: false });
        const conn = await admin.connect();
        try {
          await conn.query('BEGIN'); await conn.query('SET LOCAL ROLE anon');
          await assert.rejects(conn.query('SELECT * FROM game_private.friend_chat_messages'), { code: '42501' });
        } finally { await conn.query('ROLLBACK'); conn.release(); }
      });
      await t.test('migration preserves IDs, detects changed content and extras, and safely resumes', async () => {
        await admin.query('TRUNCATE game_private.friend_chat_messages,game_private.friend_chat_threads,game_private.friend_chat_senders');
        const fixture = migrationFixture();
        const options = { source: fixture.source, pool, documentId: '__name__', output: { log() {} } };
        const dry = await migrate(options);
        assert.equal(dry.missing, 4); // one conversation + three messages
        assert.equal((await admin.query('SELECT count(*) FROM game_private.friend_chat_threads')).rows[0].count, '0');
        const report = await migrate({ ...options, action: 'execute' });
        assert.equal(report.missing, 0); assert.equal(report.messages, 3);
        assert.deepEqual(await migrate({ ...options, action: 'execute' }), report);
        await admin.query("DELETE FROM game_private.friend_chat_messages WHERE id='m3'");
        assert.deepEqual(await migrate({ ...options, action: 'execute' }), report, 'resume an interrupted copy');
        await pool.query("UPDATE game_private.friend_chat_messages SET text='changed' WHERE id='m1'");
        await assert.rejects(migrate({ ...options, action: 'verify' }), /Verification failed/);
        await assert.rejects(migrate({ ...options, action: 'execute' }), /refusing to overwrite/);
        fixture.messages[0].text = 'changed'; // expected fixture now agrees again
        await pool.query(`INSERT INTO game_private.friend_chat_messages (thread_id,id,sender_uid,text,sent_at)
          VALUES ($1,'extra','alice','extra',9)`, [fixture.id]);
        await assert.rejects(migrate({ ...options, action: 'verify' }), /Verification failed/);
        await admin.query("DELETE FROM game_private.friend_chat_messages WHERE id='extra'");
        fixture.row.updatedAt = 12345;
        await assert.rejects(migrate({ ...options, action: 'execute' }), /refusing to overwrite/);
      });
      await t.test('migration reads multiple bounded pages without omitting any message IDs', async () => {
        await admin.query('TRUNCATE game_private.friend_chat_messages,game_private.friend_chat_threads,game_private.friend_chat_senders');
        const fixture = migrationFixture();
        fixture.messages.splice(0, fixture.messages.length, ...Array.from({ length: 451 }, (_, i) => ({
          id: 'm' + String(i + 1).padStart(4, '0'), senderUid: 'alice', text: 'message ' + (i + 1), sentAt: i + 1
        })));
        Object.assign(fixture.row, { lastMessageId: 'm0451', lastText: 'message 451', updatedAt: 451 });
        const report = await migrate({ source: fixture.source, pool, documentId: '__name__', action: 'execute', output: { log() {} } });
        assert.equal(report.messages, 451);
        assert.equal(report.missing, 0);
        const thread = await store.thread(fixture.id);
        assert.equal(thread.messages.length, 60);
        assert.equal(thread.lastMessageId, 'm0451');
        assert.equal(thread.messages[0].text, 'message 451');
      });
    } finally { await pool.end(); await admin.end(); }
  });
function migrationFixture() {
  const id = threadId('alice', 'bob');
  const row = { memberUids: ['alice', 'bob'], names: { alice: 'A', bob: 'B' }, unread: { alice: 0, bob: 3 },
    lastMessageId: 'm3', lastText: 'third', lastSenderUid: 'alice', updatedAt: 3 };
  const messages = ['first', 'second', 'third'].map((text, i) => ({ id: 'm' + (i + 1), senderUid: 'alice', text, sentAt: i + 1 }));
  function query(docs) {
    let cursor = '', limit = 200;
    return { orderBy() { return this; }, limit(n) { limit = n; return this; }, startAfter(doc) { cursor = doc.id; return this; },
      async get() { return { docs: docs().filter(x => x.id > cursor).slice(0, limit) }; } };
  }
  const ref = { async get() { return { exists: true, data: () => row }; },
    collection() { return query(() => messages.map(x => ({ id: x.id, data: () => x }))); } };
  const source = { collection() { return query(() => [{ id, data: () => row, ref }]); } };
  return { source, row, messages, id };
}
