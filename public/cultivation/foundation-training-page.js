// 築基期修煉頁：10～27 修為只顯示背包；踏入金丹後交棒給完整修煉模組。
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

  function refineryShellMarkup() {
    const materials = Array.from({ length: 8 }, (_, index) =>
      `<div class="refinery-shell-material" aria-hidden="true"><span class="refinery-shell-icon"></span><span class="refinery-shell-line"></span><small>材料 ${index + 1}</small></div>`
    ).join('');
    const slots = Array.from({ length: 8 }, (_, index) =>
      `<div class="refinery-shell-slot"><span class="idx">${index + 1}</span><span>＋</span></div>`
    ).join('');
    return `
      <section class="cultivation-refinery refinery-shell" aria-busy="true">
        <article class="refinery-panel">
          <div class="refinery-head"><div><h3><i class="fa-solid fa-gem"></i> 持有材料</h3><p>材料資料載入後會直接填入固定格位。</p></div><span class="refinery-badge">載入中</span></div>
          <div class="refinery-shell-material-grid">${materials}</div>
        </article>
        <article class="refinery-panel">
          <div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>8 格煉器陣已預先建立。</p></div><span class="refinery-badge">0/8</span></div>
          <div class="refinery-shell-slots">${slots}</div>
          <div class="refinery-shell-summary">投入：尚未投入材料</div>
          <div class="refinery-shell-match">放入材料後，依材料數量自動辨識法寶配方。</div>
          <div class="refinery-shell-actions"><button type="button" disabled>清空</button><button type="button" disabled><i class="fa-solid fa-fire"></i> 煉器</button></div>
        </article>
      </section>
    `;
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
          <button type="button" class="training-subtab-v3 active" data-training-tab="bag" aria-selected="true"><i class="fa-solid fa-box-open"></i><span>背包</span></button>
        </div>
        <div id="training-tab-content">${bagMarkup()}</div>
      `;
      home.insertAdjacentElement('afterend', page);
    }

    page.dataset.foundationTraining = '1';
    page.classList.add('foundation-training-page', 'training-page', 'training-page-v3');

    const heading = page.querySelector('.training-page-heading-v3');
    if (heading) heading.innerHTML = '';

    const coreTab = page.querySelector('[data-training-tab="core"]');
    coreTab?.classList.add('hidden');

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
      page.querySelectorAll('[data-training-tab]').forEach((tab) => {
        const selected = tab.dataset.trainingTab === 'refinery';
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      const content = page.querySelector('#training-tab-content');
      if (content && !content.querySelector('.cultivation-refinery')) content.innerHTML = refineryShellMarkup();
      window.dispatchEvent(new CustomEvent('xiuxian:refinery-open-request'));
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
    const wasVisible = !!page && !page.classList.contains('hidden');

    if (wasVisible && typeof window.switchToPage === 'function') {
      window.switchToPage('page-home');
    }

    nav?.remove();
    if (page?.dataset.staticLayout === '1') {
      page.classList.add('hidden');
      page.classList.remove('active-page', 'foundation-training-page');
      delete page.dataset.foundationTraining;
    } else {
      page?.remove();
    }
    document.body.classList.remove('foundation-training-only');
    document.body.classList.remove('cultivation-training-unlocked');
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
