import {
  collection, doc, getDocs, limit, onSnapshot, query, runTransaction,
  serverTimestamp, updateDoc, where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ensureSecondaryFirebaseAuth } from './firebase-projects.js';

const COLLECTION = 'raidRooms';
const MAX_MEMBERS = 4;
const STALE_MS = 45000;
const ROOM_TTL_MS = 30 * 60 * 1000;
const STORAGE_KEY = 'xiuxian:raid-room:v2';

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function memberSnapshot(player, uid, host = false) {
  return {
    uid,
    name: String(player?.name || '無名修士').slice(0, 40),
    portrait: String(player?.portrait || '').slice(0, 240),
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
function membersOf(room) {
  return room?.members && typeof room.members === 'object' ? room.members : {};
}
function activeMembers(room) {
  return Object.values(membersOf(room)).filter(member => member && member.online !== false);
}
function roomUsable(room) {
  if (!room || room.status !== 'waiting') return false;
  if (now() - finite(room.createdAtMs) > ROOM_TTL_MS) return false;
  return activeMembers(room).length < MAX_MEMBERS;
}
async function services() {
  return ensureSecondaryFirebaseAuth('C');
}
export async function ensureRaidRoomAuth() {
  const svc = await services();
  return { uid: svc.auth.currentUser?.uid || '', db: svc.db };
}
export async function createRaidRoom(player) {
  const { uid, db } = await ensureRaidRoomAuth();
  if (!uid) throw new Error('團本登入失敗');
  const ref = doc(collection(db, COLLECTION));
  const room = {
    version: 2,
    code: code(),
    status: 'waiting',
    hostUid: uid,
    createdAt: serverTimestamp(),
    createdAtMs: now(),
    startedAtMs: 0,
    finishedAtMs: 0,
    bossId: 'shen-qingshuang',
    bossHp: 0,
    bossMaxHp: 0,
    bossBaseAttack: 0,
    bossPhase: 1,
    bossActionCount: 0,
    lastBossAction: null,
    maxMembers: MAX_MEMBERS,
    members: { [uid]: memberSnapshot(player, uid, true) }
  };
  await runTransaction(db, async tx => tx.set(ref, room));
  localStorage.setItem(STORAGE_KEY, ref.id);
  return ref.id;
}
export async function findOrCreateRaidRoom(player) {
  const { uid, db } = await ensureRaidRoomAuth();
  if (!uid) throw new Error('團本登入失敗');
  const q = query(collection(db, COLLECTION), where('status', '==', 'waiting'), limit(24));
  const snap = await getDocs(q);
  const candidates = snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(roomUsable)
    .sort((a, b) => activeMembers(b).length - activeMembers(a).length || finite(a.createdAtMs) - finite(b.createdAtMs));
  for (const candidate of candidates) {
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, COLLECTION, candidate.id);
        const currentSnap = await tx.get(ref);
        if (!currentSnap.exists()) throw new Error('room-gone');
        const room = currentSnap.data();
        const members = membersOf(room);
        if (!roomUsable(room) || Object.keys(members).length >= MAX_MEMBERS) throw new Error('room-full');
        if (!members[uid]) members[uid] = memberSnapshot(player, uid, false);
        else members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
        tx.update(ref, { members });
      });
      localStorage.setItem(STORAGE_KEY, candidate.id);
      return candidate.id;
    } catch (_) {}
  }
  return createRaidRoom(player);
}
export async function joinRaidRoomByCode(roomCode, player) {
  const target = String(roomCode || '').trim().toUpperCase();
  if (!target) throw new Error('請輸入隊伍代碼');
  const { uid, db } = await ensureRaidRoomAuth();
  const q = query(collection(db, COLLECTION), where('code', '==', target), limit(5));
  const snap = await getDocs(q);
  const hit = snap.docs.find(item => roomUsable(item.data()));
  if (!hit) throw new Error('找不到可加入的隊伍');
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, hit.id);
    const currentSnap = await tx.get(ref);
    if (!currentSnap.exists()) throw new Error('隊伍已不存在');
    const room = currentSnap.data();
    const members = membersOf(room);
    if (!roomUsable(room) || Object.keys(members).length >= MAX_MEMBERS) throw new Error('隊伍已滿或已開始');
    members[uid] = members[uid] ? { ...members[uid], online: true, heartbeatAtMs: now() } : memberSnapshot(player, uid, false);
    tx.update(ref, { members });
  });
  localStorage.setItem(STORAGE_KEY, hit.id);
  return hit.id;
}
export async function reconnectRaidRoom(player) {
  const roomId = localStorage.getItem(STORAGE_KEY);
  if (!roomId) return null;
  const { uid, db } = await ensureRaidRoomAuth();
  if (!uid) return null;
  try {
    return await runTransaction(db, async tx => {
      const ref = doc(db, COLLECTION, roomId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const room = snap.data();
      const members = membersOf(room);
      if (!members[uid] || ['won', 'lost', 'closed'].includes(room.status)) return null;
      members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
      tx.update(ref, { members });
      return roomId;
    });
  } catch (_) {
    return null;
  }
}
export async function setRaidReady(roomId, ready) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('隊伍不存在');
    const room = snap.data();
    if (room.status !== 'waiting') throw new Error('團本已開始');
    const members = membersOf(room);
    if (!members[uid]) throw new Error('你不在這個隊伍');
    members[uid] = { ...members[uid], ready: !!ready, online: true, heartbeatAtMs: now() };
    tx.update(ref, { members });
  });
}
export async function startRaidRoom(roomId, boss) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('隊伍不存在');
    const room = snap.data();
    if (room.hostUid !== uid) throw new Error('只有隊長可以開始');
    if (room.status !== 'waiting') return;
    const members = activeMembers(room);
    if (!members.length || members.some(member => !member.ready)) throw new Error('仍有隊員尚未準備');
    tx.update(ref, {
      status: 'active',
      startedAtMs: now(),
      bossHp: Math.max(1, Math.round(finite(boss?.maxHp, 1800))),
      bossMaxHp: Math.max(1, Math.round(finite(boss?.maxHp, 1800))),
      bossBaseAttack: Math.max(1, Math.round(finite(boss?.baseAttack, 100))),
      bossPhase: 1,
      bossActionCount: 0,
      lastBossAction: null
    });
  });
}
export function subscribeRaidRoom(roomId, callback, onError) {
  let stopped = false;
  let unsubscribe = null;
  void ensureRaidRoomAuth().then(({ db }) => {
    if (stopped) return;
    unsubscribe = onSnapshot(doc(db, COLLECTION, roomId), snap => {
      callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, onError);
  }).catch(onError);
  return () => { stopped = true; unsubscribe?.(); };
}
export async function heartbeatRaidRoom(roomId) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const room = snap.data();
    const members = membersOf(room);
    if (!members[uid]) return;
    members[uid] = { ...members[uid], online: true, heartbeatAtMs: now() };
    tx.update(ref, { members });
  });
}
export async function commitRaidPlayerAction({ roomId, actionId, damage, hp, correct }) {
  const { uid, db } = await ensureRaidRoomAuth();
  return runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('團本房間不存在');
    const room = snap.data();
    if (room.status !== 'active') return room;
    const members = membersOf(room);
    const me = members[uid];
    if (!me || me.alive === false) return room;
    const id = Math.max(1, Math.floor(finite(actionId, 1)));
    if (id <= finite(me.lastActionId)) return room;
    const dealt = correct ? Math.max(0, Math.round(finite(damage))) : 0;
    const nextBossHp = Math.max(0, Math.round(finite(room.bossHp)) - dealt);
    members[uid] = {
      ...me,
      hp: Math.max(0, Math.round(finite(hp, me.hp))),
      alive: Math.max(0, Math.round(finite(hp, me.hp))) > 0,
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
    return { ...room, ...update };
  });
}
export async function commitRaidBossDefense({ roomId, hp, bossActionSeen, reflectedDamage = 0 }) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const room = snap.data();
    if (room.status !== 'active') return;
    const members = membersOf(room);
    const me = members[uid];
    if (!me || finite(me.lastBossActionSeen) >= finite(bossActionSeen)) return;
    const nextHp = Math.max(0, Math.round(finite(hp, me.hp)));
    const reflected = Math.max(0, Math.round(finite(reflectedDamage)));
    const nextBossHp = Math.max(0, Math.round(finite(room.bossHp)) - reflected);
    members[uid] = {
      ...me,
      hp: nextHp,
      alive: nextHp > 0,
      damage: Math.max(0, Math.round(finite(me.damage))) + reflected,
      lastBossActionSeen: Math.max(finite(me.lastBossActionSeen), finite(bossActionSeen)),
      online: true,
      heartbeatAtMs: now()
    };
    const alive = Object.values(members).some(member => member?.alive !== false && finite(member?.hp) > 0);
    const update = { members, bossHp: nextBossHp };
    if (nextBossHp <= 0) {
      update.status = 'won';
      update.finishedAtMs = now();
    } else if (!alive) {
      update.status = 'lost';
      update.finishedAtMs = now();
    }
    tx.update(ref, update);
  });
}

export async function commitRaidMemberState({ roomId, hp, bossActionSeen }) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const room = snap.data();
    const members = membersOf(room);
    const me = members[uid];
    if (!me) return;
    const nextHp = Math.max(0, Math.round(finite(hp, me.hp)));
    members[uid] = {
      ...me,
      hp: nextHp,
      alive: nextHp > 0,
      lastBossActionSeen: Math.max(finite(me.lastBossActionSeen), finite(bossActionSeen)),
      online: true,
      heartbeatAtMs: now()
    };
    const alive = Object.values(members).some(member => member?.alive !== false && finite(member?.hp) > 0);
    const update = { members };
    if (!alive && room.status === 'active') {
      update.status = 'lost';
      update.finishedAtMs = now();
    }
    tx.update(ref, update);
  });
}
export async function advanceRaidBossAction({ roomId, intent, maxActions = 12 }) {
  const { uid, db } = await ensureRaidRoomAuth();
  return runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const room = snap.data();
    if (room.status !== 'active' || room.hostUid !== uid) return room;
    const nextCount = Math.max(0, Math.floor(finite(room.bossActionCount))) + 1;
    const action = {
      id: nextCount,
      name: String(intent?.name || '試劍').slice(0, 40),
      cue: String(intent?.cue || '').slice(0, 160),
      kind: String(intent?.kind || 'normal').slice(0, 24),
      damage: Math.max(0, Math.round(finite(intent?.damage))),
      issuedAtMs: now()
    };
    const update = { bossActionCount: nextCount, lastBossAction: action };
    if (nextCount >= maxActions) {
      update.status = 'lost';
      update.finishedAtMs = now();
    }
    tx.update(ref, update);
    return { ...room, ...update };
  });
}
export async function leaveRaidRoom(roomId) {
  const { uid, db } = await ensureRaidRoomAuth();
  await runTransaction(db, async tx => {
    const ref = doc(db, COLLECTION, roomId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const room = snap.data();
    const members = membersOf(room);
    if (!members[uid]) return;
    members[uid] = { ...members[uid], online: false, ready: false, heartbeatAtMs: now() };
    let hostUid = room.hostUid;
    if (hostUid === uid) {
      const replacement = Object.values(members).find(member => member?.uid !== uid && member?.online !== false);
      hostUid = replacement?.uid || uid;
      if (replacement) members[replacement.uid] = { ...replacement, host: true };
    }
    const update = { members, hostUid };
    if (!Object.values(members).some(member => member?.online !== false)) update.status = 'closed';
    tx.update(ref, update);
  }).catch(() => {});
  localStorage.removeItem(STORAGE_KEY);
}
export function raidRoomMembers(room) {
  return Object.values(membersOf(room)).sort((a, b) => Number(b?.host) - Number(a?.host) || finite(a?.joinedAtMs) - finite(b?.joinedAtMs));
}
export function raidMemberOnline(member) {
  return member?.online !== false && now() - finite(member?.heartbeatAtMs) <= STALE_MS;
}
