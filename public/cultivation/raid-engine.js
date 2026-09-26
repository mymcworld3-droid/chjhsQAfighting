// 團本 MVP 純戰鬥規則：不依賴 DOM / Firebase，方便未來將結算搬到可信任後端。
export const RAID_MVP = Object.freeze({
  modeVersion: 1,
  minimumScore: 10,
  // 每位玩家獨立出題、獨立倒數；不等待隊友，也不共用題目。
  minQuestionCycleMs: 6000,
  reviewLockMs: 1500,
  // Boss 使用自己的時間軸，不因任何玩家答題快慢而延後。
  bossActionIntervalMs: 18000,
  bossTelegraphMs: 5000,
  maxBossActions: 12,
  bossId: 'shen-qingshuang',
  bossName: '沈清霜',
  bossTitle: '大師姐・清霜試煉',
  bossImage: 'assets/story/characters/shen-qingshuang.png'
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

export function createScaledShenBoss({ playerAttack = 200, playerMaxHp = 1000 } = {}) {
  const attack = Math.max(1, Math.round(finite(playerAttack, 200)));
  const maxHp = Math.max(1800, Math.round(attack * 8));
  const referenceHp = Math.max(1, Math.round(finite(playerMaxHp, 1000)));
  return {
    id: RAID_MVP.bossId,
    name: RAID_MVP.bossName,
    title: RAID_MVP.bossTitle,
    image: RAID_MVP.bossImage,
    hp: maxHp,
    maxHp,
    // Boss 傷害跟挑戰者生命尺度同步，避免境界越高反而完全沒有威脅。
    baseAttack: Math.max(70, Math.round(referenceHp * 0.105)),
    phase: 1
  };
}

export function createTeamScaledShenBoss(members = []) {
  const team = Array.isArray(members) ? members.filter(Boolean).slice(0, 4) : [];
  const count = Math.max(1, team.length);
  const totalAttack = team.reduce((sum, member) => sum + Math.max(1, Math.round(finite(member?.atk, 200))), 0);
  const averageHp = team.reduce((sum, member) => sum + Math.max(1, Math.round(finite(member?.maxHp, 1000))), 0) / count;
  const boss = createScaledShenBoss({ playerAttack: totalAttack, playerMaxHp: averageHp });
  // 多人時血量依全隊輸出尺度成長，但 Boss 單次傷害維持以平均生命尺度計算，
  // 避免玩家數增加後單人承傷也被不合理放大。
  boss.maxHp = Math.max(1800, Math.round(totalAttack * (6.5 + 0.5 * count)));
  boss.hp = boss.maxHp;
  return boss;
}

export function shenPhaseForHp(hp, maxHp) {
  const ratio = clamp(finite(hp) / Math.max(1, finite(maxHp, 1)), 0, 1);
  if (ratio > 0.70) return 1;
  if (ratio > 0.30) return 2;
  return 3;
}

export function shenIntentForRound({ round = 1, bossHp = 1, bossMaxHp = 1, baseAttack = 100 } = {}) {
  const turn = Math.max(1, Math.floor(finite(round, 1)));
  const phase = shenPhaseForHp(bossHp, bossMaxHp);
  const attack = Math.max(1, Math.round(finite(baseAttack, 100)));

  if (turn >= RAID_MVP.maxBossActions) {
    return {
      phase,
      name: '霜華收劍',
      cue: '最後一式。撐過去，或在這一回合擊破試煉。',
      damage: Math.round(attack * 1.60),
      kind: 'finisher'
    };
  }
  if (phase === 3) {
    return {
      phase,
      name: turn % 2 === 0 ? '清霜一念' : '寒星連斬',
      cue: '劍意已不再留手，寒氣逼近心脈。',
      damage: Math.round(attack * (turn % 2 === 0 ? 1.45 : 1.30)),
      kind: 'danger'
    };
  }
  if (phase === 2) {
    const burst = turn % 3 === 0;
    return {
      phase,
      name: burst ? '寒霜劍雨' : '流霜點劍',
      cue: burst ? '漫天劍影正在聚攏，本回合攻勢較強。' : '大師姐換了劍路，攻勢開始加快。',
      damage: Math.round(attack * (burst ? 1.28 : 1.12)),
      kind: burst ? 'burst' : 'normal'
    };
  }
  return {
    phase,
    name: turn % 4 === 0 ? '霜痕' : '試劍',
    cue: turn % 4 === 0 ? '劍鋒凝霜，比前幾式更重。' : '大師姐正在觀察你的應對。',
    damage: Math.round(attack * (turn % 4 === 0 ? 1.12 : 0.92)),
    kind: 'normal'
  };
}

export function resolveSoloRaidRound({
  round = 1,
  correct = false,
  playerHp = 1000,
  playerMaxHp = 1000,
  bossHp = 1000,
  bossMaxHp = 1000,
  outgoingDamage = 0,
  incomingDamage = 0,
  reflectedDamage = 0,
  heal = 0,
  shieldGain = 0,
  artifactShield = 0,
  coreShield = false
} = {}) {
  const turn = Math.max(1, Math.floor(finite(round, 1)));
  const maxPlayer = Math.max(1, Math.round(finite(playerMaxHp, 1000)));
  let nextPlayerHp = clamp(Math.round(finite(playerHp, maxPlayer) + Math.max(0, finite(heal))), 0, maxPlayer);
  let nextBossHp = clamp(Math.round(finite(bossHp, bossMaxHp)), 0, Math.max(1, finite(bossMaxHp, 1)));
  let nextArtifactShield = Math.max(0, Math.round(finite(artifactShield) + Math.max(0, finite(shieldGain))));
  let nextCoreShield = !!coreShield;

  const dealt = correct ? Math.max(0, Math.round(finite(outgoingDamage))) : 0;
  nextBossHp = Math.max(0, nextBossHp - dealt);

  let received = 0;
  let reflected = 0;
  let guarded = false;
  if (nextBossHp > 0 && nextPlayerHp > 0) {
    received = Math.max(0, Math.round(finite(incomingDamage)));
    if (nextCoreShield && received > 0) {
      // 道心護體與正式鬥法一致：只抵擋一次傷害，觸發後立刻消失。
      guarded = true;
      received = 0;
      nextCoreShield = false;
    }
    nextPlayerHp = Math.max(0, nextPlayerHp - received);
    reflected = received > 0 ? Math.max(0, Math.round(finite(reflectedDamage))) : 0;
    nextBossHp = Math.max(0, nextBossHp - reflected);
  }

  let finished = false;
  let won = false;
  let finishReason = '';
  if (nextBossHp <= 0) {
    finished = true;
    won = true;
    finishReason = reflected > 0 && dealt === 0 ? 'reflect' : 'boss-defeated';
  } else if (nextPlayerHp <= 0) {
    finished = true;
    finishReason = 'player-defeated';
  } else if (turn >= RAID_MVP.maxBossActions) {
    finished = true;
    finishReason = 'round-limit';
  }

  return {
    round: turn,
    dealt,
    received,
    reflected,
    guarded,
    playerHp: nextPlayerHp,
    bossHp: nextBossHp,
    artifactShield: nextArtifactShield,
    coreShield: nextCoreShield,
    bossPhase: shenPhaseForHp(nextBossHp, bossMaxHp),
    finished,
    won,
    finishReason
  };
}


export function nextPersonalQuestionAt({ issuedAtMs = 0, resolvedAtMs = 0 } = {}) {
  const issued = Math.max(0, finite(issuedAtMs));
  const resolved = Math.max(issued, finite(resolvedAtMs, issued));
  // 很快答完的人仍有最短行動週期，避免靠連點把輸出差距無限放大；
  // 花較久時間作答的人則不再額外等待。
  return Math.max(issued + RAID_MVP.minQuestionCycleMs, resolved + RAID_MVP.reviewLockMs);
}

export function bossClockState({ startedAtMs = 0, nowMs = 0, actionCount = 0 } = {}) {
  const start = Math.max(0, finite(startedAtMs));
  const now = Math.max(start, finite(nowMs, start));
  const count = Math.max(0, Math.floor(finite(actionCount)));
  const nextActionAtMs = start + (count + 1) * RAID_MVP.bossActionIntervalMs;
  const telegraphAtMs = nextActionAtMs - RAID_MVP.bossTelegraphMs;
  return {
    actionCount: count,
    nextActionAtMs,
    telegraphAtMs,
    remainingMs: Math.max(0, nextActionAtMs - now),
    telegraphing: now >= telegraphAtMs && now < nextActionAtMs,
    due: now >= nextActionAtMs,
    enraged: count >= RAID_MVP.maxBossActions
  };
}
