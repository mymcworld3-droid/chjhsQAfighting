'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHandlers, threadId, CHAT_COLLECTION } = require('../alliance-friend-chat-api.cjs');

function mockProjects() {
  const players = new Map([
    ['alice', { displayName: '愛麗絲', friends: ['bob'] }],
    ['bob', { displayName: '波波', friends: ['alice'] }],
    ['outsider', { displayName: '陌生人', friends: [] }]
  ]);
  const docs = new Map(), messages = new Map();
  let messageCounter = 0;
  const playersDb = { collection(name) {
    assert.equal(name, 'users');
    return { doc(uid) { return { async get() {
      return { exists: players.has(uid), data: () => players.get(uid) };
    } }; } };
  } };
  function ref(id) {
    return {
      id,
      async get() { return { exists: docs.has(id), data: () => docs.get(id) }; },
      collection(name) {
        assert.equal(name, 'messages');
        return {
          doc() {
            const itemId = 'msg-' + (++messageCounter);
            return { id: itemId, parentId: id, message: true };
          },
          orderBy(field, direction) {
            assert.equal(field, 'sentAt'); assert.equal(direction, 'desc');
            return { limit(n) { return { async get() {
              return { docs: (messages.get(id) || []).slice().sort((a, b) => b.data().sentAt - a.data().sentAt).slice(0, n) };
            } }; } };
          }
        };
      }
    };
  }
  const bdDb = {
    collection(name) {
      assert.equal(name, CHAT_COLLECTION);
      return {
        doc: ref,
        where(field, condition, value) {
          assert.equal(field, 'memberUids'); assert.equal(condition, 'array-contains');
          return { limit(n) { return { async get() {
            return { docs: [...docs].filter(([, data]) => data.memberUids.includes(value))
              .slice(0, n).map(([id, data]) => ({ id, data: () => data })) };
          } }; } };
        }
      };
    },
    async runTransaction(fn) {
      return fn({
        get: r => r.get(),
        set(r, change, options) {
          const existing = docs.get(r.id) || {};
          docs.set(r.id, options?.merge ? { ...existing, ...change } : change);
        },
        create(r, data) {
          const list = messages.get(r.parentId) || [];
          list.push({ id: r.id, data: () => data });
          messages.set(r.parentId, list);
        }
      });
    }
  };
  return { players, docs, messages,
    projects: role => role === 'A' ? {
      auth: { async verifyIdToken(token) {
        if (token === 'invalid') throw Error('expired');
        return { uid: token, aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' };
      } }, db: playersDb
    } : { db: bdDb }
  };
}
async function request(handler, uid, body = {}) {
  const output = {};
  const req = {
    get(key) { assert.equal(key, 'authorization'); return uid ? 'Bearer ' + uid : ''; },
    body
  };
  const res = {
    set(key, value) { output.headers ||= {}; output.headers[key] = value; return this; },
    status(status) { output.status = status; return this; },
    json(json) { output.data = json; return this; }
  };
  await handler(req, res);
  return output;
}
test('conversation IDs are private, symmetric and unique without exposing participant UIDs', () => {
  const a = threadId('alice', 'bob');
  assert.equal(a, threadId('bob', 'alice'));
  assert.equal(a.length, 64);
  assert.notEqual(a, threadId('alice', 'outsider'));
  assert.doesNotMatch(a, /alice|bob/);
  assert.throws(() => threadId('alice', 'alice'));
});
test('both users must mutually appear in Firebase A friends before BD private data is accessible', async () => {
  const context = mockProjects();
  const h = createHandlers({ projects: context.projects, now: () => 10_000, cooldowns: new Map() });
  assert.equal((await request(h.send, 'outsider', { peerUid: 'alice', text: '陌生人' })).status, 403);
  assert.equal((await request(h.thread, 'outsider', { peerUid: 'alice' })).status, 403);
  assert.equal((await request(h.send, '', { peerUid: 'bob', text: 'test' })).status, 401);
  assert.equal((await request(h.send, 'invalid', { peerUid: 'bob', text: 'test' })).status, 401);
  context.players.get('bob').friends = [];
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: '只單向好友' })).status, 403);
});
test('one friend sends, recipient sees unread, opening and marking read clears only the right thread', async () => {
  const context = mockProjects();
  let clock = 10000;
  const h = createHandlers({ projects: context.projects, now: () => clock, cooldowns: new Map() });
  const sent = await request(h.send, 'alice', { peerUid: 'bob', text: '<script>alert(1)</script>' });
  assert.equal(sent.data.ok, true);
  assert.equal(sent.data.message.text, '<script>alert(1)</script>');
  const bobInbox = await request(h.inbox, 'bob');
  assert.equal(bobInbox.data.unread, 1);
  assert.equal(bobInbox.data.conversations[0].peerUid, 'alice');
  const aliceInbox = await request(h.inbox, 'alice');
  assert.equal(aliceInbox.data.unread, 0);
  const bobThread = await request(h.thread, 'bob', { peerUid: 'alice' });
  assert.equal(bobThread.data.messages.length, 1);
  assert.equal(bobThread.data.messages[0].senderUid, 'alice');
  assert.equal((await request(h.read, 'bob', { peerUid: 'alice', lastMessageId: 'wrong' })).data.cleared, false);
  assert.equal((await request(h.inbox, 'bob')).data.unread, 1);
  assert.equal((await request(h.read, 'bob', { peerUid: 'alice', lastMessageId: bobThread.data.lastMessageId })).data.cleared, true);
  assert.equal((await request(h.inbox, 'bob')).data.unread, 0);
  clock += 2000;
  await request(h.send, 'alice', { peerUid: 'bob', text: '第二則' });
  assert.equal((await request(h.inbox, 'bob')).data.unread, 1);
  assert.equal((await request(h.read, 'bob', { peerUid: 'alice', lastMessageId: bobThread.data.lastMessageId })).data.cleared, false,
    'stale client read must never discard a new incoming message');
});
test('message length, send cooldown and account isolation are enforced by server', async () => {
  const context = mockProjects();
  let clock = 3000;
  const h = createHandlers({ projects: context.projects, now: () => clock, cooldowns: new Map() });
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: ' ' })).status, 400);
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: 'x'.repeat(401) })).status, 400);
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: 'a' })).data.ok, true);
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: 'b' })).status, 429);
  clock += 1600;
  assert.equal((await request(h.send, 'alice', { peerUid: 'bob', text: 'c' })).data.ok, true);
  const outsiderInbox = await request(h.inbox, 'outsider');
  assert.equal(outsiderInbox.data.unread, 0);
  assert.deepEqual(outsiderInbox.data.conversations, []);
});
test('UI uses safe textContent and lights navigation only for private friend messages', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/cultivation/alliance-friend-chat.js'), 'utf8');
  const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles/alliance-chat.css'), 'utf8');
  assert.match(ui, /text\.textContent = item\.text/);
  assert.match(ui, /alliance-chat-nav-unread', total > 0/);
  assert.match(ui, /alliance-global-unread', state\.globalUnread/);
  assert.doesNotMatch(ui, /alliance-chat-nav-unread', state\.globalUnread/);
  assert.match(ui, /alliance-chat-seen:|xiuxian-global-chat-seen:/);
  assert.match(ui, /request\('read', \{ peerUid, lastMessageId: state\.lastMessageId \}\)/);
  assert.match(ui, /state\.uid !== uid|uid !== currentUid\(\)/);
  assert.match(legacy, /unread\.dataset\.friendChatUnread = d\.id/); // selector uses DOM attr, no inline user scripts
  assert.match(legacy, /alliance-chat-nav-unread/);
  assert.match(legacy, /alliance-global-unread/);
  assert.match(main, /cultivation\/alliance-friend-chat\.js/);
  assert.match(server, /registerFriendChatApi\(app\)/);
  assert.match(css, /@media\(max-width:600px\)/);
});
