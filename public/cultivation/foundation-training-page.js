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
    return `
      <section class="training-v3-empty foundation-training-bag">
        <i class="fa-solid fa-box-open"></i>
        <h3>修煉背包</h3>
        <p>修煉途中取得的特殊物品會收納於此。</p>
      </section>
    `;
  }

  function refineryShellMarkup() {
    const materialCells = Array.from({ length: 8 }, (_, index) =>
      `<div class="refinery-shell-material" aria-hidden="true"><span class="refinery-shell-icon"></span><span class="refinery-shell-line"></span><small>材料 ${index + 1}</small></div>`
    );
    const materials = materialCells.slice(0, 4).join('');
    const artifacts = materialCells.slice(4).join('');
    const directions = ['乾','坎','艮','震','巽','離','坤','兌'];
    const slots = directions.map((direction, index) =>
      `<button type="button" class="refinery-slot" data-refinery-slot="${index}" disabled aria-label="空陣位 ${direction}"><span class="idx">${index + 1}</span><span class="remove">×</span><span class="direction">${direction}</span><span><span class="icon">＋</span><span class="name"></span></span></button>`
    ).join('');
    return `
      <section class="cultivation-refinery refinery-shell" aria-busy="true">
        <article class="refinery-panel refinery-material-panel">
          <div class="refinery-material-list">
            <section class="refinery-material-roll">
              <div class="refinery-group-title"><span><i class="fa-solid fa-gem"></i> 持有煉器素材 · 一般素材</span><span>載入中</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${materials}</div>
            </section>
            <section class="refinery-material-roll">
              <div class="refinery-group-title"><span><i class="fa-solid fa-recycle"></i> 二次煉製</span><span>載入中</span></div>
              <div class="refinery-shell-material-grid refinery-material-roll-body">${artifacts}</div>
            </section>
          </div>
        </article>
        <article class="refinery-panel refinery-forge-panel">
          <div class="refinery-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>八方歸位，陣心煉器；法陣已預先建立。</p></div><span class="refinery-badge">0/8</span></div>
          <div class="refinery-array-wrap">
            <div class="refinery-slots refinery-shell-array" aria-label="八方煉器陣">
              <span class="refinery-array-lines"></span>
              <span class="refinery-array-ring"></span>
              ${slots}
              <div class="refinery-array-center">
                <button type="button" class="refinery-craft" disabled>
                  <i class="fa-solid fa-fire-flame-curved"></i>
                  <span class="craft-main">煉製</span>
                  <span class="craft-sub">REFINE</span>
                </button>
              </div>
              <span class="refinery-array-caption">八方聚靈 · 一器成形</span>
            </div>
          </div>
          <div class="refinery-shell-summary">投入：尚未投入材料</div>
          <div class="refinery-shell-match">放入材料後，依材料數量自動辨識法寶配方。</div>
          <div class="refinery-shell-actions"><button type="button" disabled><i class="fa-solid fa-rotate-left"></i> 清空陣位</button></div>
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
      // 舊背包純文字不再顯示；統一裝備模組於下一個畫面幀繪製四格。
      const content = page.querySelector('#training-tab-content');
      if (content) content.innerHTML = '';
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
