// 築基期修煉頁：60～119 修為只顯示背包；踏入金丹後交棒給完整修煉模組。
(function () {
  'use strict';

  const CSS_HREF = 'cultivation-training-v3.css';
  const FOUNDATION_SCORE = 60;
  const GOLDEN_CORE_SCORE = 120;
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
    return migrationReady() && value >= FOUNDATION_SCORE && value < GOLDEN_CORE_SCORE;
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
    return `
      <section class="training-v3-empty foundation-training-bag">
        <i class="fa-solid fa-box-open"></i>
        <h3>修煉背包</h3>
        <p>修煉途中取得的特殊物品會收納於此。</p>
      </section>
    `;
  }

  function createPage() {
    if (document.getElementById('page-training')) return;
    const home = document.getElementById('page-home');
    if (!home) return;

    const page = document.createElement('div');
    page.id = 'page-training';
    page.dataset.foundationTraining = '1';
    page.className = 'page-section hidden px-4 training-page training-page-v3 foundation-training-page';
    page.innerHTML = `
      <div class="training-page-heading-v3"></div>
      <div class="training-subtabs-v3" role="tablist">
        <button type="button" class="training-subtab-v3 active" data-training-tab="bag" aria-selected="true">
          <i class="fa-solid fa-box-open"></i><span>背包</span>
        </button>
      </div>
      <div id="training-tab-content">${bagMarkup()}</div>
    `;
    home.insertAdjacentElement('afterend', page);
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
    const wasVisible = !!page && !page.classList.contains('hidden');

    if (wasVisible && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }

    nav?.remove();
    page?.remove();
    document.body.classList.remove('foundation-training-only');
    if (!document.getElementById('page-training')) {
      document.body.classList.remove('cultivation-training-unlocked');
    }
  }

  function sync() {
    const active = foundationStage();
    if (active) ensureFoundationUI();
    else removeFoundationUI();

    if (lastStage !== active) {
      lastStage = active;
      window.dispatchEvent(new CustomEvent('foundation-training-stage-changed', {
        detail: { active, score: score(), foundationScore: FOUNDATION_SCORE, goldenCoreScore: GOLDEN_CORE_SCORE }
      }));
    }
  }

  window.isFoundationTrainingStage = foundationStage;

  function boot() {
    sync();
    setInterval(sync, 450);
    window.addEventListener('xiuxian:stats-updated', sync);
    window.addEventListener('golden-core-access-changed', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
