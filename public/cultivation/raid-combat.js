import { resolveSoloRaidRound } from './raid-engine.js';
import {
  resolveDeterministicAttackCore,
  resolveDeterministicCounterCore,
  resolveDeterministicCoreSupport
} from './battle-engine-v2.js';

function bossSnapshot(boss) {
  return {
    uid: boss.id,
    name: boss.name,
    hp: boss.hp,
    maxHp: boss.maxHp,
    artifactBattle: { version: 1, effects: [], openingShield: 0 },
    artifactShield: 0,
    artifactFirstHitUsed: false,
    artifactCheatDeathUsed: false
  };
}

export function resolveShenRaidCombat({ runId, round, player, boss, intent, correct } = {}) {
  const p = player;
  const enemy = bossSnapshot(boss);
  const seed = String(runId || 'shen-raid') + ':' + String(round || 1) + ':' + String(p?.uid || 'player');
  p.answer = { correct: correct === true };

  const support = resolveDeterministicCoreSupport(p, seed + ':support');
  p.coreCorrectStreak = support.streak;
  const soulHeal = correct ? Math.max(0, Number(p.nascentSoul?.coreHeal) || 0) : 0;
  const preHitHeal = Math.max(0, Math.round(Number(support.heal) || 0)) + soulHeal;
  p.hp = Math.min(p.maxHp, p.hp + preHitHeal);
  let coreShield = support.shield;
  const activations = [...support.activations];

  let outgoingDamage = 0;
  let artifactAttack = null;
  if (correct) {
    const coreAttack = resolveDeterministicAttackCore(p, seed + ':core-attack');
    if (coreAttack.activation) activations.push(coreAttack.activation);
    const soulBonus = Math.max(0, Number(p.nascentSoul?.bonusDamage) || 0);
    const baseDamage = Math.max(0, Number(p.atk) || 0) + support.bonusDamage + coreAttack.extraDamage + soulBonus;
    if (typeof window.resolveArtifactBattleHit === 'function') {
      artifactAttack = window.resolveArtifactBattleHit({
        attacker: p,
        defender: enemy,
        baseDamage,
        seed: seed + ':artifact'
      }) || null;
      outgoingDamage = Math.max(0, Math.round(Number(artifactAttack?.damage) || 0));
      const artifactHeal = Math.max(0, Math.round(Number(artifactAttack?.heal) || 0));
      p.hp = Math.min(p.maxHp, p.hp + artifactHeal);
      p.artifactShield = Math.max(0, Math.round(Number(p.artifactShield) || 0)) +
        Math.max(0, Math.round(Number(artifactAttack?.shieldGain) || 0));
    } else {
      outgoingDamage = Math.max(0, Math.round(baseDamage));
    }
  }

  const projectedBossHp = Math.max(0, Number(boss.hp) - outgoingDamage);
  let incomingDamage = 0;
  let reflectedDamage = 0;
  let defenseSkill = '';
  if (projectedBossHp > 0 && p.hp > 0) {
    if (coreShield) {
      // 交給 raid engine 消耗道心護體，避免先在法寶防禦引擎中消耗其他防護。
      incomingDamage = Math.max(0, Math.round(Number(intent?.damage) || 0));
    } else if (typeof window.resolveArtifactBattleDefense === 'function') {
      const defense = window.resolveArtifactBattleDefense({
        defender: p,
        attacker: enemy,
        normalDamage: Math.max(0, Math.round(Number(intent?.damage) || 0)),
        trueDamage: 0
      }) || null;
      const soulReduction = Math.max(0, Math.min(1000, Math.round(Number(p.nascentSoul?.reductionFlat) || 0)));
      incomingDamage = Math.max(0, Math.round(Number(defense?.hpDamage) || 0) - soulReduction);
      reflectedDamage += Math.max(0, Math.round(Number(defense?.reflectDamage) || 0));
      defenseSkill = [defense?.skill, soulReduction ? '元嬰守元-' + soulReduction : ''].filter(Boolean).join('・');
      const counter = resolveDeterministicCounterCore(p, incomingDamage, seed + ':counter');
      reflectedDamage += Math.max(0, Math.round(Number(counter.reflectDamage) || 0));
      if (counter.activation) activations.push(counter.activation);
    } else {
      incomingDamage = Math.max(0, Math.round(Number(intent?.damage) || 0));
    }
  }

  const outcome = resolveSoloRaidRound({
    round,
    correct: correct === true,
    playerHp: p.hp,
    playerMaxHp: p.maxHp,
    bossHp: boss.hp,
    bossMaxHp: boss.maxHp,
    outgoingDamage,
    incomingDamage,
    reflectedDamage,
    artifactShield: p.artifactShield,
    coreShield
  });

  p.hp = outcome.playerHp;
  p.coreShield = outcome.coreShield;
  boss.hp = outcome.bossHp;
  boss.phase = outcome.bossPhase;
  return {
    outcome,
    support,
    artifactAttack,
    defenseSkill,
    activations,
    preHitHeal
  };
}
