import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const STORAGE_KEY = 'xiuxian:raid-room:v2';
const POLL_MS = 1000;
const STALE_MS = 45000;

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
async function api(action, payload = {}) {
  const user = getAuth(getApp()).currentUser;
  if (!user) throw new Error('主專案尚未登入');
  const token = await user.getIdToken();
  const response = await fetch('/api/raid/room', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    const error = new Error(data.error || '團本房間連線失敗');
    error.status = response.status;
    throw error;
  }
  return data;
}
function remember(roomId) {
  if (roomId) localStorage.setItem(STORAGE_KEY, roomId);
}
function forget() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function ensureRaidRoomAuth() {
  const user = getAuth(getApp()).currentUser;
  if (!user) throw new Error('主專案尚未登入');
  await user.getIdToken();
  return { uid: user.uid };
}
export async function createRaidRoom(player) {
  const result = await api('create', { player });
  remember(result.roomId);
  return result.roomId;
}
export async function findOrCreateRaidRoom(player) {
  const result = await api('quick', { player });
  remember(result.roomId);
  return result.roomId;
}
export async function joinRaidRoomByCode(roomCode, player) {
  const result = await api('join-code', { roomCode, player });
  remember(result.roomId);
  return result.roomId;
}
export async function reconnectRaidRoom() {
  const roomId = localStorage.getItem(STORAGE_KEY);
  if (!roomId) return null;
  try {
    const result = await api('reconnect', { roomId });
    if (!result.roomId) {
      forget();
      return null;
    }
    remember(result.roomId);
    return result.roomId;
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) forget();
    return null;
  }
}
export async function setRaidReady(roomId, ready) {
  await api('ready', { roomId, ready: !!ready });
}
export async function startRaidRoom(roomId, boss) {
  await api('start', { roomId, boss });
}
export function subscribeRaidRoom(roomId, callback, onError) {
  let stopped = false;
  let timer = null;
  let busy = false;
  let lastError = '';

  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const result = await api('get', { roomId });
      lastError = '';
      callback(result.room || null);
    } catch (error) {
      const signature = String(error?.status || '') + ':' + String(error?.message || error);
      if (signature !== lastError) {
        lastError = signature;
        onError?.(error);
      }
      if (error?.status === 404 || error?.status === 403) {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
        callback(null);
      }
    } finally {
      busy = false;
    }
  };

  void poll();
  timer = setInterval(poll, POLL_MS);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}
export async function heartbeatRaidRoom(roomId) {
  await api('heartbeat', { roomId });
}
export async function commitRaidPlayerAction({ roomId, actionId, damage, hp, correct }) {
  const result = await api('player-action', { roomId, actionId, damage, hp, correct: correct === true });
  return result.room || null;
}
export async function commitRaidBossDefense({ roomId, hp, bossActionSeen, reflectedDamage = 0 }) {
  await api('boss-defense', { roomId, hp, bossActionSeen, reflectedDamage });
}
export async function commitRaidMemberState({ roomId, hp, bossActionSeen }) {
  await api('member-state', { roomId, hp, bossActionSeen });
}
export async function advanceRaidBossAction({ roomId, intent }) {
  const result = await api('advance-boss', { roomId, intent });
  return result.room || null;
}
export async function leaveRaidRoom(roomId) {
  try {
    if (roomId) await api('leave', { roomId });
  } catch (_) {
    // Local cleanup must still happen if the network is already gone.
  } finally {
    forget();
  }
}
export function raidRoomMembers(room) {
  const members = room?.members && typeof room.members === 'object' ? room.members : {};
  return Object.values(members).sort((a, b) =>
    Number(b?.host) - Number(a?.host) || finite(a?.joinedAtMs) - finite(b?.joinedAtMs)
  );
}
export function raidMemberOnline(member) {
  return member?.online !== false && now() - finite(member?.heartbeatAtMs) <= STALE_MS;
}
