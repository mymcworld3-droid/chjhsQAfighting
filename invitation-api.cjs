'use strict';

const crypto = require('node:crypto');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { playerRepository, battleRepository } = require('./server-repositories.cjs');

const INVITE_TTL_MS = 2 * 60 * 1000;
const ONLINE_TTL_MS = 40 * 1000;
const LISTEN_TIMEOUT_MS = 25 * 1000;
const MAX_TARGETS = 30;
const MAX_QUEUE = 20;

function safeText(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}
function safeRoomId(value) {
  const id = safeText(value, 180);
  return /^[A-Za-z0-9_-]{8,180}$/.test(id) ? id : '';
}
function safeRaidCode(value) {
  const code = safeText(value, 12).toUpperCase();
  return /^[A-Z2-9]{6}$/.test(code) ? code : '';
}
function uniqueUids(values, exclude = '') {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => safeText(value, 160))
    .filter(value => value && value !== exclude))].slice(0, MAX_TARGETS);
}

async function verifyRequest(req, resolveA) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) throw Object.assign(new Error('請先登入後再使用邀請功能'), { status: 401 });
  const a = resolveA();
  let verified;
  try {
    verified = await a.auth.verifyIdToken(bearer[1], true);
  } catch (_) {
    throw Object.assign(new Error('登入狀態已失效，請重新登入'), { status: 401 });
  }
  if (!verified?.uid || verified.aud !== PROJECT_IDS.A ||
      verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    throw Object.assign(new Error('登入身分驗證失敗'), { status: 401 });
  }
  return { uid: verified.uid, a };
}

function createInvitationHub({
  now = Date.now,
  ttlMs = INVITE_TTL_MS,
  onlineTtlMs = ONLINE_TTL_MS,
  listenTimeoutMs = LISTEN_TIMEOUT_MS
} = {}) {
  const queues = new Map();
  const seenAt = new Map();
  const waiters = new Map();

  function prune(uid) {
    const current = now();
    const queue = (queues.get(uid) || []).filter(item => current - Number(item.createdAtMs || 0) < ttlMs);
    if (queue.length) queues.set(uid, queue.slice(-MAX_QUEUE));
    else queues.delete(uid);
  }

  function markOnline(uid) {
    seenAt.set(uid, now());
  }

  function isOnline(uid) {
    return now() - Number(seenAt.get(uid) || 0) <= onlineTtlMs;
  }

  function take(uid) {
    prune(uid);
    const items = queues.get(uid) || [];
    queues.delete(uid);
    return items;
  }

  function flush(uid) {
    const set = waiters.get(uid);
    if (!set?.size) return false;
    const items = take(uid);
    if (!items.length) return false;
    waiters.delete(uid);
    for (const waiter of set) waiter.finish(items);
    return true;
  }

  function push(uid, invite) {
    prune(uid);
    const queue = queues.get(uid) || [];
    queue.push(invite);
    queues.set(uid, queue.slice(-MAX_QUEUE));
    flush(uid);
  }

  function remove(uid, inviteId) {
    prune(uid);
    const id = safeText(inviteId, 120);
    if (!id) return;
    const next = (queues.get(uid) || []).filter(item => item.id !== id);
    if (next.length) queues.set(uid, next);
    else queues.delete(uid);
  }

  function listen(uid, res) {
    markOnline(uid);
    const immediate = take(uid);
    if (immediate.length) {
      res.json({ ok: true, invitations: immediate });
      return () => {};
    }

    let finished = false;
    let timer = null;
    const set = waiters.get(uid) || new Set();
    const waiter = {
      finish(items = []) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        set.delete(waiter);
        if (!set.size) waiters.delete(uid);
        if (!res.headersSent) res.json({ ok: true, invitations: items });
      }
    };
    set.add(waiter);
    waiters.set(uid, set);
    timer = setTimeout(() => waiter.finish([]), listenTimeoutMs);
    const close = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      set.delete(waiter);
      if (!set.size) waiters.delete(uid);
    };
    res.once?.('close', close);
    return close;
  }

  return Object.freeze({ markOnline, isOnline, push, remove, listen, take });
}

async function validateRoom(invitation, uid, { a, c }) {
  const roomId = safeRoomId(invitation?.roomId || invitation?.raidRoomId);
  if (!roomId) throw Object.assign(new Error('邀請房間代碼無效'), { status: 400 });

  if (Number(invitation?.raidVersion) > 0) {
    const code = safeRaidCode(invitation?.raidCode);
    if (!code) throw Object.assign(new Error('團本邀請代碼無效'), { status: 400 });
    const snap = await c.db.collection('raidRooms').doc(roomId).get();
    const room = snap.exists ? (snap.data() || {}) : null;
    if (!room || room.status !== 'waiting' || room.hostUid !== uid || room.code !== code) {
      throw Object.assign(new Error('團本房間已失效或你不是房主'), { status: 409 });
    }
    return { raidVersion: Number(invitation.raidVersion), raidCode: code, raidRoomId: roomId };
  }

  if (Number(invitation?.modeVersion) > 0) {
    const snap = await c.db.collection('rooms').doc(roomId).get();
    const room = snap.exists ? (snap.data() || {}) : null;
    if (!room || room.status !== 'waiting' || room.guest || room.host?.uid !== uid ||
        Number(room.modeVersion) !== Number(invitation.modeVersion)) {
      throw Object.assign(new Error('鬥法房間已失效或你不是房主'), { status: 409 });
    }
    return { roomId, modeVersion: Number(invitation.modeVersion) };
  }

  // Legacy battle rooms still live in A. This path exists only so old UI code
  // never falls back to users/{uid}/invitations in Firestore.
  const snap = await a.db.collection('rooms').doc(roomId).get();
  const room = snap.exists ? (snap.data() || {}) : null;
  if (!room || room.status !== 'waiting' || room.guest || room.host?.uid !== uid) {
    throw Object.assign(new Error('對戰房間已失效或你不是房主'), { status: 409 });
  }
  return { roomId };
}

function registerInvitationApi(app, {
  resolveA = () => playerRepository.resolve(),
  resolveC = () => battleRepository.resolve(),
  hub = createInvitationHub(),
  logger = console
} = {}) {
  app.post('/api/invitations/listen', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { uid } = await verifyRequest(req, resolveA);
      hub.listen(uid, res);
    } catch (error) {
      return res.status(error?.status || 503).json({ ok: false, error: error?.message || '邀請監聽服務暫時無法使用' });
    }
  });

  app.post('/api/invitations/send', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let identity, c;
    try {
      identity = await verifyRequest(req, resolveA);
      c = resolveC();
    } catch (error) {
      return res.status(error?.status || 503).json({ ok: false, error: error?.message || '邀請服務尚未完成設定' });
    }

    try {
      const senderSnap = await identity.a.db.collection('users').doc(identity.uid).get();
      if (!senderSnap.exists) return res.status(404).json({ ok: false, error: '找不到玩家資料' });
      const sender = senderSnap.data() || {};
      const friends = new Set(uniqueUids(sender.friends, identity.uid));
      const requested = uniqueUids(req.body?.friendUids, identity.uid).filter(uid => friends.has(uid));
      const room = await validateRoom(req.body?.invitation || {}, identity.uid, { a: identity.a, c });

      const online = requested.filter(uid => hub.isOnline(uid));
      const createdAtMs = Date.now();
      const invite = {
        id: crypto.randomUUID(),
        ...room,
        hostUid: identity.uid,
        hostName: safeText(sender.displayName || sender.profile?.displayName || '修士', 64),
        hostAvatar: safeText(sender.equipped?.avatar, 512),
        hostFrame: safeText(sender.equipped?.frame, 512),
        createdAtMs,
        expiresAtMs: createdAtMs + INVITE_TTL_MS
      };
      for (const uid of online) hub.push(uid, invite);
      return res.json({ ok: true, sentTo: online });
    } catch (error) {
      const status = error?.status || 503;
      if (status >= 500) logger.error('[Invitation server] send failed:', error?.message || error);
      return res.status(status).json({ ok: false, error: error?.message || '邀請發送失敗' });
    }
  });

  app.post('/api/invitations/remove', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { uid } = await verifyRequest(req, resolveA);
      hub.remove(uid, req.body?.inviteId);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error?.status || 503).json({ ok: false, error: error?.message || '邀請移除失敗' });
    }
  });

  return hub;
}

module.exports = registerInvitationApi;
module.exports.__test = {
  INVITE_TTL_MS, ONLINE_TTL_MS, LISTEN_TIMEOUT_MS, uniqueUids,
  createInvitationHub, validateRoom, verifyRequest
};
