// 已裝備金丹的鬥法效果。戰鬥房只保存種類與品級，不保存整份修煉狀態。
(function () {
  'use strict';

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function chanceByGrade(grade, base, step, cap = 100) {
    return Math.min(cap, base + (9 - clampGrade(grade)) * step);
  }

  function triggered(chance) {
    return Math.random() * 100 < chance;
  }

  function battleCore(player) {
    const core = player?.goldenCore;
    if (!core || !core.type) return null;
    return { ...core, grade: clampGrade(core.grade) };
  }

  window.getEquippedGoldenCoreBattleSnapshot = function () {
    const core = window.getEquippedGoldenCoreState?.() || null;
    if (!core?.equipped) return null;
    return {
      type: core.type,
      grade: clampGrade(core.grade),
      name: core.name || '金丹'
    };
  };

  window.resolveGoldenCoreBattleAttack = function ({ attacker } = {}) {
    const core = battleCore(attacker);
    if (!core) return { extraDamage: 0 };

    if (core.type === 'ocean') {
      const chance = chanceByGrade(core.grade, 10, 5, 50);
      if (triggered(chance)) {
        return {
          extraDamage: 100,
          skill: '大海無垠丹・千尺巨浪',
          message: `大海無垠丹觸發，額外造成 100 傷害（${chance}%）`
        };
      }
    }

    if (core.type === 'sword') {
      const chance = chanceByGrade(core.grade, 10, 5, 50);
      if (triggered(chance)) {
        return {
          extraDamage: 200,
          skill: '破鋒劍心丹・萬劍追擊',
          message: `破鋒劍心丹觸發，額外造成 200 傷害（${chance}%）`
        };
      }
    }

    return { extraDamage: 0 };
  };

  window.resolveGoldenCoreBattleCounter = function ({ defender, receivedDamage } = {}) {
    const core = battleCore(defender);
    if (!core || core.type !== 'thunder') return { reflectDamage: 0 };

    const chance = chanceByGrade(core.grade, 10, 10, 90);
    if (!triggered(chance)) return { reflectDamage: 0 };

    const damage = Math.max(0, Math.round(Number(receivedDamage) || 0));
    if (!damage) return { reflectDamage: 0 };

    return {
      reflectDamage: damage,
      skill: '萬劫雷霆丹・雷光反擊',
      message: `萬劫雷霆丹觸發，反擊 ${damage} 傷害（${chance}%）`
    };
  };
})();
