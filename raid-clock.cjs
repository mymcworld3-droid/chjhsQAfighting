'use strict';

const { bossIntent, bossPhase, resolveBossDefense } = require('./raid-authority.cjs');
const STALE_MS = 45000;
const BOSS_ACTION_INTERVAL_MS = 18000;
const ROOM_TTL_MS = 30 * 60 * 1000;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const onlineAt = (member, at) => member?.online !== false && at - finite(member?.heartbeatAtMs) <= STALE_MS;

// Pure transition: callers persist it in one transaction. Time, damage and
// reflection are independent of any browser acknowledgement or host heartbeat.
function advanceRaidClock(room, roomId, at = Date.now()) {
  if (!room || !['waiting', 'active'].includes(room.status)) return null;
  let changed = false;
  const next = { ...room, members: Object.fromEntries(Object.entries(room.members || {}).map(([id, member]) => [id, { ...member }])) };
  const rows = () => Object.values(next.members);
  function expireMembers(time) {
    for (const member of rows()) {
      if (onlineAt(member, time)) continue;
      if (member.online !== false) { member.online = false; member.ready = false; changed = true; }
      if (next.status === 'active' && member.alive !== false) {
        member.alive = false;
        member.hp = 0;
        member.forfeitReason = 'connection-timeout';
        changed = true;
      }
    }
  }
  function terminal(time) {
    if (finite(next.bossHp) <= 0) {
      next.status = 'won'; next.finishedAtMs = time; changed = true;
    } else if (!rows().some(member => member.alive !== false && finite(member.hp) > 0)) {
      next.status = 'lost'; next.finishedAtMs = time; changed = true;
    }
    return next.status !== 'active';
  }
  if (next.status === 'active') {
    if (!next.serverDrivenBoss) { next.serverDrivenBoss = true; changed = true; }
    // Replay overdue rounds using their scheduled timestamps after a restart.
    // A finite cap bounds a malformed/very old room; the next scan resumes it.
    for (let replay = 0; replay < 50; replay++) {
      const count = Math.max(0, Math.floor(finite(next.bossActionCount)));
      const due = finite(next.startedAtMs) + (count + 1) * BOSS_ACTION_INTERVAL_MS;
      if (!next.startedAtMs || due > at) break;
      expireMembers(due);
      if (terminal(due)) break;
      const intent = bossIntent(next);
      const action = { id: count + 1, name: intent.name, cue: intent.cue, kind: intent.kind,
        damage: intent.damage, phase: intent.phase, issuedAtMs: due };
      let reflected = 0;
      for (const [uid, member] of Object.entries(next.members)) {
        if (member.alive === false || finite(member.hp) <= 0) continue;
        const combat = resolveBossDefense(member, { roomId, bossAction: action });
        const reflection = Math.max(0, Math.round(finite(combat.reflectedDamage)));
        reflected += reflection;
        next.members[uid] = { ...combat.member, alive: finite(combat.member.hp) > 0,
          damage: Math.max(0, finite(member.damage)) + reflection,
          lastBossActionSeen: action.id,
          lastBossResolution: { bossActionSeen: action.id, damage: combat.damage,
            reflectedDamage: reflection, guarded: combat.guarded, playerHp: combat.member.hp } };
      }
      next.bossHp = Math.max(0, finite(next.bossHp) - reflected);
      next.bossActionCount = action.id;
      next.lastBossAction = action;
      next.bossPhase = bossPhase(next.bossHp, next.bossMaxHp);
      for (const member of rows()) {
        if (member.lastBossResolution?.bossActionSeen === action.id) member.lastBossResolution.bossHp = next.bossHp;
      }
      changed = true;
      if (terminal(due)) break;
    }
    if (next.status === 'active') { expireMembers(at); terminal(at); }
  } else {
    expireMembers(at);
    if (!rows().some(member => onlineAt(member, at)) || at - finite(next.createdAtMs) > ROOM_TTL_MS) {
      next.status = 'closed'; changed = true;
    }
  }
  if (['waiting', 'active'].includes(next.status)) {
    const currentHost = next.members[next.hostUid];
    const host = onlineAt(currentHost, at) ? currentHost : rows().filter(member => onlineAt(member, at))
      .sort((a, b) => finite(a.joinedAtMs) - finite(b.joinedAtMs) || String(a.uid).localeCompare(String(b.uid)))[0];
    if (host && next.hostUid !== host.uid) { next.hostUid = host.uid; changed = true; }
    for (const member of rows()) {
      const flag = member.uid === next.hostUid;
      if (member.host !== flag) { member.host = flag; changed = true; }
    }
  }
  return changed ? next : null;
}

async function advanceRaidRoom(db, ref, at = Date.now()) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const room = snap.data();
    const next = advanceRaidClock(room, ref.id, at);
    if (next) tx.update(ref, next);
    return next || room;
  });
}

function startRaidScheduler({ resolveDb, logger = console, intervalMs = 5000,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  let busy = false, stopped = false, lastError = '';
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const db = resolveDb();
      const snap = await db.collection('raidRooms').where('status', 'in', ['waiting', 'active']).get();
      // Settle rooms independently so one bad document cannot stall every team.
      const results = await Promise.allSettled(snap.docs.map(doc => advanceRaidRoom(db, doc.ref)));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      lastError = '';
    } catch (error) {
      const message = String(error?.message || error);
      if (message !== lastError) logger.error('[Raid clock]', message);
      lastError = message;
    } finally { busy = false; }
  }
  const timer = setIntervalFn(() => void tick(), intervalMs);
  timer?.unref?.();
  void tick();
  return { tick, stop() { stopped = true; clearIntervalFn(timer); } };
}

module.exports = { STALE_MS, BOSS_ACTION_INTERVAL_MS, ROOM_TTL_MS, onlineAt, advanceRaidClock, advanceRaidRoom, startRaidScheduler };
