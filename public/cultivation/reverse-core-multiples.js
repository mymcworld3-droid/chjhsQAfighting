// 陰陽反轉丹：由原本「只在門檻那一次觸發」改為每逢門檻的倍數都觸發。
(function () {
  'use strict';

  const baseResolve = window.resolveGoldenCoreCultivationReward;
  const baseGetCandidate = window.getGoldenCoreState;
  const baseGetEquipped = window.getEquippedGoldenCoreState;

  if (typeof baseResolve !== 'function' || typeof baseGetEquipped !== 'function') {
    console.warn('[Reverse Core] Golden Core training module is not ready; multiple trigger patch skipped.');
    return;
  }

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function thresholdForGrade(grade) {
    return Math.max(2, clampGrade(grade) + 1);
  }

  function effectText(grade) {
    const threshold = thresholdForGrade(grade);
    return `每逢連續悟道達 ${threshold} 次的倍數（如 ${threshold}、${threshold * 2}、${threshold * 3}…），額外 +3 修為。`;
  }

  function patchSnapshot(snapshot) {
    if (!snapshot || snapshot.type !== 'reverse') return snapshot;
    return {
      ...snapshot,
      effect: effectText(snapshot.grade)
    };
  }

  if (typeof baseGetCandidate === 'function') {
    window.getGoldenCoreState = function () {
      return patchSnapshot(baseGetCandidate());
    };
  }

  window.getEquippedGoldenCoreState = function () {
    return patchSnapshot(baseGetEquipped());
  };

  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {
    const equipped = baseGetEquipped() || null;
    const result = baseResolve({ stats, isCorrect }) || {};

    if (!isCorrect || equipped?.type !== 'reverse') return result;

    const threshold = thresholdForGrade(equipped.grade);
    const streak = Math.max(0, Number(stats?.currentStreak) || 0) + 1;
    if (streak % threshold !== 0) return result;

    return {
      ...result,
      bonusGain: Math.max(3, Number(result.bonusGain) || 0),
      message: `${equipped.name || '陰陽反轉丹'}陰陽反轉，第 ${streak} 連勝觸發，額外 +3 修為`
    };
  };

  function patchDetailModal() {
    const state = window.getGoldenCoreState?.() || null;
    if (state?.type !== 'reverse') return;

    const modal = document.getElementById('training-v3-detail-modal');
    if (!modal || modal.dataset.reverseMultiplesPatched === '1') return;

    const rows = Array.from(modal.querySelectorAll('.training-v3-lore > div'));
    const setRow = (label, text) => {
      const row = rows.find((item) => item.querySelector('span')?.textContent?.trim() === label);
      const paragraph = row?.querySelector('p');
      if (paragraph) paragraph.textContent = text;
    };

    const threshold = thresholdForGrade(state.grade);
    setRow('特性效果', effectText(state.grade));
    setRow('神通', '陰陽翻轉，在指定連勝的倍數節點反覆爆發丹力。');
    setRow('修煉代價', '保持連勝，倍數越往後仍可持續觸發。');
    setRow('溫馨提醒', '一旦連勝中斷，倍數計數會從頭重新累積。');
    setRow('備註', `例如門檻為 ${threshold} 時，會在 ${threshold}、${threshold * 2}、${threshold * 3}… 觸發。至於把星期一反轉成星期五，研究經費仍在申請中。`);
    modal.dataset.reverseMultiplesPatched = '1';
  }

  const observer = new MutationObserver(patchDetailModal);
  observer.observe(document.body, { childList: true, subtree: true });
  patchDetailModal();
})();
