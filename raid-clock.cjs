'use strict';

const { bossIntent, bossPhase, resolveBossDefense, RAID_TEAMWORK } = require('./raid-authority.cjs');
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
      const teamContributors = [...new Set(Array.isArray(next.teamCorrectUids) ? next.teamCorrectUids : [])];
      const teamGuarded = next.teamGuardReady === true &&
        teamContributors.length >= RAID_TEAMWORK.guardContributors;
      const rawDamage = Math.max(0, Math.round(finite(intent.damage)));
      const resolvedDamage = teamGuarded
        ? Math.max(1, Math.round(rawDamage * RAID_TEAMWORK.guardDamageMultiplier))
        : rawDamage;
      const action = { id: count + 1, name: intent.name, cue: intent.cue, kind: intent.kind,
        damage: resolvedDamage, rawDamage, phase: intent.phase, issuedAtMs: due,
        teamGuarded, teamContributors };
      let reflected = 0;
      for (const [uid, member] of Object.entries(next.members)) {
        if (member.alive === false || finite(member.hp) <= 0) continue;
        const combat = resolveBossDefense(member, { roomId, bossAction: action, bossHp:Math.max(0,finite(next.bossHp) - reflected) });
        const reflection = Math.max(0, Math.round(finite(combat.reflectedDamage)));
        const healingDamage=Math.max(0,Math.round(finite(combat.healingDamage)));
        reflected += reflection+healingDamage;
        next.members[uid] = { ...combat.member, alive: finite(combat.member.hp) > 0,
          damage: Math.max(0, finite(member.damage)) + reflection+healingDamage,
          lastBossActionSeen: action.id,
          lastBossResolution: { bossActionSeen: action.id, damage: combat.damage,
            reflectedDamage: reflection, guarded: combat.guarded, teamGuarded: action.teamGuarded === true,
            healingDamage,healed:combat.healed || 0,innateEffects:combat.innateEffects || [],
            rawBossDamage: action.rawDamage, playerHp: combat.member.hp } };
      }
      next.bossHp = Math.max(0, finite(next.bossHp) - reflected);
      next.bossActionCount = action.id;
      next.lastBossAction = action;
      next.bossPhase = bossPhase(next.bossHp, next.bossMaxHp);
      // 每次 Boss 出招後開啟新的合作窗口；同一玩家重複答對不會灌滿不同隊員門檻。
      next.teamCycle = Math.max(1, Math.floor(finite(next.teamCycle, 1))) + 1;
      next.teamCorrectUids = [];
      next.teamGuardReady = false;
      next.teamBurstTriggered = false;
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
  if (changed) next.revision = Math.max(0,finite(room.revision)) + 1;
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

function startRaidScheduler({ resolveDb, logger = console, intervalMs = 1000,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = Date.now } = {}) {
  let busy = false, stopped = false, lastError = '', unsubscribe = null;
  let retryAt = 0, failures = 0, generation = 0;
  const rooms = new Map();
  function report(error) {
    const message = String(error?.message || error);
    if (message !== lastError) logger.error('[Raid clock]', message);
    lastError = message;
  }
  function failed(error) {
    generation++;
    unsubscribe?.(); unsubscribe = null;
    rooms.clear();
    const quota = ['8', 'resource-exhausted'].includes(String(error?.code).replace(/^firestore\//, ''));
    retryAt = now() + Math.min(1800000, (quota ? 60000 : 5000) * 2 ** Math.min(failures++, 9));
    report(error);
  }
  function watch(db) {
    if (unsubscribe || now() < retryAt) return;
    const serial = ++generation;
    const current = () => !stopped && generation === serial;
    const cancel = db.collection('raidRooms').where('status', 'in', ['waiting', 'active']).onSnapshot(snap => {
      if (!current()) return;
      // The listener pays for changed documents rather than scanning the same
      // rooms every second. Cached data only schedules work; transactions below
      // always re-read the authoritative document before applying any damage.
      rooms.clear();
      for (const doc of snap.docs) rooms.set(doc.id, { ref:doc.ref, room:doc.data() });
      failures = 0; retryAt = 0;
      void tick();
    }, error => { if (current()) failed(error); });
    if (current()) unsubscribe = cancel;
    else cancel();
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const db = resolveDb();
      watch(db);
      const at = now();
      // Settle rooms independently so one bad document cannot stall every team.
      // A timer tick without a due transition makes zero Firestore requests.
      const due = [...rooms.entries()].filter(([id, entry]) => advanceRaidClock(entry.room, id, at));
      const results = await Promise.allSettled(due.map(async ([id, entry]) => {
        const room = await advanceRaidRoom(db, entry.ref, at);
        // A newer listener update must win over an older transaction response.
        if (!stopped && rooms.get(id) === entry) {
          if (room && ['waiting', 'active'].includes(room.status)) rooms.set(id, {ref:entry.ref, room});
          else rooms.delete(id);
        }
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (unsubscribe) lastError = '';
    } catch (error) {
      // Also back off failed transactions; quota exhaustion must not trigger
      // another read every second while the listener still has cached data.
      failed(error);
    } finally { busy = false; }
  }
  const timer = setIntervalFn(() => void tick(), intervalMs);
  timer?.unref?.();
  void tick();
  return { tick, stop() {
    stopped = true; generation++; clearIntervalFn(timer);
    unsubscribe?.(); unsubscribe = null; rooms.clear();
  } };
}

module.exports = { STALE_MS, BOSS_ACTION_INTERVAL_MS, ROOM_TTL_MS, onlineAt, advanceRaidClock, advanceRaidRoom, startRaidScheduler };
