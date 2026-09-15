// 金丹入口守門：只有「舊版進度遷移已確認完成」且修為達 300 時，才允許金丹頁與金丹效果存在。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 300;
  const MIGRATION_FIELD = 'progressionMigrationV2';
  const MIGRATION_VERSION = 2;
  const STYLE_ID = 'golden-core-access-guard-style';
  const WRAP_FLAG = '__goldenCoreAccessGuarded';
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
    const page = document.getElementById('page-training');
    const wasVisible = !!page && !page.classList.contains('hidden');

    // 若權限變更時正停留在修煉頁，先安全退回仙府，再刪除頁面節點。
    if (wasVisible && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }

    document.getElementById('nav-training')?.remove();
    page?.remove();
    document.body?.classList.remove('cultivation-training-unlocked');
  }

  function installRuntimeGuards() {
    const resolver = window.resolveGoldenCoreCultivationReward;
    if (typeof resolver === 'function' && !resolver[WRAP_FLAG]) {
      const originalResolver = resolver;
      const guardedResolver = function (payload) {
        if (!allowed()) {
          return {
            bonusGain: 0,
            forceShield: false,
            preserveShield: false,
            message: ''
          };
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
        if (!allowed()) return null;
        return originalGetter.call(this);
      };
      Object.defineProperty(guardedGetter, WRAP_FLAG, { value: true });
      window.getGoldenCoreState = guardedGetter;
    }
  }

  function enforce() {
    installStyle();
    installRuntimeGuards();

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
  queueMicrotask(installRuntimeGuards);

  function boot() {
    enforce();
    setInterval(enforce, 250);
    window.addEventListener('xiuxian:stats-updated', enforce);
    window.addEventListener('golden-core-state-changed', enforce);

    new MutationObserver(() => {
      installRuntimeGuards();
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
