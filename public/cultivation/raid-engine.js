// 團本共用設定與顯示時間軸；戰鬥結算由 raid-authority.cjs 負責。
export const RAID_MVP = Object.freeze({
  modeVersion: 1,
  minimumScore: 6,
  minimumRealm: '築基期',
  // 每位玩家獨立出題；答完可立刻進入下一題，不等待隊友。
  minQuestionCycleMs: 0,
  reviewLockMs: 0,
  // Boss 使用自己的時間軸，不因任何玩家答題快慢而延後。
  bossActionIntervalMs: 18000,
  bossTelegraphMs: 5000,
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
    enraged: false
  };
}

