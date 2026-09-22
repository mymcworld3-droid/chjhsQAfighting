// 法寶鬥法效果結算：只依房間內的 artifactBattle 快照運算，不讀取本地玩家資料。
// 由房主在 Firestore transaction 內統一結算，確保雙方看到相同結果。
(function () {
  'use strict';

  const COMBO_CHANCE_CAP = 0.10;
  const CRIT_CHANCE_CAP = 0.75;
  const LIFESTEAL_CAP = 0.50;
  const REFLECT_CAP = 1;
  const REDUCTION_CAP = 0.90;

  const RUNTIME_TYPES = new Set([
    'equip_damage_percent',
    'equip_damage_reduction_flat',
    'equip_damage_reduction_percent',
    'equip_crit_chance',
    'equip_crit_damage_percent',
    'equip_combo_chance',
    'equip_lifesteal_percent',
    'equip_reflect_percent',
    'equip_true_damage_flat',
    'equip_low_hp_damage_percent',
    'equip_low_hp_reduction_percent',
    'equip_first_hit_reduction_percent',
    'equip_damage_cap_percent',
    'equip_on_correct_shield_flat',
    'equip_cheat_death',
    'equip_copy_enemy_artifact'
  ]);

  // 開場護盾在建立 battle player 時已先套用，因此不列入複製池。
  const COPYABLE_TYPES = new Set([...RUNTIME_TYPES].filter((type) =>
    type !== 'equip_copy_enemy_artifact'
  ));

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, num(value)));
  }

  function hpRatio(player) {
    const maxHp = Math.max(1, num(player?.maxHp, 1));
    return clamp(num(player?.hp, 0) / maxHp, 0, 1);
  }

  function snapshotEffects(player) {
    const list = Array.isArray(player?.artifactBattle?.effects)
      ? player.artifactBattle.effects
      : [];
    return list
      .filter((effect) => effect && RUNTIME_TYPES.has(String(effect.type || '')))
      .map((effect) => ({
        type: String(effect.type || ''),
        value: num(effect.value),
        artifactId: String(effect.artifactId || ''),
        artifactName: String(effect.artifactName || ''),
        effectIndex: Math.max(0, Math.floor(num(effect.effectIndex)))
      }));
  }

  function stableHash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function copiedEnemyEffect(player, enemy) {
    const own = snapshotEffects(player);
    if (!own.some((effect) => effect.type === 'equip_copy_enemy_artifact')) return null;

    const eligible = snapshotEffects(enemy)
      .filter((effect) => COPYABLE_TYPES.has(effect.type))
      .sort((a, b) =>
        a.artifactId.localeCompare(b.artifactId) ||
        a.effectIndex - b.effectIndex ||
        a.type.localeCompare(b.type)
      );
    if (!eligible.length) return null;

    const key = [
      String(player?.uid || ''),
      String(enemy?.uid || ''),
      ...eligible.map((effect) => `${effect.artifactId}:${effect.effectIndex}:${effect.type}`)
    ].join('|');
    const chosen = eligible[stableHash(key) % eligible.length];
    return {
      ...chosen,
      copiedFromEnemy: true,
      copiedArtifactName: chosen.artifactName || '敵方法寶'
    };
  }

  function effectiveEffects(player, enemy) {
    const own = snapshotEffects(player).filter((effect) => effect.type !== 'equip_copy_enemy_artifact');
    const copied = copiedEnemyEffect(player, enemy);
    return copied ? [...own, copied] : own;
  }

  function sumValue(effects, type) {
    return effects
      .filter((effect) => effect.type === type)
      .reduce((sum, effect) => sum + Math.max(0, num(effect.value)), 0);
  }

  function copyLabel(effects) {
    const copied = effects.find((effect) => effect.copiedFromEnemy);
    return copied ? `鏡映・${copied.copiedArtifactName}` : '';
  }

  window.getArtifactBattleOpeningShield = function (snapshot) {
    return Math.max(0, Math.round(num(snapshot?.openingShield)));
  };

  window.resolveArtifactBattleAttack = function ({ attacker, defender, baseDamage, seed = null } = {}) {
    const effects = effectiveEffects(attacker, defender);
    const base = Math.max(0, num(baseDamage));

    let damagePercent = sumValue(effects, 'equip_damage_percent');
    if (hpRatio(attacker) <= 0.30) {
      damagePercent += sumValue(effects, 'equip_low_hp_damage_percent');
    }

    const critChance = clamp(sumValue(effects, 'equip_crit_chance'), 0, CRIT_CHANCE_CAP);
    const critBonus = Math.max(0, sumValue(effects, 'equip_crit_damage_percent'));
    const comboChance = clamp(sumValue(effects, 'equip_combo_chance'), 0, COMBO_CHANCE_CAP);
    const lifestealPercent = clamp(sumValue(effects, 'equip_lifesteal_percent'), 0, LIFESTEAL_CAP);
    const trueDamage = Math.max(0, Math.round(sumValue(effects, 'equip_true_damage_flat')));
    const shieldGain = Math.max(0, Math.round(sumValue(effects, 'equip_on_correct_shield_flat')));

    const normalBase = Math.max(0, base * (1 + damagePercent));
    // Firestore transactions may retry: seeded rolls keep the same attack result on replay.
    // Unseeded callers retain the original random behavior (e.g. the legacy local mode).
    const roll = (kind) => seed === null
      ? Math.random()
      : stableHash(String(seed) + ':' + kind) / 4294967296;
    const critical = critChance > 0 && roll('critical') < critChance;
    const combo = comboChance > 0 && roll('combo') < comboChance;

    let normalDamage = normalBase;
    if (critical) normalDamage *= 1.5 + critBonus;
    // 連擊只追加一次同等基礎攻擊，不會再遞迴觸發連擊或暴擊。
    if (combo) normalDamage += normalBase;

    const labels = [];
    const copied = copyLabel(effects);
    if (copied) labels.push(copied);
    if (damagePercent > 0) labels.push(`增傷+${Math.round(damagePercent * 100)}%`);
    if (critical) labels.push('暴擊');
    if (combo) labels.push('連擊');
    if (trueDamage > 0) labels.push(`真傷+${trueDamage}`);

    return {
      normalDamage: Math.max(0, Math.round(normalDamage)),
      // 將連擊額外的一擊保留為獨立數值，道心只能擋住其中第一擊。
      comboNormalDamage: combo ? Math.max(0, Math.round(normalBase)) : 0,
      trueDamage,
      critical,
      combo,
      comboChance,
      lifestealPercent,
      shieldGain,
      copiedEffect: copied,
      skill: labels.join('・')
    };
  };

  window.resolveArtifactBattleDefense = function ({
    defender,
    attacker,
    normalDamage,
    trueDamage
  } = {}) {
    const effects = effectiveEffects(defender, attacker);
    let reductionPercent = sumValue(effects, 'equip_damage_reduction_percent');
    if (hpRatio(defender) <= 0.30) {
      reductionPercent += sumValue(effects, 'equip_low_hp_reduction_percent');
    }

    const incomingNormal = Math.max(0, num(normalDamage));
    const incomingTrue = Math.max(0, num(trueDamage));

    const firstHitReduction = sumValue(effects, 'equip_first_hit_reduction_percent');
    let firstHitTriggered = false;
    if (incomingNormal + incomingTrue > 0 && firstHitReduction > 0 && !defender?.artifactFirstHitUsed) {
      reductionPercent += firstHitReduction;
      defender.artifactFirstHitUsed = true;
      firstHitTriggered = true;
    }

    reductionPercent = clamp(reductionPercent, 0, REDUCTION_CAP);
    const flatReduction = Math.max(0, sumValue(effects, 'equip_damage_reduction_flat'));
    const reducedNormal = Math.max(0, incomingNormal * (1 - reductionPercent) - flatReduction);

    let total = reducedNormal + incomingTrue;

    const caps = effects
      .filter((effect) => effect.type === 'equip_damage_cap_percent')
      .map((effect) => clamp(effect.value, 0.05, 1));
    let damageCap = null;
    if (caps.length) {
      const capPercent = Math.min(...caps);
      damageCap = Math.max(1, Math.round(Math.max(1, num(defender?.maxHp, 1)) * capPercent));
      total = Math.min(total, damageCap);
    }

    let shield = Math.max(0, num(defender?.artifactShield));
    const shieldAbsorbed = Math.min(shield, total);
    shield -= shieldAbsorbed;
    total -= shieldAbsorbed;
    defender.artifactShield = Math.max(0, Math.round(shield));

    const hpBefore = Math.max(0, num(defender?.hp));
    let hpDamage = Math.max(0, Math.round(total));
    let cheatDeath = false;
    const hasCheatDeath = effects.some((effect) => effect.type === 'equip_cheat_death');
    if (hasCheatDeath && !defender?.artifactCheatDeathUsed && hpBefore > 1 && hpDamage >= hpBefore) {
      hpDamage = hpBefore - 1;
      defender.artifactCheatDeathUsed = true;
      cheatDeath = true;
    }

    const reflectPercent = clamp(sumValue(effects, 'equip_reflect_percent'), 0, REFLECT_CAP);
    const reflectDamage = Math.max(0, Math.round(hpDamage * reflectPercent));
    const labels = [];
    const copied = copyLabel(effects);
    if (copied) labels.push(copied);
    if (reductionPercent > 0) labels.push(`減傷${Math.round(reductionPercent * 100)}%`);
    if (flatReduction > 0) labels.push(`固定減傷${Math.round(flatReduction)}`);
    if (firstHitTriggered) labels.push('首擊護體');
    if (shieldAbsorbed > 0) labels.push(`護盾-${Math.round(shieldAbsorbed)}`);
    if (cheatDeath) labels.push('保命');

    return {
      hpDamage,
      shieldAbsorbed: Math.max(0, Math.round(shieldAbsorbed)),
      reflectDamage,
      reductionPercent,
      flatReduction,
      damageCap,
      cheatDeath,
      copiedEffect: copied,
      skill: labels.join('・')
    };
  };

  // Shared PvP/story bridge: pass final HP damage back to the sequential combat engine,
  // while mutation of artifactShield / first-hit / cheat-death remains on the player snapshot.
  window.resolveArtifactBattleHit = function ({ attacker, defender, baseDamage, seed = null } = {}) {
    const attack = window.resolveArtifactBattleAttack({ attacker, defender, baseDamage, seed });
    const defense = window.resolveArtifactBattleDefense({
      defender, attacker, normalDamage: attack.normalDamage, trueDamage: attack.trueDamage
    });
    const damage = Math.max(0, Math.round(Number(defense.hpDamage) || 0));
    return {
      damage,
      normalDamage: attack.normalDamage,
      trueDamage: attack.trueDamage,
      reflectDamage: Math.max(0, Math.round(Number(defense.reflectDamage) || 0)),
      reflectSkill: defense.skill ? `法寶反傷・${defense.skill}` : '法寶反傷',
      heal: Math.round(damage * Math.max(0, Number(attack.lifestealPercent) || 0)),
      shieldGain: Math.max(0, Number(attack.shieldGain) || 0),
      skill: [attack.skill, defense.skill].filter(Boolean).join('・')
    };
  };

  // 第一擊被金丹道心擋下時，仍需判定本次攻擊是否觸發額外連擊。
  // 不執行第一擊的法寶防禦：不能誤耗法寶護盾或一次性保命。
  window.resolveArtifactGuardedFollowup = function ({ attacker, defender, baseDamage, seed = null } = {}) {
    const attack = window.resolveArtifactBattleAttack({ attacker, defender, baseDamage, seed });
    if (!attack.combo || attack.comboNormalDamage <= 0) return null;
    const defense = window.resolveArtifactBattleDefense({
      defender, attacker, normalDamage: attack.comboNormalDamage, trueDamage: 0
    });
    const damage = Math.max(0, Math.round(Number(defense.hpDamage) || 0));
    return {
      damage,
      reflectDamage: Math.max(0, Math.round(Number(defense.reflectDamage) || 0)),
      reflectSkill: defense.skill ? `法寶反傷・${defense.skill}` : '法寶反傷',
      heal: Math.round(damage * Math.max(0, Number(attack.lifestealPercent) || 0)),
      shieldGain: Math.max(0, Number(attack.shieldGain) || 0),
      skill: [attack.skill, defense.skill].filter(Boolean).join('・')
    };
  };

  window.getArtifactBattleCopiedEffect = function (player, enemy) {
    const effect = copiedEnemyEffect(player, enemy);
    return effect ? { ...effect } : null;
  };

  window.ARTIFACT_COMBO_CHANCE_CAP = COMBO_CHANCE_CAP;
})();
