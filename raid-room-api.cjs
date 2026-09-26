'use strict';

const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const COLLECTION = 'raidRooms';
const MAX_MEMBERS = 4;
const STALE_MS = 45000;
const ROOM_TTL_MS = 30 * 60 * 1000;
const RAID_ROOM_VERSION = 2;
const RAID_BOSS_ID = 'shen-qingshuang';
const BOSS_ACTION_INTERVAL_MS = 18000;

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function membersOf(room) {
  return room?.members && typeof room.members === 'object' ? room.members : {};
}
function memberOnline(member) {
  return !!member && member.online !== false && now() - finite(member.heartbeatAtMs) <= STALE_MS;
}
function activeMembers(room) {
  return Object.values(membersOf(room)).filter(memberOnline);
}
function roomUsable(room) {
  if (!room || room.status !== 'waiting') return false;
  if (now() - finite(room.createdAtMs) > ROOM_TTL_MS) return false;
  return activeMembers(room).length < MAX_MEMBERS;
}
function safeRoomId(value) {
  const roomId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(roomId) ? roomId : '';
}
function safeRoomCode(value) {
  const roomCode = String(value || '').trim().toUpperCase();
  return /^[A-Z2-9]{6}$/.test(roomCode) ? roomCode : '';
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function cleanString(value, max = 160) {
  return String(value || '').slice(0, max);
}
function memberSnapshot(player, uid, host = false) {
  return {
    uid,
    name: cleanString(player?.name || '無名修士', 40),
    portrait: cleanString(player?.portrait || '', 240),
    combatPower: Math.max(0, Math.round(finite(player?.combatPower))),
    atk: Math.max(1, Math.round(finite(player?.atk, 200))),
    hp: Math.max(1, Math.round(finite(player?.hp, player?.maxHp || 1000))),
    maxHp: Math.max(1, Math.round(finite(player?.maxHp, 1000))),
    ready: false,
    alive: true,
    online: true,
    host,
    damage: 0,
    correct: 0,
    attempts: 0,
    lastActionId: 0,
    lastBossActionSeen: 0,
    joinedAtMs: now(),
    heartbeatAtMs: now()
  };
}
function publicRoom(roomId, room) {
  if (!room) return null;
  return { id: roomId, ...room };
}
function requireMember(room, uid) {
  const member = membersOf(room)[uid];
  if (!member) {
    const error = new Error('你不在這個團本隊伍');
    error.status = 403;
    throw error;
  }
  return member;
}
async function uniqueCode(db) {
  for (let i = 0; i < 8; i += 1) {
    const candidate = makeCode();
    const snap = await db.collection(COLLECTION).where('code', '==', candidate).limit(1).get();
    if (snap.empty) return candidate;
  }
  throw new Error('無法建立唯一隊伍代碼');
}
async function createRoom(db, uid, player) {
  const ref = db.collection(COLLECTION).doc();
  const room = {
    version: RAID_ROOM_VERSION,
    code: await uniqueCode(db),
    status: 'waiting',
    hostUid: uid,
    createdAt: new Date(),
    createdAtMs: now(),
    startedAtMs: 0,
    finishedAtMs: 0,
    bossId: RAID_BOSS_ID,
    bossHp: 0,
    bossMaxHp: 0,
    bossBaseAttack: 0,
    bossPhase: 1,
    bossActionCount: 0,
    lastBossAction: null,
    maxMembers: MAX_MEMBERS,
    members: { [uid]: memberSnapshot(player, uid, true) }
  };
  await ref.set(room);
  return { roomId: ref.id, room: publicRoom(ref.id, room) };
}
async function joinWaitingRoom(db, uid, roomId, player) {
  const ref = db.collection(COLLECTION).doc(roomId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('隊伍已不存在'), { status: 404 });
    const room = snap.data() || {};
    const members = { ...membersOf(room) };
    if (!roomUsable(room)) throw Object.assign(new Error('隊伍已滿或已開始'), { status: 409 });
    if (!members[uid] && Object.keys(members).length >= MAX_MEMBERS) {
      throw Object.assign(new Error('隊伍已滿或已開始'), { status: 409 });
    }
    members[uid] = members[uid]
      ? { ...members[uid], online: true, heartbeatAtMs: now() }
      : memberSnapshot(player, uid, false);
    tx.update(ref, { members });
    return { roomId, room: publicRoom(roomId, { ...room, members }) };
  });
}
async function findOrCreate(db, uid, player) {
  const snap = await db.collection(COLLECTION).where('status', '==', 'waiting').limit(24).get();
  const candidates = snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(roomUsable)
    .sort((a, b) => activeMembers(b).length - activeMembers(a).length || finite(a.createdAtMs) - finite(b.createdAtMs));
  for (const candidate of candidates) {
    try {
      return await joinWaitingRoom(db, uid, candidate.id, player);
    } catch (error) {
      if (![404, 409].includes(error?.status)) throw error;
    }
  }
  return createRoom(db, uid, player);
}
async function joinByCode(db, uid, roomCode, player) {
  const target = safeRoomCode(roomCode);
  if (!target) throw Object.assign(new Error('請輸入正確的 6 碼隊伍代碼'), { status: 400 });
  const snap = await db.collection(COLLECTION).where('code', '==', target).limit(5).get();
  const hit = snap.docs.find(item => roomUsable(item.data()));
  if (!hit) throw Object.assign(new Error('找不到可加入的隊伍'), { status: 404 });
  return joinWaitingRoom(db, uid, hit.id, player);
}

async function verifyRequest(req, resolveA) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
  if (!bearer) throw Object.assign(new Error('請先登入後再進入團本'), { status: 401 });
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
  return verified.uid;
}

function createHandler({
  resolveA = () => adminProject('A'),
  resolveC = () => adminProject('C'),
  logger = console
} = {}) {
  return async function raidRoomHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    let uid, db;
    try {
      uid = await verifyRequest(req, resolveA);
      db = resolveC().db;
    } catch (error) {
      const status = error?.status || 503;
      if (status >= 500) logger.error('[Raid room] Firebase Admin unavailable:', error?.message || error);
      return res.status(status).json({ ok: false, error: error?.message || '團本服務尚未完成設定' });
    }

    const action = String(req.body?.action || '').trim();
    try {
      if (action === 'create') {
        const result = await createRoom(db, uid, req.body?.player || {});
        return res.json({ ok: true, ...result });
      }
      if (action === 'quick') {
        const result = await findOrCreate(db, uid, req.body?.player || {});
        return res.json({ ok: true, ...result });
      }
      if (action === 'join-code') {
        const result = await joinByCode(db, uid, req.body?.roomCode, req.body?.player || {});
        return res.json({ ok: true, ...result });
      }

      const roomId = safeRoomId(req.body?.roomId);
      if (!roomId) return res.status(400).json({ ok: false, error: '團本房間代碼無效' });
      const ref = db.collection(COLLECTION).doc(roomId);

      if (action === 'get') {
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: '團本房間不存在' });
        const room = snap.data() || {};
        requireMember(room, uid);
        return res.json({ ok: true, room: publicRoom(roomId, room) });
      }

      if (action === 'reconnect') {
        const result = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const room = snap.data() || {};
          const members = { ...membersOf(room) };
          if (!members[uid] || ['won', 'lost', 'closed'].includes(room.status)) return null;
          members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
          tx.update(ref, { members });
          return publicRoom(roomId, { ...room, members });
        });
        return res.json({ ok: true, roomId: result ? roomId : null, room: result });
      }

      if (action === 'ready') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('隊伍不存在'), { status: 404 });
          const current = snap.data() || {};
          if (current.status !== 'waiting') throw Object.assign(new Error('團本已開始'), { status: 409 });
          const members = { ...membersOf(current) };
          requireMember(current, uid);
          members[uid] = { ...members[uid], ready: req.body?.ready === true, online: true, heartbeatAtMs: now() };
          tx.update(ref, { members });
          return publicRoom(roomId, { ...current, members });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'start') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('隊伍不存在'), { status: 404 });
          const current = snap.data() || {};
          requireMember(current, uid);
          if (current.hostUid !== uid) throw Object.assign(new Error('只有隊長可以開始'), { status: 403 });
          if (current.status !== 'waiting') return publicRoom(roomId, current);
          const members = activeMembers(current);
          if (!members.length || members.some(member => !member.ready)) {
            throw Object.assign(new Error('仍有隊員尚未準備'), { status: 409 });
          }
          const boss = req.body?.boss || {};
          const update = {
            status: 'active',
            startedAtMs: now(),
            bossHp: Math.max(1800, Math.round(finite(boss.maxHp, 1800))),
            bossMaxHp: Math.max(1800, Math.round(finite(boss.maxHp, 1800))),
            bossBaseAttack: Math.max(1, Math.round(finite(boss.baseAttack, 100))),
            bossPhase: 1,
            bossActionCount: 0,
            lastBossAction: null
          };
          tx.update(ref, update);
          return publicRoom(roomId, { ...current, ...update });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'heartbeat') {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const current = snap.data() || {};
          const members = { ...membersOf(current) };
          if (!members[uid]) return;
          members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
          tx.update(ref, { members });
        });
        return res.json({ ok: true });
      }

      if (action === 'player-action') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('團本房間不存在'), { status: 404 });
          const current = snap.data() || {};
          if (current.status !== 'active') return publicRoom(roomId, current);
          const members = { ...membersOf(current) };
          const me = requireMember(current, uid);
          if (me.alive === false) return publicRoom(roomId, current);
          const id = Math.max(1, Math.floor(finite(req.body?.actionId, 1)));
          if (id <= finite(me.lastActionId)) return publicRoom(roomId, current);
          const correct = req.body?.correct === true;
          const dealt = correct ? Math.max(0, Math.round(finite(req.body?.damage))) : 0;
          const nextHp = Math.max(0, Math.round(finite(req.body?.hp, me.hp)));
          const nextBossHp = Math.max(0, Math.round(finite(current.bossHp)) - dealt);
          members[uid] = {
            ...me,
            hp: nextHp,
            alive: nextHp > 0,
            damage: Math.max(0, Math.round(finite(me.damage))) + dealt,
            correct: Math.max(0, Math.round(finite(me.correct))) + (correct ? 1 : 0),
            attempts: Math.max(0, Math.round(finite(me.attempts))) + 1,
            lastActionId: id,
            online: true,
            heartbeatAtMs: now()
          };
          const update = { members, bossHp: nextBossHp };
          if (nextBossHp <= 0) {
            update.status = 'won';
            update.finishedAtMs = now();
          }
          tx.update(ref, update);
          return publicRoom(roomId, { ...current, ...update });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'boss-defense' || action === 'member-state') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(new Error('團本房間不存在'), { status: 404 });
          const current = snap.data() || {};
          if (action === 'boss-defense' && current.status !== 'active') return publicRoom(roomId, current);
          const members = { ...membersOf(current) };
          const me = requireMember(current, uid);
          const seen = Math.max(0, Math.floor(finite(req.body?.bossActionSeen)));
          if (seen <= finite(me.lastBossActionSeen)) return publicRoom(roomId, current);
          const nextHp = Math.max(0, Math.round(finite(req.body?.hp, me.hp)));
          const reflected = action === 'boss-defense' ? Math.max(0, Math.round(finite(req.body?.reflectedDamage))) : 0;
          const nextBossHp = Math.max(0, Math.round(finite(current.bossHp)) - reflected);
          members[uid] = {
            ...me,
            hp: nextHp,
            alive: nextHp > 0,
            damage: Math.max(0, Math.round(finite(me.damage))) + reflected,
            lastBossActionSeen: Math.max(finite(me.lastBossActionSeen), seen),
            online: true,
            heartbeatAtMs: now()
          };
          const alive = Object.values(members).some(member => member?.alive !== false && finite(member?.hp) > 0);
          const update = action === 'boss-defense' ? { members, bossHp: nextBossHp } : { members };
          if (action === 'boss-defense' && nextBossHp <= 0) {
            update.status = 'won';
            update.finishedAtMs = now();
          } else if (!alive && current.status === 'active') {
            update.status = 'lost';
            update.finishedAtMs = now();
          }
          tx.update(ref, update);
          return publicRoom(roomId, { ...current, ...update });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'advance-boss') {
        const room = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const current = snap.data() || {};
          requireMember(current, uid);
          if (current.status !== 'active' || current.hostUid !== uid) return publicRoom(roomId, current);
          const currentCount = Math.max(0, Math.floor(finite(current.bossActionCount)));
          const nextActionAtMs = Math.max(0, finite(current.startedAtMs)) + (currentCount + 1) * BOSS_ACTION_INTERVAL_MS;
          // Authoritative server-side cadence: repeated/early client requests cannot
          // fast-forward the boss timeline while the client is waiting for room polling.
          if (!current.startedAtMs || now() < nextActionAtMs) return publicRoom(roomId, current);
          const nextCount = currentCount + 1;
          const intent = req.body?.intent || {};
          const bossAction = {
            id: nextCount,
            name: cleanString(intent.name || '試劍', 40),
            cue: cleanString(intent.cue || '', 160),
            kind: cleanString(intent.kind || 'normal', 24),
            damage: Math.max(0, Math.round(finite(intent.damage))),
            issuedAtMs: now()
          };
          const update = { bossActionCount: nextCount, lastBossAction: bossAction };
          tx.update(ref, update);
          return publicRoom(roomId, { ...current, ...update });
        });
        return res.json({ ok: true, room });
      }

      if (action === 'leave') {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const current = snap.data() || {};
          const members = { ...membersOf(current) };
          if (!members[uid]) return;
          members[uid] = { ...members[uid], online: false, ready: false, host: false, heartbeatAtMs: now() };
          let hostUid = current.hostUid;
          if (hostUid === uid) {
            const replacement = Object.values(members).find(member => member?.uid !== uid && memberOnline(member));
            hostUid = replacement?.uid || uid;
            if (replacement) members[replacement.uid] = { ...replacement, host: true };
          }
          const update = { members, hostUid };
          if (!Object.values(members).some(memberOnline)) update.status = 'closed';
          tx.update(ref, update);
        });
        return res.json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: '未知的團本房間操作' });
    } catch (error) {
      const status = error?.status || 503;
      logger.error('[Raid room]', action || 'unknown', error?.code || error?.message || error);
      return res.status(status).json({ ok: false, error: error?.message || '團本房間暫時無法使用' });
    }
  };
}

module.exports = function registerRaidRoomApi(app) {
  app.post('/api/raid/room', createHandler());
};
module.exports.__test = {
  COLLECTION, MAX_MEMBERS, STALE_MS, ROOM_TTL_MS, RAID_ROOM_VERSION, RAID_BOSS_ID,
  BOSS_ACTION_INTERVAL_MS,
  finite, membersOf, memberOnline, activeMembers, roomUsable, safeRoomId, safeRoomCode,
  memberSnapshot, createHandler
};
