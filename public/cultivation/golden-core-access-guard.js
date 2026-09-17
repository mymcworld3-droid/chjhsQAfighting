// 兩階段修煉守門：築基 60 開修煉背包；金丹 120 才開金丹、狀態與金丹效果。
(function () {
  'use strict';

  const FOUNDATION_SCORE = 10;
  const GOLDEN_CORE_SCORE = 28;
  const MIGRATION_FIELD = 'progressionMigrationV2';
  const MIGRATION_VERSION = 2;
  const STYLE_ID = 'golden-core-access-guard-style';
  const WRAP_FLAG = '__goldenCoreAccessGuarded';
  let lastTrainingAllowed = null;
  let lastCoreAllowed = null;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html:not(.training-access-ready) #nav-training,
      html:not(.training-access-ready) #page-training {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      html:not(.golden-core-access-ready) [data-training-tab="core"],
      html:not(.golden-core-access-ready) #training-status-tab {
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

  function trainingAllowed() {
    return migrationReady() && score() >= FOUNDATION_SCORE;
  }

  function coreAllowed() {
    return migrationReady() && score() >= GOLDEN_CORE_SCORE;
  }

  function removeAllTrainingUI() {
    const page = document.getElementById('page-training');
    const wasVisible = !!page && !page.classList.contains('hidden');
    if (wasVisible && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }
    document.getElementById('nav-training')?.remove();
    page?.remove();
    document.body?.classList.remove('cultivation-training-unlocked', 'foundation-training-only');
  }

  function installRuntimeGuards() {
    const resolver = window.resolveGoldenCoreCultivationReward;
    if (typeof resolver === 'function' && !resolver[WRAP_FLAG]) {
      const originalResolver = resolver;
      const guardedResolver = function (payload) {
        if (!coreAllowed()) {
          return { bonusGain: 0, forceShield: false, preserveShield: false, message: '' };
        }
        return originalResolver.call(this, payload);
      };
      Object.defineProperty(guardedResolver, WRAP_FLAG, { value: true });
      window.resolveGoldenCoreCultivationReward = guardedResolver;
    }

    const getter = window.getGoldenCoreState;
    if (typeof getter === 'function' && !getter[WRAP_FLAG]) {
      const originalGetter = getter;
      const guardedGetter = function () {
        if (!coreAllowed()) return null;
        return originalGetter.call(this);
      };
      Object.defineProperty(guardedGetter, WRAP_FLAG, { value: true });
      window.getGoldenCoreState = guardedGetter;
    }
  }

  function enforce() {
    installStyle();
    installRuntimeGuards();

    const canTrain = trainingAllowed();
    const canUseCore = coreAllowed();
    document.documentElement.classList.toggle('training-access-ready', canTrain);
    document.body?.classList.toggle('training-access-ready', canTrain);
    document.documentElement.classList.toggle('golden-core-access-ready', canUseCore);
    document.body?.classList.toggle('golden-core-access-ready', canUseCore);

    if (!canTrain) removeAllTrainingUI();

    if (lastTrainingAllowed !== canTrain) {
      lastTrainingAllowed = canTrain;
      window.dispatchEvent(new CustomEvent('training-access-changed', {
        detail: { unlocked: canTrain, score: score(), requiredScore: FOUNDATION_SCORE, migrationReady: migrationReady() }
      }));
    }

    if (lastCoreAllowed !== canUseCore) {
      lastCoreAllowed = canUseCore;
      window.dispatchEvent(new CustomEvent('golden-core-access-changed', {
        detail: { unlocked: canUseCore, score: score(), requiredScore: GOLDEN_CORE_SCORE, migrationReady: migrationReady() }
      }));
    }
  }

  window.isXiuxianTrainingUnlocked = trainingAllowed;
  window.isGoldenCoreUnlocked = coreAllowed;
  window.TRAINING_UNLOCK_SCORE = FOUNDATION_SCORE;
  window.GOLDEN_CORE_UNLOCK_SCORE = GOLDEN_CORE_SCORE;

  installStyle();
  queueMicrotask(installRuntimeGuards);

  function boot() {
    enforce();
    setInterval(enforce, 250);
    window.addEventListener('xiuxian:stats-updated', enforce);
    window.addEventListener('golden-core-state-changed', enforce);

    new MutationObserver(() => {
      installRuntimeGuards();
      if (!trainingAllowed() && (document.getElementById('nav-training') || document.getElementById('page-training'))) {
        removeAllTrainingUI();
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
