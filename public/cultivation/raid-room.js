import { raidRepository } from './data/raid-repository.js';

const STORAGE_KEY = 'xiuxian:raid-room:v2';
const POLL_MS = 1000;
const STALE_MS = 45000;

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
const RAID_ROOM_ENDPOINT = '/api/raid/room';
async function api(action, payload = {}) {
  // 房間狀態由伺服器權威處理；瀏覽器只送出意圖與 A 專案登入憑證。
  return raidRepository.request(action, payload, RAID_ROOM_ENDPOINT);
}
function remember(roomId) {
  if (roomId) localStorage.setItem(STORAGE_KEY, roomId);
}
function forget() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function ensureRaidRoomAuth() {
  return raidRepository.ensureAuth();
}
export async function createRaidRoom() {
  const result = await api('create');
  remember(result.roomId);
  return result.roomId;
}
export async function findOrCreateRaidRoom() {
  const result = await api('quick');
  remember(result.roomId);
  return result.roomId;
}
export async function joinRaidRoomByCode(roomCode) {
  const result = await api('join-code', { roomCode });
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
export async function startRaidRoom(roomId) {
  await api('start', { roomId });
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
export async function commitRaidPlayerAction({ roomId, actionId, questionId, choice, ticket }) {
  // Only the player's choice is an input. Correctness, damage and HP are resolved by the server.
  return api('player-action', { roomId, actionId, questionId, choice, ticket });
}
export async function commitRaidBossDefense({ roomId, bossActionSeen }) {
  // HP, mitigation and reflected damage are resolved from the trusted room member snapshot.
  return api('boss-defense', { roomId, bossActionSeen });
}
export async function commitRaidMemberState({ roomId }) {
  // Legacy compatibility: this endpoint is heartbeat-only on the server.
  return api('member-state', { roomId });
}
export async function advanceRaidBossAction({ roomId }) {
  // Boss intent and damage are derived from authoritative room state.
  const result = await api('advance-boss', { roomId });
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
