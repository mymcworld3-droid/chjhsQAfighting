// 金丹入口守門：只有「舊版進度遷移已確認完成」且修為達 300 時，才允許金丹頁存在／顯示。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 300;
  const MIGRATION_FIELD = 'progressionMigrationV2';
  const MIGRATION_VERSION = 2;
  const STYLE_ID = 'golden-core-access-guard-style';
  let lastAllowed = null;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html:not(.golden-core-access-ready) #nav-training,
      html:not(.golden-core-access-ready) #page-training {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function data() {
    return window.getCurrentUserData?.() || null;
  }

  function score() {
    return Math.max(0, Number(data()?.stats?.totalScore) || 0);
  }

  function migrationReady() {
    const marker = data()?.[MIGRATION_FIELD];
    return Number(marker?.version) >= MIGRATION_VERSION;
  }

  function allowed() {
    return migrationReady() && score() >= GOLDEN_CORE_SCORE;
  }

  function removeLockedTrainingUI() {
    document.getElementById('nav-training')?.remove();
    document.getElementById('page-training')?.remove();
    document.body?.classList.remove('cultivation-training-unlocked');

    // 若舊程式在權限變更前已切進修煉頁，立刻安全退回仙府。
    const visibleTraining = document.querySelector('#page-training:not(.hidden)');
    if (visibleTraining && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }
  }

  function enforce() {
    installStyle();
    const canOpen = allowed();
    document.documentElement.classList.toggle('golden-core-access-ready', canOpen);
    document.body?.classList.toggle('golden-core-access-ready', canOpen);

    if (!canOpen) removeLockedTrainingUI();

    if (lastAllowed !== canOpen) {
      lastAllowed = canOpen;
      window.dispatchEvent(new CustomEvent('golden-core-access-changed', {
        detail: {
          unlocked: canOpen,
          score: score(),
          requiredScore: GOLDEN_CORE_SCORE,
          migrationReady: migrationReady()
        }
      }));
    }
  }

  window.isGoldenCoreUnlocked = allowed;
  window.GOLDEN_CORE_UNLOCK_SCORE = GOLDEN_CORE_SCORE;

  installStyle();

  function boot() {
    enforce();
    setInterval(enforce, 250);
    window.addEventListener('xiuxian:stats-updated', enforce);
    window.addEventListener('golden-core-state-changed', enforce);

    new MutationObserver(() => {
      // 舊模組若在鎖定期間重新建立入口，會立即被移除；CSS 同時避免任何閃現。
      if (!allowed() && (document.getElementById('nav-training') || document.getElementById('page-training'))) {
        removeLockedTrainingUI();
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
