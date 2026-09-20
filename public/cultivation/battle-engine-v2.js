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

const NEXT_REALM_THRESHOLDS = [28, 68, 128, 208, 308, 448, 628, 868];
function nearBreakthrough(score, grade) {
  const current = Math.max(0, Number(score) || 0);
  const next = NEXT_REALM_THRESHOLDS.find((need) => need > current);
  if (!next) return false;
  const previous = NEXT_REALM_THRESHOLDS.filter((need) => need <= current).at(-1) || 28;
  const span = Math.max(1, next - previous);
  return current >= next - span * ((20 + (9 - clampGrade(grade)) * 5) / 100);
}

// 所有鬥法技能只以房間快照與回合種子運算；重試 Firestore transaction 不能重複擲骰。
export function resolveDeterministicCoreSupport(player, seed) {
  const correct = answerCorrect(player);
  const previous = Math.max(0, Math.floor(Number(player?.coreCorrectStreak) || 0));
  const streak = correct ? previous + 1 : 0;
  const core = coreSnapshot(player);
  const shieldWasReady = !!core && player?.coreShield === true;
  const result = { streak, shield: shieldWasReady, bonusDamage: 0, heal: 0, activations: [] };
  if (!core) return result;
  const grade = core.grade;
  const activate = (skill, message, kind = '鬥法金丹效果') => result.activations.push({
    type: core.type, name: core.name, skill, message, kind
  });

  if (core.type === 'ningxin' && correct && previous >= Math.max(1, Math.ceil(grade / 3)) && !result.shield) {
    result.shield = true;
    activate('凝心靜音丹・道心護體', '連續答對，金丹道心護體成形', '鬥法防護');
  }
  if (core.type === 'wugou' && !correct && !result.shield) {
    const chance = chanceByGrade(grade, 20, 10, 100);
    if (deterministicPercent(`${seed}:wugou`) < chance) {
      result.shield = true;
      activate('無垢清心丹・道心護體', `答錯時清心護體（${chance}%）`, '鬥法防護');
    }
  }
  if (core.type === 'taichu' && correct && streak % Math.max(2, grade + 1) === 0) {
    result.heal = 100;
    activate('太初回元丹・回元', '連續答對，回復 100 生命');
  }
  if (core.type === 'pojing' && correct && nearBreakthrough(player?.totalScore, grade)) {
    result.bonusDamage = 100;
    activate('破境衝仙丹・破境', '接近突破瓶頸，鬥法額外造成 100 傷害');
  }
  if (core.type === 'xingchen' && correct && previous >= Math.max(1, grade)) {
    result.bonusDamage = 80;
    activate('星辰吞月丹・引星', '連續答對，鬥法額外造成 80 傷害');
  }
  if (core.type === 'reverse' && correct && streak % Math.max(2, grade + 1) === 0) {
    result.bonusDamage = 120;
    activate('陰陽反轉丹・反轉', '連勝達指定倍數，鬥法額外造成 120 傷害');
  }
  return result;
}

export function decideRoundAttackers(host, guest, tieWindowMs = BATTLE_V2.tieWindowMs) {
  const hostCorrect = answerCorrect(host);
  const guestCorrect = answerCorrect(guest);

  if (hostCorrect && !guestCorrect) return ['host'];
  if (!hostCorrect && guestCorrect) return ['guest'];
  if (!hostCorrect && !guestCorrect) return [];

  // Every correct answer attacks; apply both hits from the same pre-round state.
  return ['host', 'guest'];
}

function attackPower(player) {
  return Math.max(1, Math.round(Number(player?.atk) || 200));
}

function currentHp(player) {
  return Math.max(0, Math.round(Number(player?.hp) || 0));
}

function hitPlan({ roomId, round, role, player, support }) {
  const seed = `${roomId}:${round}:${player?.uid || role}:attack`;
  const core = resolveDeterministicAttackCore(player, seed);
  return {
    role,
    baseDamage: attackPower(player),
    extraDamage: core.extraDamage + support.bonusDamage,
    totalDamage: attackPower(player) + core.extraDamage + support.bonusDamage,
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
  const hostSupport = resolveDeterministicCoreSupport(host, `${roomId}:${round}:${host.uid}:support`);
  const guestSupport = resolveDeterministicCoreSupport(guest, `${roomId}:${round}:${guest.uid}:support`);
  const plans = attackers.map((role) => hitPlan({
    roomId, round, role,
    player: role === 'host' ? host : guest,
    support: role === 'host' ? hostSupport : guestSupport
  }));

  // 回元於本回合攻防前生效；護體抵銷一次攻擊，不寫回場外修為護體。
  const startHostHp = Math.min(Math.max(1, Number(host?.maxHp) || 1000), currentHp(host) + hostSupport.heal);
  const startGuestHp = Math.min(Math.max(1, Number(guest?.maxHp) || 1000), currentHp(guest) + guestSupport.heal);
  let hostHp = startHostHp;
  let guestHp = startGuestHp;
  const logs = [];
  const activations = [];
  for (const activation of hostSupport.activations) activations.push({ ...activation, ownerUid: host.uid });
  for (const activation of guestSupport.activations) activations.push({ ...activation, ownerUid: guest.uid });
  if (hostSupport.heal && startHostHp > currentHp(host)) logs.push({ type:'heal', actorRole:'host', actorUid:host.uid, damage:0, amount:startHostHp-currentHp(host), skill:'太初回元丹・回元' });
  if (guestSupport.heal && startGuestHp > currentHp(guest)) logs.push({ type:'heal', actorRole:'guest', actorUid:guest.uid, damage:0, amount:startGuestHp-currentHp(guest), skill:'太初回元丹・回元' });

  const hostHit = plans.find((plan) => plan.role === 'host') || null;
  const guestHit = plans.find((plan) => plan.role === 'guest') || null;
  const hostReceived = guestHit && !hostSupport.shield ? guestHit.totalDamage : 0;
  const guestReceived = hostHit && !guestSupport.shield ? hostHit.totalDamage : 0;
  let hostCoreShield = hostSupport.shield && !guestHit;
  let guestCoreShield = guestSupport.shield && !hostHit;
  // Simultaneous hits use the same pre-hit state: guards and healing are symmetric.
  if (hostHit) guestHp = Math.max(0, startGuestHp - guestReceived);
  if (guestHit) hostHp = Math.max(0, startHostHp - hostReceived);
  if (guestHit && hostSupport.shield) {
    logs.push({ type:'guard', actorRole:'host', actorUid:host.uid, targetUid:guest.uid, damage:0, skill:'金丹道心護體', message:'金丹道心護體抵銷本次傷害' });
    activations.push({ type:host.goldenCore.type, name:host.goldenCore.name || '金丹', ownerUid:host.uid, skill:'金丹道心護體', message:'金丹道心護體發動，抵銷本次攻擊', kind:'鬥法防護' });
  }
  if (hostHit && guestSupport.shield) {
    logs.push({ type:'guard', actorRole:'guest', actorUid:guest.uid, targetUid:host.uid, damage:0, skill:'金丹道心護體', message:'金丹道心護體抵銷本次傷害' });
    activations.push({ type:guest.goldenCore.type, name:guest.goldenCore.name || '金丹', ownerUid:guest.uid, skill:'金丹道心護體', message:'金丹道心護體發動，抵銷本次攻擊', kind:'鬥法防護' });
  }

  if (hostHit) {
    logs.push({
      type: 'attack',
      actorRole: 'host',
      actorUid: host.uid,
      targetUid: guest.uid,
      damage: guestReceived,
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
      damage: hostReceived,
      baseDamage: guestHit.baseDamage,
      extraDamage: guestHit.extraDamage,
      skill: guestHit.activation?.skill || ''
    });
    if (guestHit.activation) activations.push({ ...guestHit.activation, ownerUid: guest.uid });
  }

  // Thunder counter only fires if the defender survived the incoming hit.
  if (hostHit && guestReceived > 0 && guestHp > 0) {
    const counter = resolveDeterministicCounterCore(
      guest,
      Math.min(startGuestHp, guestReceived),
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

  if (guestHit && hostReceived > 0 && hostHp > 0) {
    const counter = resolveDeterministicCounterCore(
      host,
      Math.min(startHostHp, hostReceived),
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
    hostCoreShield,
    guestCoreShield,
    hostCoreStreak: hostSupport.streak,
    guestCoreStreak: guestSupport.streak,
    logs,
    activations,
    finished: winnerUid !== null,
    winnerUid,
    finishReason
  };
}
