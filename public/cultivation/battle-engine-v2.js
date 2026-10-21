import {} from './combat-combo.js';
// Battle v2 pure engine: deterministic, replay-safe PvP settlement.
// No Firebase / DOM dependencies so round rules can be regression-tested independently.

export const NASCENT_SOUL_SCORE = 68;

export const BATTLE_V2 = Object.freeze({
  modeVersion: 2,
  roundDurationMs: 25000,
  tieWindowMs: 150,
  maxRounds: 15,
  waitingRoomTtlMs: 90000,
  disconnectTtlMs: 45000,
  nextRoundDelayMs: 2200
});

function hasSoulTalent(player) {
  const talent=player?.nascentSoul?.talent;
  return talent?.version===1 && Number(talent.top)+Number(talent.far)+Number(talent.final)>0;
}

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

  if (!answerCorrect(player)) return { reflectDamage: 0, activation: null };
  // One answer roll per round, shared by ordinary hits and later starfall damage.
  const answerSeed = String(seed).replace(/:star-counter$/, ':counter');
  const chance = chanceByGrade(core.grade, 30, 5, 70);
  if (deterministicPercent(answerSeed + ':thunder') >= chance) return { reflectDamage: 0, activation: null };

  return {
    // 答對時依品級有 30～70% 機率讓本回合金丹反擊傷害 +50%，其餘反擊率由元嬰與法寶共同累加。
    reflectDamage: Math.round(damage * .5),
    activation: {
      type: core.type,
      name: core.name,
      skill: '萬劫雷霆丹・雷光反擊',
      message: `答對蓄雷（${chance}%），本回合反擊傷害 +50%，金丹額外反擊 ${Math.round(damage * .5)} 傷害`,
      kind: '鬥法受擊效果'
    }
  };
}

function answerCorrect(player) {
  return player?.answer?.correct === true;
}

export function shouldSuppressNascentSoul(player, opponent) {
  return !!player?.nascentSoul && Math.max(0, Number(opponent?.totalScore) || 0) < NASCENT_SOUL_SCORE;
}

export function applyNascentSoulDuelRuleToPlayer(player, opponent) {
  if (!player || !shouldSuppressNascentSoul(player, opponent)) return player;

  const soul = player.nascentSoul || {};
  const currentAtk = Math.max(1, Math.round(Number(player.atk) || 200));
  const currentMaxHp = Math.max(1, Math.round(Number(player.maxHp) || 1000));
  const baseAtk = Math.max(1, Math.round(Number(player.baseAtk) ||
    (currentAtk - Math.max(0, Number(soul.attackFlat) || 0))));
  const baseMaxHp = Math.max(1, Math.round(Number(player.baseMaxHp) ||
    (currentMaxHp - Math.max(0, Number(soul.maxHpFlat) || 0))));
  const currentHp = Math.max(0, Math.min(currentMaxHp, Number(player.hp) || currentMaxHp));
  const hpRatio = currentMaxHp > 0 ? currentHp / currentMaxHp : 1;
  const soulPower = Math.round(
    Math.max(0, Number(soul.attackFlat) || 0) * 2 +
    Math.max(0, Number(soul.maxHpFlat) || 0) * 0.2
  );

  return {
    ...player,
    atk: baseAtk,
    maxHp: baseMaxHp,
    hp: Math.max(0, Math.min(baseMaxHp, Math.round(baseMaxHp * hpRatio))),
    combatPower: Math.max(0, Math.round(Number(player.combatPower) || 0) - soulPower),
    nascentSoul: null,
    nascentSoulSuppressed: true
  };
}

export function applyNascentSoulDuelRule(host, guest) {
  return {
    host: applyNascentSoulDuelRuleToPlayer(host, guest),
    guest: applyNascentSoulDuelRuleToPlayer(guest, host)
  };
}

const NEXT_REALM_THRESHOLDS = [28, 68, 188, 428, 788, 1268, 1868];
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

  const soulShieldReady = hasSoulTalent(player) ? streak % Math.max(3,Math.ceil(grade / 3)+1) === 0 : previous >= Math.max(1, Math.ceil(grade / 3));
  if (core.type === 'ningxin' && correct && soulShieldReady && !result.shield) {
    result.shield = true;
    activate('凝心靜音丹・道心護體', '連續答對，金丹道心護體成形', '鬥法防護');
  }
  if (core.type === 'wugou' && !correct && !result.shield) {
    const chance = chanceByGrade(grade, 20, 5, 60);
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
  // 元嬰神念／神通為配對時固定的數值，不重新抽機率，且只作用在答對的攻擊。
  const soulDamage = Math.max(0, Math.min(1000, Math.round(Number(player?.nascentSoul?.bonusDamage) || 0)));
  return {
    role,
    baseDamage: attackPower(player),
    followupDamage: player?.goldenCore?.type === 'sword' ? core.extraDamage : 0,
    extraDamage: (player?.goldenCore?.type === 'sword' ? 0 : core.extraDamage) + support.bonusDamage + soulDamage,
    totalDamage: attackPower(player) + (player?.goldenCore?.type === 'sword' ? 0 : core.extraDamage) + support.bonusDamage + soulDamage,
    soulDamage,
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
  resolveGuardedFollowup = null,
  resolveTalentDefense = null,
  soulTalents = globalThis.QASoulTalents || null
}) {
  // 對手若仍在金丹或以下，元嬰戰鬥投影全部封印：包含攻擊／生命屬性、加傷、減傷與護元。
  ({ host, guest } = applyNascentSoulDuelRule(host, guest));

  // Firestore server-stamped response time determines initiative, never damage eligibility.
  // Missing/timeout answers move last; timestamps tied to the millisecond defer to firstAnswerUid.
  // Older rooms without this field retain host as the deterministic last-resort tie-break.
  const turnOrder = roundTurnOrder(host, guest, firstAnswerUid);
  const attackers = [];
  const hostSupport = resolveDeterministicCoreSupport(host, roomId + ':' + round + ':' + host.uid + ':support');
  const guestSupport = resolveDeterministicCoreSupport(guest, roomId + ':' + round + ':' + guest.uid + ':support');
  // 每位玩家每次作答（無論對錯）都推進三題視窗。
  const starWindow = (member) => Math.min(3, Math.max(0, Math.floor(Number(member?.soulStarCorrectWindow)||0)) + (answerCorrect(member) ? 1 : 0));
  const hostStarCount = starWindow(host), guestStarCount = starWindow(guest);
  const starReady = Number(round)%3 === 0;
  // 元嬰終極護元每次答對時提供固定回復，丹性與品質已在配對快照中確定。
  const hostSoulHeal = answerCorrect(host) ? Math.max(0, Math.min(1000, Math.round(Number(host?.nascentSoul?.coreHeal) || 0))) : 0;
  const guestSoulHeal = answerCorrect(guest) ? Math.max(0, Math.min(1000, Math.round(Number(guest?.nascentSoul?.coreHeal) || 0))) : 0;
  hostSupport.heal += hostSoulHeal;
  guestSupport.heal += guestSoulHeal;
  const startHostHp = Math.min(Math.max(1, Number(host?.maxHp) || 1000), currentHp(host) + hostSupport.heal);
  const startGuestHp = Math.min(Math.max(1, Number(guest?.maxHp) || 1000), currentHp(guest) + guestSupport.heal);
  let hostHp = startHostHp;
  let guestHp = startGuestHp;
  // 每次凝聚的道心護體只擋一次傷害；使用後立刻消耗，下一回合不會自動恢復。
  // 金丹技能未來若再次凝聚，resolveDeterministicCoreSupport 才會重新設為 true。
  let hostCoreShield = hostSupport.shield;
  let guestCoreShield = guestSupport.shield;
  const logs = [];
  const steps = [];
  const activations = [];
  // All actual outgoing HP damage can leech, including independent strikes and counters.
  const applySoulLeech = (role, player, dealt) => {
    const hp = role === 'host' ? hostHp : guestHp;
    if (hp <= 0) return;
    const heal = soulTalents?.healing(player,dealt) || 0;
    const amount = Math.max(0,Math.min(player.maxHp,hp+heal)-hp);
    if (!amount) return;
    if (role === 'host') hostHp += amount; else guestHp += amount;
    logs.push({type:'heal',actorRole:role,actorUid:player.uid,amount,damage:0,skill:'元嬰・還神吸血'});
  };
  for (const activation of hostSupport.activations) activations.push({ ...activation, ownerUid: host.uid });
  for (const activation of guestSupport.activations) activations.push({ ...activation, ownerUid: guest.uid });
  if (hostSupport.heal && startHostHp > currentHp(host)) logs.push({ type: 'heal', actorRole: 'host', actorUid: host.uid, damage: 0, amount: startHostHp - currentHp(host), skill: hostSoulHeal ? '本命護元' : '太初回元丹・回元' });
  if (guestSupport.heal && startGuestHp > currentHp(guest)) logs.push({ type: 'heal', actorRole: 'guest', actorUid: guest.uid, damage: 0, amount: startGuestHp - currentHp(guest), skill: guestSoulHeal ? '本命護元' : '太初回元丹・回元' });

  for (const role of turnOrder) {
    // An earlier lethal hit (including Thunder reflection) ends the round immediately.
    if (hostHp <= 0 || guestHp <= 0) break;
    const player = role === 'host' ? host : guest;
    const defender = role === 'host' ? guest : host;
    const support = role === 'host' ? hostSupport : guestSupport;
    const targetRole = role === 'host' ? 'guest' : 'host';
    if (!answerCorrect(player)) {
      logs.push({ type: 'miss', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, message: '本回合作答未命中' });
      steps.push({ type: 'miss', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, hostHp, guestHp });
      continue;
    }

    player.coreCorrectStreak = support.streak;
    player.hp = role === 'host' ? hostHp : guestHp;
    defender.hp = role === 'host' ? guestHp : hostHp;
    const plan = hitPlan({ roomId, round, role, player, support });
    const talent = soulTalents?.attack(player, defender, {seed:roomId + ':' + round + ':' + player.uid, streak:support.streak}) || {normal:0,trueDamage:0,followup:0,leech:0};
    // The equipment resolver must see the current sequential HP, not the pre-round snapshot.
    if (typeof resolveEquipmentHit === 'function') {
      player.hp = role === 'host' ? hostHp : guestHp;
      defender.hp = role === 'host' ? guestHp : hostHp;
    }
    attackers.push(role);
    const guarded = role === 'host' ? guestCoreShield : hostCoreShield;
    if (guarded) {
      if (role === 'host') guestCoreShield = false;
      else hostCoreShield = false;
      logs.push({ type: 'guard', actorRole: targetRole, actorUid: defender.uid, targetUid: player.uid, damage: 0, skill: '金丹道心護體', message: '金丹道心護體抵銷一次傷害後消失' });
      activations.push({ type: defender.goldenCore?.type || 'shield', name: defender.goldenCore?.name || '金丹', ownerUid: defender.uid, skill: '金丹道心護體', message: '金丹道心護體發動並消耗，須重新凝聚', kind: '鬥法防護' });
    }
    const equipment = !guarded && typeof resolveEquipmentHit === 'function'
      ? (resolveEquipmentHit({ attacker: player, defender, baseDamage: plan.totalDamage, bonusNormalDamage:talent.normal, bonusTrueDamage:talent.trueDamage, role, round, seed: `${roomId}:${round}:${player.uid}:artifact` }) || null)
      : guarded && typeof resolveGuardedFollowup === 'function'
        ? (resolveGuardedFollowup({ attacker: player, defender, baseDamage: plan.totalDamage, bonusTrueDamage:talent.trueDamage, role, round, seed: `${roomId}:${round}:${player.uid}:artifact` }) || null)
        : null;
    // 首擊實際造成傷害後，才會開始逐段獨立連擊。
    const guardedTrue = guarded && !equipment && talent.trueDamage > 0 ? (resolveTalentDefense ?
      Math.max(0,Math.round(resolveTalentDefense({attacker:player,defender,normalDamage:0,trueDamage:talent.trueDamage})?.hpDamage || 0)) : talent.trueDamage) : 0;
    const incomingDamage = (equipment ? Math.max(0, Math.round(Number(equipment.damage) || 0)) : guarded ? 0 : plan.totalDamage + talent.normal) + guardedTrue;
    // 元嬰守元在最後結算每次實際受擊傷害；護體格擋仍優先。
    const reduction = guarded || equipment?.soulReductionApplied ? 0 : Math.max(0, Math.min(1000, Math.round(Number(defender?.nascentSoul?.reductionFlat) || 0)));
    const damage = Math.max(0, incomingDamage - reduction) + (!equipment && !guarded ? talent.trueDamage : 0);
    const beforeHostHp = hostHp, beforeGuestHp = guestHp;
    const targetBefore = role === 'host' ? guestHp : hostHp;
    if (role === 'host') guestHp = Math.max(0, guestHp - damage);
    else hostHp = Math.max(0, hostHp - damage);
    const coreEffect = plan.activation || (support.bonusDamage > 0 ? support.activations[0] : null);
    const attack = { type: 'attack', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage, baseDamage: plan.baseDamage, extraDamage: plan.extraDamage + talent.normal + talent.trueDamage,
      critical: !guarded && equipment?.critical === true, coreEffect,
      skill: [coreEffect?.skill, plan.soulDamage ? '元嬰神通' : '', talent.normal || talent.trueDamage ? '元嬰・' + talent.name + (talent.trueDamage ? '真傷' : '') : '', equipment?.skill].filter(Boolean).join('・') };
    logs.push(attack);
    if (guarded) {
      steps.push({ ...attack, damage: 0, guarded: true, hostHp: beforeHostHp, guestHp: beforeGuestHp });
      if (equipment || guardedTrue) steps.push({ ...attack, damage, guarded: false, coreEffect: null, skill: [attack.skill, guardedTrue || equipment?.trueDamage ? '真傷・穿透道心' : '連擊'].filter(Boolean).join('・'), hostHp, guestHp });
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
    let talentReceived = Math.min(targetBefore, damage), talentReflect = 0;
    // 真傷不會被雷反視為承傷；法寶結算傳回已扣血的普通傷害。
    let normalReceived = Math.min(targetBefore, equipment ?
      Math.max(0, Math.round(Number(equipment.normalHpDamage ?? (damage - (Number(equipment.trueDamage)||0) - talent.trueDamage)) || 0)) :
      Math.max(0, damage - Math.min(damage, Math.max(0, Number(talent.trueDamage)||0))));
    if (guarded) normalReceived = 0;
    const comboStats = globalThis.QACombatCombo.stats(player,player.artifactBattle?.effects || []);
    const combos = globalThis.QACombatCombo.chain({damage:Math.min(targetBefore,damage),
      chance:equipment?.comboChance ?? comboStats.chance,multiplier:equipment?.comboMultiplier ?? comboStats.multiplier,
      seed:`${roomId}:${round}:${player.uid}:artifact`,remainingHp:role === 'host' ? guestHp : hostHp,
      onHit(raw,index) {
        defender.hp = role === 'host' ? guestHp : hostHp;
        const defended = resolveTalentDefense?.({attacker:player,defender,normalDamage:raw,trueDamage:0});
        const dealt = defended ? Math.max(0,Math.round(defended.hpDamage || 0)) : Math.max(0,raw-(Number(defender.nascentSoul?.reductionFlat)||0));
        if (!dealt) return 0;
        talentReceived += Math.min(defender.hp,dealt);
        normalReceived += Math.min(defender.hp,dealt);
        talentReflect += Math.max(0,Math.round(defended?.reflectDamage || 0));
        if (role === 'host') guestHp = Math.max(0,guestHp-dealt); else hostHp = Math.max(0,hostHp-dealt);
        const step = {type:'attack',actorRole:role,actorUid:player.uid,targetUid:defender.uid,damage:dealt,baseDamage:0,extraDamage:dealt,combo:true,comboIndex:index+1,critical:false,guarded:false,skill:'連擊 '+(index+1),hostHp,guestHp};
        steps.push(step); logs.push(step);
        return dealt;
      }});
    const pursuit = talent.followup + plan.followupDamage;
    // One isolated follow-up: defense still applies, attack procs never run again.
    if (pursuit > 0 && hostHp > 0 && guestHp > 0) {
      defender.hp = role === 'host' ? guestHp : hostHp;
      const defended = resolveTalentDefense?.({attacker:player,defender,normalDamage:pursuit,trueDamage:0});
      const followDamage = defended ? Math.max(0, Math.round(defended.hpDamage || 0)) :
        Math.max(0,pursuit - Math.max(0,Number(defender?.nascentSoul?.reductionFlat)||0));
      talentReceived += Math.min(defender.hp, followDamage);
      normalReceived += Math.min(defender.hp, followDamage);
      talentReflect += Math.max(0,Math.round(defended?.reflectDamage || 0));
      if (role === 'host') guestHp = Math.max(0,guestHp-followDamage);
      else hostHp = Math.max(0,hostHp-followDamage);
      steps.push({type:'attack',actorRole:role,actorUid:player.uid,targetUid:defender.uid,
        damage:followDamage,baseDamage:0,extraDamage:followDamage,guarded:false,pursuit:true,critical:false,skill:plan.followupDamage ? '九天劍氣丹・追擊' : '元嬰・' + talent.name + '追擊',hostHp,guestHp});
    }
    applySoulLeech(role,player,talentReceived);
    // Step HP records must include any instant post-hit recovery before animation playback.
    steps[steps.length - 1].hostHp = hostHp;
    steps[steps.length - 1].guestHp = guestHp;
    if (hostHp <= 0 || guestHp <= 0) break;

    // A surviving defender may reflect damage. The attacker must survive to take a later action.
    if (talentReceived > 0) {
      const counter = resolveDeterministicCounterCore(defender, normalReceived, roomId + ':' + round + ':' + defender.uid + ':counter');
      const soulReflect = soulTalents?.reflection(defender,normalReceived) || 0;
      const weaponReflect = Math.max(0, Math.round(Number(equipment?.reflectDamage) || 0)) + talentReflect;
      // 一次合併金丹 + 武器反擊率，避免分別四捨五入產生的 1 點差異（如 16%+50%=66%）。
      const coreBonus = counter.activation?.type === 'thunder' ? .5 : 0;
      const combinedCoreWeapon = normalReceived > 0 && coreBonus > 0 && weaponReflect > 0
        ? Math.round(normalReceived*(coreBonus + weaponReflect/normalReceived))
        : counter.reflectDamage + weaponReflect;
      counter.reflectDamage = combinedCoreWeapon + soulReflect;
      if(soulReflect > 0)counter.activation=counter.activation || {type:'nascent-soul',skill:'元嬰・雷返反傷',name:'雷霆元嬰',message:'雷返反傷',kind:'元嬰受擊效果'};
      if (equipment?.reflectDamage > 0) {
        counter.activation = counter.activation || { type: 'artifact', skill: equipment.reflectSkill || '法寶反傷', name: '法寶', message: '法寶反傷觸發', kind: '鬥法受擊效果' };
      }
      if (counter.reflectDamage > 0) {
        const counterTargetHp = role === 'host' ? hostHp : guestHp;
        const counterGuarded = role === 'host' ? hostCoreShield : guestCoreShield;
        if (counterGuarded) {
          if (role === 'host') hostCoreShield = false;
          else guestCoreShield = false;
          logs.push({ type: 'guard', actorRole: role, actorUid: player.uid, targetUid: defender.uid, damage: 0, skill: '金丹道心護體', message: '金丹道心護體抵銷一次反擊傷害後消失' });
          activations.push({ type: player.goldenCore?.type || 'shield', name: player.goldenCore?.name || '金丹', ownerUid: player.uid, skill: '金丹道心護體', message: '金丹道心護體發動並消耗，須重新凝聚', kind: '鬥法防護' });
        } else if (role === 'host') hostHp = Math.max(0, hostHp - counter.reflectDamage);
        else guestHp = Math.max(0, guestHp - counter.reflectDamage);
        applySoulLeech(targetRole,defender,counterGuarded ? 0 : Math.min(counterTargetHp,counter.reflectDamage));
        const reflected = { type: 'counter', actorRole: targetRole, actorUid: defender.uid, targetUid: player.uid, damage: counterGuarded ? 0 : counter.reflectDamage, guarded: counterGuarded, critical: false,
          coreEffect: counter.activation?.type === defender.goldenCore?.type ? counter.activation : null,
          skill: counter.activation?.skill || '' };
        logs.push(reflected);
        steps.push({ ...reflected, hostHp, guestHp });
        if (counter.activation) activations.push({ ...counter.activation, ownerUid: defender.uid });
      }
    }
  }
  
  // 星辰元嬰每三次作答觸發一次；即使第三題答錯，也按三題中答對數結算。
  // 星隕是獨立普通傷害，不繼承法寶暴擊/連擊，也不攜帶真實傷害。
  if (starReady) for (const role of turnOrder) {
    if (hostHp <= 0 || guestHp <= 0) break;
    const player = role === 'host' ? host : guest;
    const defender = role === 'host' ? guest : host;
    const targetRole = role === 'host' ? 'guest' : 'host';
    const correctCount = role === 'host' ? hostStarCount : guestStarCount;
    const raw = Math.max(0, Math.round(Number(soulTalents?.starfall?.(player,correctCount))||0));
    if (!raw) continue;
    const guarded = role === 'host' ? guestCoreShield : hostCoreShield;
    if (guarded) {
      if (role === 'host') guestCoreShield = false;
      else hostCoreShield = false;
    }
    defender.hp = role === 'host' ? guestHp : hostHp;
    const defended = guarded ? null : resolveTalentDefense?.({attacker:player,defender,normalDamage:raw,trueDamage:0});
    const reduced = guarded ? 0 : defended ?
      Math.max(0,Math.round(Number(defended.hpDamage)||0)) :
      Math.max(0,raw - Math.max(0,Number(defender.nascentSoul?.reductionFlat)||0));
    const actual = Math.min(role === 'host' ? guestHp : hostHp,reduced);
    if (role === 'host') guestHp -= actual;
    else hostHp -= actual;
    applySoulLeech(role,player,actual);
    const starAttack = {type:'attack',actorRole:role,actorUid:player.uid,targetUid:defender.uid,
      damage:actual,baseDamage:0,extraDamage:raw,guarded,critical:false,
      skill:'元嬰・星隕（近三題答對 '+correctCount+'/3）'};
    logs.push(starAttack);steps.push({...starAttack,hostHp,guestHp});
    activations.push({type:'xingchen',name:'星辰元嬰',ownerUid:player.uid,
      skill:'元嬰・星隕',message:'三題蓄星：答對 '+correctCount+'/3，星隕傷害 '+actual,kind:'元嬰攻擊效果'});
    if (!actual || hostHp<=0 || guestHp<=0) continue;
    const counter = resolveDeterministicCounterCore(defender,actual,roomId+':'+round+':'+defender.uid+':star-counter');
    const reflect = counter.reflectDamage + Math.max(0,Math.round(Number(defended?.reflectDamage)||0)) +
      Math.max(0,Math.round(Number(soulTalents?.reflection?.(defender,actual))||0));
    if (reflect>0) {
      const counterTargetHp = role === 'host' ? hostHp : guestHp;
      const coreGuard = role==='host' ? hostCoreShield : guestCoreShield;
      if (coreGuard) {
        if (role==='host')hostCoreShield=false;else guestCoreShield=false;
      } else if (role==='host') hostHp=Math.max(0,hostHp-reflect);
      else guestHp=Math.max(0,guestHp-reflect);
      applySoulLeech(targetRole,defender,coreGuard ? 0 : Math.min(counterTargetHp,reflect));
      const record = {type:'counter',actorRole:targetRole,actorUid:defender.uid,targetUid:player.uid,
        damage:coreGuard?0:reflect,guarded:coreGuard,critical:false,skill:counter.activation?.skill||'星隕反擊'};
      logs.push(record);steps.push({...record,hostHp,guestHp});
      if(counter.activation)activations.push({...counter.activation,ownerUid:defender.uid});
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
    hostStarCorrectWindow: starReady ? 0 : hostStarCount,
    guestStarCorrectWindow: starReady ? 0 : guestStarCount,
    hostArtifactState: { artifactShield: host.artifactShield || 0, artifactFirstHitUsed: !!host.artifactFirstHitUsed, artifactCheatDeathUsed: !!host.artifactCheatDeathUsed },
    guestArtifactState: { artifactShield: guest.artifactShield || 0, artifactFirstHitUsed: !!guest.artifactFirstHitUsed, artifactCheatDeathUsed: !!guest.artifactCheatDeathUsed },
    logs,
    activations,
    finished: winnerUid !== null,
    winnerUid,
    finishReason
  };
}
