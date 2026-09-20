import { equipmentShellMarkup, refineryShellMarkup } from './training-shared-shells.js';
// 築基期修煉頁：10～27 修為開放背包與煉器；踏入金丹後交棒給完整修煉模組。
(function () {
  'use strict';

  const CSS_HREF = 'cultivation-training-v3.css';
  const FOUNDATION_SCORE = 10;
  const GOLDEN_CORE_SCORE = 28;
  let lastStage = null;

  function score() {
    return Math.max(0, Number(window.getCurrentUserData?.()?.stats?.totalScore) || 0);
  }

  function migrationReady() {
    const marker = window.getCurrentUserData?.()?.progressionMigrationV2;
    return Number(marker?.version) >= 2;
  }

  function foundationStage() {
    const value = score();
    // 築基的背包與煉器屬於基礎修煉功能，只依實際修為解鎖。
    // 舊角色若缺少 progressionMigrationV2 標記，也不能因此永久失去煉器。
    return !!window.getCurrentUserData?.()?.stats &&
      value >= FOUNDATION_SCORE && value < GOLDEN_CORE_SCORE;
  }

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function createNavButton() {
    if (document.getElementById('nav-training')) return;
    const nav = document.getElementById('nav-grid');
    const homeButton = nav?.querySelector('[data-target="page-home"]');
    if (!nav || !homeButton) return;

    const button = document.createElement('button');
    button.id = 'nav-training';
    button.type = 'button';
    button.dataset.target = 'page-training';
    button.dataset.foundationTraining = '1';
    button.className = 'nav-btn training-nav-btn group flex-1 flex flex-col items-center justify-center h-full transition-all';
    button.innerHTML = '<div class="relative p-1 training-nav-orb"><i class="fa-solid fa-fire-flame-curved text-lg"></i></div><span class="text-[10px] mt-1">修煉</span>';
    button.addEventListener('click', () => window.switchToPage?.('page-training'));
    homeButton.insertAdjacentElement('afterend', button);
  }

  function bagMarkup() {
    // 真正背包由 unified-inventory-grid 接手；不要先畫舊式純文字卡。
    return '<section class="uib-bag-loading" aria-hidden="true"></section>';
  }

  function createPage() {
    const home = document.getElementById('page-home');
    if (!home) return;

    let page = document.getElementById('page-training');
    if (!page) {
      page = document.createElement('div');
      page.id = 'page-training';
      page.className = 'page-section hidden px-4 training-page training-page-v3 foundation-training-page';
      page.innerHTML = `
        <div class="training-page-heading-v3"></div>
        <div class="training-subtabs-v3" role="tablist">
          <button type="button" class="training-subtab-v3" data-training-tab="refinery" aria-selected="false"><i class="fa-solid fa-hammer"></i><span>煉器</span></button>
          <button type="button" class="training-subtab-v3" data-training-tab="equipment" aria-selected="false"><i class="fa-solid fa-shield-halved"></i><span>裝備</span></button>
          <button type="button" class="training-subtab-v3 active" data-training-tab="bag" aria-selected="true"><i class="fa-solid fa-box-open"></i><span>背包</span></button>
        </div>
        <div id="training-tab-content">${bagMarkup()}</div>
      `;
      home.insertAdjacentElement('afterend', page);
    }

    const alreadyHydrated = page.dataset.foundationTrainingReady === '1' && page.dataset.foundationTraining === '1';
    page.dataset.foundationTraining = '1';
    page.classList.add('foundation-training-page', 'training-page', 'training-page-v3');
    if (alreadyHydrated) return;
    page.dataset.foundationTrainingReady = '1';

    const heading = page.querySelector('.training-page-heading-v3');
    if (heading) heading.innerHTML = '';

    const coreTab = page.querySelector('[data-training-tab="core"]');
    coreTab?.classList.add('hidden');
    // 舊靜態殼層也補齊裝備入口，四個裝配欄由統一裝備視圖渲染。
    if (!page.querySelector('[data-training-tab="equipment"]')) {
      const bag = page.querySelector('[data-training-tab="bag"]');
      bag?.insertAdjacentHTML('beforebegin', '<button type="button" class="training-subtab-v3" data-training-tab="equipment" aria-selected="false"><i class="fa-solid fa-shield-halved"></i><span>裝備</span></button>');
    }

    page.querySelectorAll('[data-training-tab]').forEach((tab) => {
      const selected = tab.dataset.trainingTab === 'bag';
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    });

    const content = page.querySelector('#training-tab-content');
    if (content) content.innerHTML = bagMarkup();

    if (page.dataset.foundationTrainingBound === '1') return;
    page.dataset.foundationTrainingBound = '1';

    page.querySelector('[data-training-tab="refinery"]')?.addEventListener('click', () => {
      if (!foundationStage()) return;
      // 同一個入口交給煉器模組負責狀態、內容與事件，避免兩個 click handler
      // 在使用者快速切換時互相覆寫。模組尚未準備好時才顯示預載殼層。
      const content = page.querySelector('#training-tab-content');
      if (typeof window.openCultivationRefinery === 'function') {
        window.openCultivationRefinery();
      } else {
        page.querySelectorAll('[data-training-tab]').forEach((tab) => {
          const selected = tab.dataset.trainingTab === 'refinery';
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        if (content && !content.querySelector('.cultivation-refinery')) content.innerHTML = refineryShellMarkup();
        window.dispatchEvent(new CustomEvent('xiuxian:refinery-open-request'));
      }
    });

    page.querySelector('[data-training-tab="equipment"]')?.addEventListener('click', () => {
      if (!foundationStage()) return;
      page.querySelectorAll('[data-training-tab]').forEach((tab) => {
        const selected = tab.dataset.trainingTab === 'equipment';
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const content = page.querySelector('#training-tab-content');
      if (content) content.innerHTML = equipmentShellMarkup();
      window.openCultivationEquipment?.();
      window.dispatchEvent(new CustomEvent('xiuxian:equipment-open-request'));
    });

    page.querySelector('[data-training-tab="bag"]')?.addEventListener('click', () => {
      if (!foundationStage()) return;
      page.querySelectorAll('[data-training-tab]').forEach((tab) => {
        const selected = tab.dataset.trainingTab === 'bag';
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const content = page.querySelector('#training-tab-content');
      if (content) content.innerHTML = bagMarkup();
    });
  }

  function ensureFoundationUI() {
    loadStyle();
    createNavButton();
    createPage();
    document.body.classList.add('cultivation-training-unlocked');
    document.body.classList.add('foundation-training-only');
  }

  function removeFoundationUI() {
    const page = document.querySelector('#page-training[data-foundation-training="1"]');
    const nav = document.querySelector('#nav-training[data-foundation-training="1"]');
    if (!page && !nav) {
      document.body.classList.remove('foundation-training-only');
      return;
    }

    const wasVisible = !!page && !page.classList.contains('hidden');
    if (wasVisible && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }

    nav?.remove();
    if (page?.dataset.staticLayout === '1') {
      page.classList.add('hidden');
      page.classList.remove('active-page', 'foundation-training-page');
      delete page.dataset.foundationTraining;
      delete page.dataset.foundationTrainingReady;
    } else {
      page?.remove();
    }
    document.body.classList.remove('foundation-training-only');

    // 只有真的離開「整個修煉系統」時才移除 unlocked。
    // 若已踏入金丹，金丹模組仍擁有這個 class，築基模組不得反覆拿掉它。
    if (!window.isGoldenCoreUnlocked?.()) {
      document.body.classList.remove('cultivation-training-unlocked');
    }
  }

  function sync() {
    const active = foundationStage();
    if (lastStage === active) return;

    if (active) ensureFoundationUI();
    else if (lastStage === true) removeFoundationUI();

    lastStage = active;
    window.dispatchEvent(new CustomEvent('foundation-training-stage-changed', {
      detail: { active, score: score(), foundationScore: FOUNDATION_SCORE, goldenCoreScore: GOLDEN_CORE_SCORE }
    }));
  }

  window.isFoundationTrainingStage = foundationStage;

  function boot() {
    sync();
    ['xiuxian:stats-updated','xiuxian:user-ready','xiuxian:migration-ready','golden-core-access-changed']
      .forEach((name) => window.addEventListener(name, sync));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
