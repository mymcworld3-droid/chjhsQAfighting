import {} from './nascent-growth.js';
import { raidRepository } from './data/raid-repository.js';

const STORAGE_KEY = 'xiuxian:raid-room:v2';
const POLL_MS = 500; // 即時串流中斷時才使用；正常狀態沒有輪詢等待。
const STALE_MS = 45000;
const roomObservers = new Map();
let ticketRequestSequence = 0, appliedTicketSequence = 0;

function now() { return Date.now(); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
const RAID_ROOM_ENDPOINT = '/api/raid/room';
async function api(action, payload = {}) {
  // 房間狀態由伺服器權威處理；瀏覽器只送出意圖與 A 專案登入憑證。
  const local = window.getCurrentUserData?.();
  const sequence = ++ticketRequestSequence;
  const result = await raidRepository.request(action, payload, RAID_ROOM_ENDPOINT);
  applyRaidTicketResponse(result, local, sequence);
  applyRaidResponse(result,local);
  if (local === window.getCurrentUserData?.() && result.room?.id) {
    roomObservers.get(result.room.id)?.forEach(emit => emit(result));
  }
  return result;
}
function applyRaidTicketResponse(result, local, sequence) {
  const next = result?.ticketState;
  if (!local || local !== window.getCurrentUserData?.() || sequence < appliedTicketSequence ||
      next?.count == null || !Number.isFinite(Number(next.count))) return;
  appliedTicketSequence = sequence;
  const tickets = { count:Math.max(0, Math.min(10, Math.floor(Number(next.count)))),
    dailyGrant:2, cap:10, lastGrantDate:String(next.lastGrantDate || '') };
  const previous = local.raidTickets;
  if (previous?.count === tickets.count && previous?.lastGrantDate === tickets.lastGrantDate &&
      previous?.dailyGrant === tickets.dailyGrant && previous?.cap === tickets.cap) return;
  local.raidTickets = tickets;
  window.dispatchEvent?.(new CustomEvent('xiuxian:raid-tickets-updated', { detail:{uid:local.uid, ticketState:tickets} }));
}
function applyRaidResponse(result,local = window.getCurrentUserData?.()) {
  const reward = result?.spiritReward;
  // Apply only unseen lifetime earnings. Cached totals must never restore gold
  // already spent or cultivation lost in another activity.
  if (local && local === window.getCurrentUserData?.() &&
      (!local.uid || local.uid === reward?.uid)) {
    local.stats = local.stats || {};
    let changed = false;
    const fragmentsEarned = reward?.learningTotals?.fragments;
    if (Number.isFinite(fragmentsEarned) && fragmentsEarned >= 0) {
      local.raidLearningRewards ||= {};
      const before = Math.max(0, Number(local.raidLearningRewards.fragments) || 0);
      const delta = Math.max(0,fragmentsEarned-before);
      // Migration and unseen receipt income are distinct; cached balances never restore spent fragments.
      if (delta || local.nascentSoulGrowth?.version !== 1) {
        globalThis.QANascentGrowth.apply(local,globalThis.QANascentGrowth.award(local,delta));
        local.raidLearningRewards.fragments = fragmentsEarned;
        changed = true;
      }
    }
    for (const [key, stat] of [['cultivation', 'totalScore'], ['gold', 'gold']]) {
      const earned = reward?.learningTotals?.[key];
      if (!Number.isFinite(earned) || earned < 0) continue;
      local.raidLearningRewards ||= {};
      const before = Math.max(0, Number(local.raidLearningRewards[key]) || 0);
      const delta = Math.max(0, earned - before);
      if (delta) {
        local.stats[stat] = Math.max(0, Number(local.stats[stat]) || 0) + delta;
        local.raidLearningRewards[key] = earned;
        changed = true;
      }
    }
    if (changed) { window.updateUIStats?.(); window.dispatchEvent(new CustomEvent('xiuxian:stats-updated',{detail:{source:'raid-fragments'}})); }
  }
  return result;
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
export async function getRaidTicketState() {
  const result = await api('ticket-status');
  return result.ticketState || null;
}
export async function createRaidRoom(onResult) {
  const result = await api('create');
  remember(result.roomId);
  onResult?.(result);
  return result.roomId;
}
export async function findOrCreateRaidRoom(onResult) {
  const result = await api('quick');
  remember(result.roomId);
  onResult?.(result);
  return result.roomId;
}
export async function joinRaidRoomByCode(roomCode,onResult) {
  const result = await api('join-code', { roomCode });
  remember(result.roomId);
  onResult?.(result);
  return result.roomId;
}
export async function reconnectRaidRoom(onResult) {
  const roomId = localStorage.getItem(STORAGE_KEY);
  if (!roomId) return null;
  try {
    const result = await api('reconnect', { roomId });
    if (!result.roomId) {
      forget();
      return null;
    }
    remember(result.roomId);
    onResult?.(result);
    return result.roomId;
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) forget();
    return null;
  }
}
export async function setRaidReady(roomId, ready) {
  return api('ready', { roomId, ready: !!ready });
}
export async function startRaidRoom(roomId) {
  return api('start', { roomId });
}
export function subscribeRaidRoom(roomId, callback, onError, initialResult) {
  let stopped = false;
  let timer = null;
  let busy = false;
  let lastError = '';
  let lastRoom = null, revision = -1, streamUnsub;
  let ticketsChecked = false;
  function emit(result) {
    if (stopped) return;
    applyRaidResponse(result);
    if (result.room) {
      const next = Number(result.room.revision) || 0;
      if (next < revision) {
        if (result.spiritReward) callback(lastRoom,result.spiritReward);
        return;
      }
      revision = next; lastRoom = result.room;
      // The captain's HTTP reply includes the spent ticket balance. Other
      // members learn about the reservation through this room push instead.
      if (!ticketsChecked && result.room.ticketMemberUids?.includes(window.getCurrentUserData?.()?.uid)) {
        ticketsChecked = true;
        void getRaidTicketState().catch(error => console.warn('[Raid] ticket sync deferred:', error?.message || error));
      }
    }
    callback(lastRoom,result.spiritReward || null);
  }
  function stop() {
    stopped = true;
    clearInterval(timer); timer = null;
    streamUnsub?.();
    const observers = roomObservers.get(roomId);
    observers?.delete(emit);
    if (!observers?.size) roomObservers.delete(roomId);
  }
  function failure(error) {
    if (stopped) return;
    const signature = String(error?.status || '') + ':' + String(error?.message || error);
    if (signature !== lastError) { lastError = signature; onError?.(error); }
    if ([401,403,404].includes(error?.status)) { stop(); callback(null); }
  }

  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await api('get', { roomId });
      lastError = '';
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
    }
  };

  if (!roomObservers.has(roomId)) roomObservers.set(roomId,new Set());
  roomObservers.get(roomId).add(emit);
  if (initialResult) emit(initialResult);
  streamUnsub = raidRepository.subscribeRoom(roomId,result => { lastError = ''; emit(result); },failure,connected => {
    if (stopped) return;
    if (connected) { clearInterval(timer); timer = null; }
    else if (!timer) { void poll(); timer = setInterval(poll,POLL_MS); }
  });
  if (stopped) streamUnsub?.();
  return stop;
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
