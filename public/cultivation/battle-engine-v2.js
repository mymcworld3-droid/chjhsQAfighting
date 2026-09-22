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

// 以伺服器答案時間排序；毫秒相同時，遵循房間交易記下的真正首答者。
function roundTurnOrder(host, guest, firstAnswerUid = null) {
  const hostAt = Number(host?.answer?.atMs) || Number.POSITIVE_INFINITY;
  const guestAt = Number(guest?.answer?.atMs) || Number.POSITIVE_INFINITY;
  if (guestAt < hostAt) return ['guest', 'host'];
  if (hostAt < guestAt) return ['host', 'guest'];
  if (firstAnswerUid && firstAnswerUid === guest?.uid) return ['guest', 'host'];
  return ['host', 'guest'];
}

export function decideRoundAttackers(host, guest, tieWindowMs = BATTLE_V2.tieWindowMs, firstAnswerUid = null) {
  const hostCorrect = answerCorrect(host);
  const guestCorrect = answerCorrect(guest);

  if (hostCorrect && !guestCorrect) return ['host'];
  if (!hostCorrect && guestCorrect) return ['guest'];
  if (!hostCorrect && !guestCorrect) return [];

  // Both correct players can attack, but the earlier server-stamped answer takes first turn.
  return roundTurnOrder(host, guest, firstAnswerUid);
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
  firstAnswerUid = null,
  tieWindowMs = BATTLE_V2.tieWindowMs,
  maxRounds = BATTLE_V2.maxRounds,
  // Optional per-hit resolver for equipment effects. Pure engine remains unchanged without one.
  resolveEquipmentHit = null,
  resolveGuardedFollowup = null
}) {
  // Firestore server-stamped response time determines initiative, never damage eligibility.
  // Missing/timeout answers move last; timestamps tied to the millisecond defer to firstAnswerUid.
  // Older rooms without this field retain host as the deterministic last-resort tie-break.
  const turnOrder = roundTurnOrder(host, guest, firstAnswerUid);
  const attackers = [];
  const hostSupport = resolveDeterministicCoreSupport(host, roomId + ':' + round + ':' + host.uid + ':support');
  const guestSupport = resolveDeterministicCoreSupport(guest, roomId + ':' + round + ':' + guest.uid + ':support');
  const startHostHp = Math.min(Math.max(1, Number(host?.maxHp) || 1000), currentHp(host) + hostSupport.heal);
  const startGuestHp = Math.min(Math.max(1, Number(guest?.maxHp) || 1000), currentHp(guest) + guestSupport.heal);
  let hostHp = startHostHp;
  let guestHp = startGuestHp;
  // 道心護體只在同一回合第一次受到傷害時觸發；護體本身留到下回合再生效。
  const hostCoreShield = hostSupport.shield;
  const guestCoreShield = guestSupport.shield;
  let hostRoundGuardAvailable = hostCoreShield;
  let guestRoundGuardAvailable = guestCoreShield;
  const logs = [];
  const steps = [];
  const activations = [];
  for (const activation of hostSupport.activations) activations.push({ ...activation, ownerUid: host.uid });
  for (const activation of guestSupport.activations) activations.push({ ...activation, ownerUid: guest.uid });
  if (hostSupport.heal && startHostHp > currentHp(host)) logs.push({ type: 'heal', actorRole: 'host', actorUid: host.uid, damage: 0, amount: startHostHp - currentHp(host), skill: '太初回元丹・回元' });
  if (guestSupport.heal && startGuestHp > currentHp(guest)) logs.push({ type: 'heal', actorRole: 'guest', actorUid: guest.uid, damage: 0, amount: startGuestHp - currentHp(guest), skill: '太初回元丹・回元' });

  for (const role of turnOrder) {
    // An earlier lethal hit (including Thunder reflection) ends the round immediately.
    if (hostHp <= 0 || guestHp <= 0) break;
    const player = role === 'host' ? host : guest;
    const defender = role === 'host' ? guest : host;
    const support = role === 'host' ? hostSupport : guestSupport;
    const targetRole = role === 'host' ? 'guest' : 'host';
    if (!answerCorrect(player)) {
      logs.push({ type: 'miss', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, message: '本回合作答未命中，MISS' });
      steps.push({ type: 'miss', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, hostHp, guestHp });
      continue;
    }

    const plan = hitPlan({ roomId, round, role, player, support });
    // The equipment resolver must see the current sequential HP, not the pre-round snapshot.
    if (typeof resolveEquipmentHit === 'function') {
      player.hp = role === 'host' ? hostHp : guestHp;
      defender.hp = role === 'host' ? guestHp : hostHp;
    }
    attackers.push(role);
    const guarded = role === 'host' ? guestRoundGuardAvailable : hostRoundGuardAvailable;
    if (guarded) {
      if (role === 'host') guestRoundGuardAvailable = false;
      else hostRoundGuardAvailable = false;
      logs.push({ type: 'guard', actorRole: targetRole, actorUid: defender.uid, targetUid: player.uid, damage: 0, skill: '金丹道心護體', message: '金丹道心護體抵銷本回合第一次傷害' });
      activations.push({ type: defender.goldenCore?.type || 'shield', name: defender.goldenCore?.name || '金丹', ownerUid: defender.uid, skill: '金丹道心護體', message: '金丹道心護體發動，本回合的防護已使用', kind: '鬥法防護' });
    }
    const equipment = !guarded && typeof resolveEquipmentHit === 'function'
      ? (resolveEquipmentHit({ attacker: player, defender, baseDamage: plan.totalDamage, role, round, seed: `${roomId}:${round}:${player.uid}:artifact` }) || null)
      : guarded && typeof resolveGuardedFollowup === 'function'
        ? (resolveGuardedFollowup({ attacker: player, defender, baseDamage: plan.totalDamage, role, round, seed: `${roomId}:${round}:${player.uid}:artifact` }) || null)
        : null;
    // 連擊是第二次獨立傷害：首擊被道心抵銷後，連擊仍會正常命中。
    const damage = equipment ? Math.max(0, Math.round(Number(equipment.damage) || 0)) : guarded ? 0 : plan.totalDamage;
    const targetBefore = role === 'host' ? guestHp : hostHp;
    if (role === 'host') guestHp = Math.max(0, guestHp - damage);
    else hostHp = Math.max(0, hostHp - damage);
    const attack = { type: 'attack', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage, baseDamage: plan.baseDamage, extraDamage: plan.extraDamage, skill: [plan.activation?.skill, equipment?.skill].filter(Boolean).join('・') };
    logs.push(attack);
    if (guarded) {
      steps.push({ ...attack, damage: 0, guarded: true, hostHp: role === 'host' ? hostHp : startHostHp, guestHp: role === 'guest' ? guestHp : startGuestHp });
      if (equipment) steps.push({ ...attack, damage, guarded: false, skill: [attack.skill, '連擊'].filter(Boolean).join('・'), hostHp, guestHp });
    } else {
      steps.push({ ...attack, guarded: false, hostHp, guestHp });
    }
    if (plan.activation) activations.push({ ...plan.activation, ownerUid: player.uid });
    // Equipment heals / grants a shield to its attacker after an actual hit.
    if (equipment) {
      if (damage > 0) {
        const healed = Math.min(Math.max(1, Number(player.maxHp) || 1000),
          (role === 'host' ? hostHp : guestHp) + Math.max(0, Math.round(Number(equipment.heal) || 0)));
        if (role === 'host') hostHp = healed;
        else guestHp = healed;
      }
      if (equipment.shieldGain > 0) {
        player.artifactShield = Math.max(0, Number(player.artifactShield) || 0) + Math.round(equipment.shieldGain);
      }
    }
    // Step HP records must include any instant post-hit recovery before animation playback.
    steps[steps.length - 1].hostHp = hostHp;
    steps[steps.length - 1].guestHp = guestHp;
    if (hostHp <= 0 || guestHp <= 0) break;

    // A surviving defender may reflect damage. The attacker must survive to take a later action.
    if (damage > 0) {
      const counter = resolveDeterministicCounterCore(defender, Math.min(targetBefore, damage), roomId + ':' + round + ':' + defender.uid + ':counter');
      counter.reflectDamage += Math.max(0, Math.round(Number(equipment?.reflectDamage) || 0));
      if (equipment?.reflectDamage > 0) {
        counter.activation = counter.activation || { type: 'artifact', skill: equipment.reflectSkill || '法寶反傷', name: '法寶', message: '法寶反傷觸發', kind: '鬥法受擊效果' };
      }
      if (counter.reflectDamage > 0) {
        const counterGuarded = role === 'host' ? hostRoundGuardAvailable : guestRoundGuardAvailable;
        if (counterGuarded) {
          if (role === 'host') hostRoundGuardAvailable = false;
          else guestRoundGuardAvailable = false;
          logs.push({ type: 'guard', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, skill: '金丹道心護體', message: '金丹道心護體抵銷本回合第一次反擊傷害' });
          activations.push({ type: player.goldenCore?.type || 'shield', name: player.goldenCore?.name || '金丹', ownerUid: player.uid, skill: '金丹道心護體', message: '金丹道心護體發動，本回合的防護已使用', kind: '鬥法防護' });
        } else if (role === 'host') hostHp = Math.max(0, hostHp - counter.reflectDamage);
        else guestHp = Math.max(0, guestHp - counter.reflectDamage);
        const reflected = { type: 'counter', actorRole: targetRole, actorUid: defender.uid, targetUid: player.uid, damage: counterGuarded ? 0 : counter.reflectDamage, guarded: counterGuarded, skill: counter.activation?.skill || '' };
        logs.push(reflected);
        steps.push({ ...reflected, hostHp, guestHp });
        if (counter.activation) activations.push({ ...counter.activation, ownerUid: defender.uid });
      }
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
    turnOrder,
    steps,
    startHostHp,
    startGuestHp,
    hostHp,
    guestHp,
    hostCoreShield,
    guestCoreShield,
    hostCoreStreak: hostSupport.streak,
    guestCoreStreak: guestSupport.streak,
    hostArtifactState: { artifactShield: host.artifactShield || 0, artifactFirstHitUsed: !!host.artifactFirstHitUsed, artifactCheatDeathUsed: !!host.artifactCheatDeathUsed },
    guestArtifactState: { artifactShield: guest.artifactShield || 0, artifactFirstHitUsed: !!guest.artifactFirstHitUsed, artifactCheatDeathUsed: !!guest.artifactCheatDeathUsed },
    logs,
    activations,
    finished: winnerUid !== null,
    winnerUid,
    finishReason
  };
}
