'use strict';

// Private messages use the shared BD document store (D1 after cutover).
// Firebase A Auth remains the identity authority; player data uses the A store.
const crypto = require('crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const CHAT_COLLECTION = 'allianceFriendChats';
const MAX_TEXT_LENGTH = 400;
const MAX_FRIENDS = 100;
const SEND_COOLDOWN_MS = 1500;
const sendTimes = new Map();
function apiError(message, status = 400) { return Object.assign(new Error(message), { status }); }
function safeUid(uid) {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}
function threadId(a, b) {
  if (!safeUid(a) || !safeUid(b) || a === b) throw apiError('好友代碼不正確');
  return crypto.createHash('sha256').update(JSON.stringify([a, b].sort())).digest('hex');
}
async function authenticate(req, a) {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!match) throw apiError('請先登入', 401);
  let decoded;
  try { decoded = await a.auth.verifyIdToken(match[1], true); }
  catch (_) { throw apiError('登入已失效，請重新登入', 401); }
  if (!safeUid(decoded?.uid) || decoded.aud !== PROJECT_IDS.A ||
      decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A)
    throw apiError('登入身分驗證失敗', 401);
  return decoded.uid;
}
function friendUids(data, uid) {
  return (Array.isArray(data?.friends) ? data.friends : [])
    .filter(value => safeUid(value) && value !== uid).slice(0, MAX_FRIENDS);
}
async function friendship(aDb, uid, peerUid) {
  if (!safeUid(peerUid) || peerUid === uid) throw apiError('請選擇仙盟好友');
  const [mine, theirs] = await Promise.all([
    aDb.collection('users').doc(uid).get(),
    aDb.collection('users').doc(peerUid).get()
  ]);
  const own = mine.exists ? mine.data() : null;
  const other = theirs.exists ? theirs.data() : null;
  if (!own || !other || !friendUids(own, uid).includes(peerUid) ||
      !friendUids(other, peerUid).includes(uid)) throw apiError('只有互為仙盟好友才能私聊', 403);
  return { own, other };
}
function timeMs(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function safeMessage(row) {
  return { id: row.id, senderUid: safeUid(row.senderUid), text: String(row.text || '').slice(0, MAX_TEXT_LENGTH),
    sentAt: timeMs(row.sentAt) };
}
function cleanChat(row, uid, friends) {
  if (!Array.isArray(row.memberUids) || row.memberUids.length !== 2 ||
      !row.memberUids.includes(uid)) return null;
  const peerUid = row.memberUids.find(x => x !== uid);
  if (!friends.includes(peerUid)) return null;
  return {
    peerUid, name: String(row.names?.[peerUid] || '修士').slice(0, 35),
    lastText: String(row.lastText || '').slice(0, MAX_TEXT_LENGTH),
    lastMessageId: String(row.lastMessageId || '').slice(0, 128),
    lastSenderUid: safeUid(row.lastSenderUid),
    updatedAt: timeMs(row.updatedAt), unread: Math.max(0, Math.min(9999, Number(row.unread?.[uid]) || 0))
  };
}
function createHandlers({ projects = adminProject, now = Date.now, cooldowns = sendTimes } = {}) {
  const withAuth = handler => async (req, res) => {
    res.set?.('Cache-Control', 'private, no-store');
    try {
      const a = projects('A');
      const uid = await authenticate(req, a);
      const bdDb = projects('BD').db;
      const result = await handler({ uid, aDb: a.db, bdDb, req });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const status = error?.status || (String(error?.message || '').includes('Missing server credential') ? 503 : 500);
      if (status >= 500) console.warn('[Alliance chat] Backend unavailable');
      return res.status(status).json({ ok: false, error: status >= 500 ? '仙盟私聊暫時無法使用' : error.message });
    }
  };
  const inbox = withAuth(async ({ uid, aDb, bdDb }) => {
    const player = await aDb.collection('users').doc(uid).get();
    const friends = friendUids(player.exists ? player.data() : null, uid);
    if (!friends.length) return { conversations: [], unread: 0 };
    // Single-field array-contains index; no additional composite index required.
    const rows = (await bdDb.collection(CHAT_COLLECTION).where('memberUids', 'array-contains', uid).limit(100).get()).docs.map(x => x.data());
    const candidates = rows.map(row => cleanChat(row, uid, friends)).filter(Boolean);
    // A friend may have removed you since the thread was created. Do not leak
    // even the preview / unread count without checking the current reciprocal link.
    const confirmed = await Promise.all(candidates.map(async row => {
      const peer = await aDb.collection('users').doc(row.peerUid).get();
      return peer.exists && friendUids(peer.data(), row.peerUid).includes(uid) ? row : null;
    }));
    const conversations = confirmed.filter(Boolean).sort((x, y) => y.updatedAt - x.updatedAt);
    return { conversations, unread: conversations.reduce((n, x) => n + x.unread, 0) };
  });
  const thread = withAuth(async ({ uid, aDb, bdDb, req }) => {
    const peerUid = String(req.body?.peerUid || '');
    const peers = await friendship(aDb, uid, peerUid);
    const ref = bdDb.collection(CHAT_COLLECTION).doc(threadId(uid, peerUid));
    const recent = await ref.collection('messages').orderBy('sentAt', 'desc').limit(60).get();
    return { peerUid, peerName: String(peers.other.displayName || '修士').slice(0, 35),
      lastMessageId: recent.docs[0]?.id || '',
      messages: recent.docs.map(x => safeMessage({ id: x.id, ...x.data() })).reverse() };
  });
  const send = withAuth(async ({ uid, aDb, bdDb, req }) => {
    const peerUid = String(req.body?.peerUid || '');
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > MAX_TEXT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      throw apiError('訊息需為 1～400 字的純文字');
    const { own, other } = await friendship(aDb, uid, peerUid);
    const current = now();
    if (current - (cooldowns.get(uid) || 0) < SEND_COOLDOWN_MS) throw apiError('請稍候再發送訊息', 429);
    const id = threadId(uid, peerUid);
    const ref = bdDb.collection(CHAT_COLLECTION).doc(id);
    const messageRef = ref.collection('messages').doc();
    await bdDb.runTransaction(async tx => {
      const existing = await tx.get(ref);
      const row = existing.exists ? existing.data() : {};
      const unread = { ...(row.unread || {}) };
      unread[uid] = Math.max(0, Number(unread[uid]) || 0); // sending does not silently mark incoming messages as read
      unread[peerUid] = Math.min(9999, (Number(unread[peerUid]) || 0) + 1);
      tx.set(ref, { memberUids: [uid, peerUid].sort(),
        names: { [uid]: String(own.displayName || '修士').slice(0, 35),
          [peerUid]: String(other.displayName || '修士').slice(0, 35) },
        unread, lastMessageId: messageRef.id, lastText: text,
        lastSenderUid: uid, updatedAt: current }, { merge: true });
      tx.create(messageRef, { senderUid: uid, text, sentAt: current });
    });
    cooldowns.set(uid, current);
    if (cooldowns.size > 5000) {
      for (const [key, value] of cooldowns) if (current - value > 60000) cooldowns.delete(key);
    }
    return { message: { id: messageRef.id, senderUid: uid, text, sentAt: current } };
  });
  const read = withAuth(async ({ uid, aDb, bdDb, req }) => {
    const peerUid = String(req.body?.peerUid || '');
    const lastMessageId = String(req.body?.lastMessageId || '');
    await friendship(aDb, uid, peerUid);
    const ref = bdDb.collection(CHAT_COLLECTION).doc(threadId(uid, peerUid));
    let cleared = false;
    await bdDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      // A new message might arrive between loading the thread and marking read.
      if (data.lastMessageId !== lastMessageId || !data.memberUids?.includes(uid)) return;
      if (Number(data.unread?.[uid]) > 0)
        tx.set(ref, { unread: { ...(data.unread || {}), [uid]: 0 } }, { merge: true });
      cleared = true;
    });
    return { cleared };
  });
  return { inbox, thread, send, read };
}
function registerFriendChatApi(app, options) {
  const h = createHandlers(options);
  app.post('/api/alliance-chat/inbox', h.inbox);
  app.post('/api/alliance-chat/thread', h.thread);
  app.post('/api/alliance-chat/send', h.send);
  app.post('/api/alliance-chat/read', h.read);
}
module.exports = registerFriendChatApi;
module.exports.createHandlers = createHandlers;
module.exports.threadId = threadId;
module.exports.cleanChat = cleanChat;
module.exports.friendUids = friendUids;
module.exports.CHAT_COLLECTION = CHAT_COLLECTION;
