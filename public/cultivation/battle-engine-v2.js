// Battle v2 pure engine: deterministic, replay-safe PvP settlement.
// No Firebase / DOM dependencies so round rules can be regression-tested independently.

export const BATTLE_V2 = Object.freeze({
  modeVersion: 2,
  roundDurationMs: 25000,
  tieWindowMs: 150,
  maxRounds: 15,
  waitingRoomTtlMs: 90000,
  disconnectTtlMs: 45000,
  nextRoundDelayMs: 2200
});

function clampGrade(value) {
  return Math.min(9, Math.max(1, Number(value) || 9));
}

function chanceByGrade(grade, base, step, cap = 100) {
  return Math.min(cap, base + (9 - clampGrade(grade)) * step);
}

export function deterministicPercent(seed) {
  const text = String(seed || 'battle-v2');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function coreSnapshot(player) {
  const core = player?.goldenCore;
  if (!core?.type) return null;
  return {
    type: core.type,
    name: core.name || '金丹',
    grade: clampGrade(core.grade)
  };
}

export function resolveDeterministicAttackCore(player, seed) {
  const core = coreSnapshot(player);
  if (!core) return { extraDamage: 0, activation: null };

  if (core.type === 'ocean') {
    const chance = chanceByGrade(core.grade, 10, 5, 50);
    if (deterministicPercent(`${seed}:ocean`) < chance) {
      return {
        extraDamage: 100,
        activation: {
          type: core.type,
          name: core.name,
          skill: '大海無垠丹・千尺巨浪',
          message: `千尺巨浪席捲戰場，額外造成 100 傷害（${chance}%）`,
          kind: '鬥法攻擊效果'
        }
      };
    }
  }

  if (core.type === 'sword') {
    const chance = chanceByGrade(core.grade, 10, 5, 50);
    if (deterministicPercent(`${seed}:sword`) < chance) {
      return {
        extraDamage: 200,
        activation: {
          type: core.type,
          name: core.name,
          skill: '破鋒劍心丹・萬劍追擊',
          message: `萬劍追擊，額外造成 200 傷害（${chance}%）`,
          kind: '鬥法攻擊效果'
        }
      };
    }
  }

  return { extraDamage: 0, activation: null };
}

export function resolveDeterministicCounterCore(player, receivedDamage, seed) {
  const core = coreSnapshot(player);
  if (!core || core.type !== 'thunder') return { reflectDamage: 0, activation: null };

  const damage = Math.max(0, Math.round(Number(receivedDamage) || 0));
  if (!damage) return { reflectDamage: 0, activation: null };

  const chance = chanceByGrade(core.grade, 10, 10, 90);
  if (deterministicPercent(`${seed}:thunder`) >= chance) {
    return { reflectDamage: 0, activation: null };
  }

  return {
    reflectDamage: damage,
    activation: {
      type: core.type,
      name: core.name,
      skill: '萬劫雷霆丹・雷光反擊',
      message: `雷光反擊，返還 ${damage} 傷害（${chance}%）`,
      kind: '鬥法受擊效果'
    }
  };
}

function answerCorrect(player) {
  return player?.answer?.correct === true;
}

function answerAt(player) {
  const value = Number(player?.answer?.atMs);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

export function decideRoundAttackers(host, guest, tieWindowMs = BATTLE_V2.tieWindowMs) {
  const hostCorrect = answerCorrect(host);
  const guestCorrect = answerCorrect(guest);

  if (hostCorrect && !guestCorrect) return ['host'];
  if (!hostCorrect && guestCorrect) return ['guest'];
  if (!hostCorrect && !guestCorrect) return [];

  const diff = answerAt(host) - answerAt(guest);
  if (Math.abs(diff) <= tieWindowMs) return ['host', 'guest'];
  return diff < 0 ? ['host'] : ['guest'];
}

function attackPower(player) {
  return Math.max(1, Math.round(Number(player?.atk) || 200));
}

function currentHp(player) {
  return Math.max(0, Math.round(Number(player?.hp) || 0));
}

function hitPlan({ roomId, round, role, player }) {
  const seed = `${roomId}:${round}:${player?.uid || role}:attack`;
  const core = resolveDeterministicAttackCore(player, seed);
  return {
    role,
    baseDamage: attackPower(player),
    extraDamage: core.extraDamage,
    totalDamage: attackPower(player) + core.extraDamage,
    activation: core.activation
  };
}

export function settleBattleRound({
  roomId,
  round,
  host,
  guest,
  tieWindowMs = BATTLE_V2.tieWindowMs,
  maxRounds = BATTLE_V2.maxRounds
}) {
  const attackers = decideRoundAttackers(host, guest, tieWindowMs);
  const plans = attackers.map((role) => hitPlan({
    roomId,
    round,
    role,
    player: role === 'host' ? host : guest
  }));

  const startHostHp = currentHp(host);
  const startGuestHp = currentHp(guest);
  let hostHp = startHostHp;
  let guestHp = startGuestHp;
  const logs = [];
  const activations = [];

  const hostHit = plans.find((plan) => plan.role === 'host') || null;
  const guestHit = plans.find((plan) => plan.role === 'guest') || null;

  // Simultaneous hits are applied from the same pre-hit state, so neither browser gains ordering advantage.
  if (hostHit) guestHp = Math.max(0, startGuestHp - hostHit.totalDamage);
  if (guestHit) hostHp = Math.max(0, startHostHp - guestHit.totalDamage);

  if (hostHit) {
    logs.push({
      type: 'attack',
      actorRole: 'host',
      actorUid: host.uid,
      targetUid: guest.uid,
      damage: hostHit.totalDamage,
      baseDamage: hostHit.baseDamage,
      extraDamage: hostHit.extraDamage,
      skill: hostHit.activation?.skill || ''
    });
    if (hostHit.activation) activations.push({ ...hostHit.activation, ownerUid: host.uid });
  }

  if (guestHit) {
    logs.push({
      type: 'attack',
      actorRole: 'guest',
      actorUid: guest.uid,
      targetUid: host.uid,
      damage: guestHit.totalDamage,
      baseDamage: guestHit.baseDamage,
      extraDamage: guestHit.extraDamage,
      skill: guestHit.activation?.skill || ''
    });
    if (guestHit.activation) activations.push({ ...guestHit.activation, ownerUid: guest.uid });
  }

  // Thunder counter only fires if the defender survived the incoming hit.
  if (hostHit && guestHp > 0) {
    const counter = resolveDeterministicCounterCore(
      guest,
      Math.min(startGuestHp, hostHit.totalDamage),
      `${roomId}:${round}:${guest.uid}:counter`
    );
    if (counter.reflectDamage > 0) {
      hostHp = Math.max(0, hostHp - counter.reflectDamage);
      logs.push({
        type: 'counter',
        actorRole: 'guest',
        actorUid: guest.uid,
        targetUid: host.uid,
        damage: counter.reflectDamage,
        skill: counter.activation?.skill || ''
      });
      if (counter.activation) activations.push({ ...counter.activation, ownerUid: guest.uid });
    }
  }

  if (guestHit && hostHp > 0) {
    const counter = resolveDeterministicCounterCore(
      host,
      Math.min(startHostHp, guestHit.totalDamage),
      `${roomId}:${round}:${host.uid}:counter`
    );
    if (counter.reflectDamage > 0) {
      guestHp = Math.max(0, guestHp - counter.reflectDamage);
      logs.push({
        type: 'counter',
        actorRole: 'host',
        actorUid: host.uid,
        targetUid: guest.uid,
        damage: counter.reflectDamage,
        skill: counter.activation?.skill || ''
      });
      if (counter.activation) activations.push({ ...counter.activation, ownerUid: host.uid });
    }
  }

  let winnerUid = null;
  let finishReason = '';

  if (hostHp <= 0 && guestHp <= 0) {
    winnerUid = 'draw';
    finishReason = 'double-ko';
  } else if (guestHp <= 0) {
    winnerUid = host.uid;
    finishReason = 'hp';
  } else if (hostHp <= 0) {
    winnerUid = guest.uid;
    finishReason = 'hp';
  } else if (round >= maxRounds) {
    finishReason = 'round-limit';
    if (hostHp === guestHp) winnerUid = 'draw';
    else winnerUid = hostHp > guestHp ? host.uid : guest.uid;
  }

  return {
    attackers,
    hostHp,
    guestHp,
    logs,
    activations,
    finished: winnerUid !== null,
    winnerUid,
    finishReason
  };
}
