// 金丹期解鎖的「修煉」系統：主分頁 + 金丹 / 背包子分頁。
(function () {
  'use strict';

  const GOLDEN_CORE_SCORE = 150;
  const STATE_KEY = 'xiuxian_training_state_v1';
  const CSS_HREF = 'cultivation-training.css';

  // 一品最好、九品最低。每種金丹都保留獨立被動效果，方便日後由煉丹、掉落或坊市取得。
  const PILL_TYPES = [
    {
      id: 'taichu',
      name: '太初金丹',
      short: '太初',
      icon: '☀',
      tone: 'gold',
      effect(grade) {
        return `每累積 ${grade + 1} 次悟道成功，額外獲得 1 修為`;
      }
    },
    {
      id: 'ningxin',
      name: '凝心金丹',
      short: '凝心',
      icon: '◈',
      tone: 'ivory',
      effect(grade) {
        const threshold = Math.max(1, Math.ceil(grade / 3));
        return `道心護體所需連續悟道降低至 ${threshold + 1} 次`;
      }
    },
    {
      id: 'pojing',
      name: '破境金丹',
      short: '破境',
      icon: '✦',
      tone: 'amber',
      effect(grade) {
        return `距下一境界 ${Math.max(2, (10 - grade) * 2)} 修為內，悟道成功額外 +1 修為`;
      }
    },
    {
      id: 'xingchen',
      name: '星辰金丹',
      short: '星辰',
      icon: '✧',
      tone: 'pale',
      effect(grade) {
        return `連續悟道達 ${Math.max(1, grade)} 層後，每次成功額外 +1 修為`;
      }
    },
    {
      id: 'wugou',
      name: '無垢金丹',
      short: '無垢',
      icon: '◇',
      tone: 'silver',
      effect(grade) {
        return `每累積 ${grade + 1} 次失誤，可保留 1 次既有道心護體`;
      }
    }
  ];

  const REALM_THRESHOLDS = [200, 300, 450, 650, 900, 1200, 1600];
  let activeTab = 'core';
  let lastUnlocked = false;

  function defaultState() {
    return {
      announced: false,
      core: {
        type: 'taichu',
        grade: 9,
        formedAt: Date.now()
      },
      counters: {
        correct: 0,
        mistakes: 0
      },
      inventory: []
    };
  }

  function loadState() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (_) {}
    const base = defaultState();
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      ...base,
      ...parsed,
      core: { ...base.core, ...(parsed.core || {}) },
      counters: { ...base.counters, ...(parsed.counters || {}) },
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : []
    };
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function currentScore() {
    const raw = window.getCurrentUserData?.()?.stats?.totalScore;
    return Math.max(0, Number(raw) || 0);
  }

  function isUnlocked() {
    return currentScore() >= GOLDEN_CORE_SCORE;
  }

  function currentType() {
    return PILL_TYPES.find((pill) => pill.id === state.core.type) || PILL_TYPES[0];
  }

  function clampGrade(value) {
    return Math.min(9, Math.max(1, Number(value) || 9));
  }

  function gradeLabel(grade) {
    return `${clampGrade(grade)}品`;
  }

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function toast(message) {
    const old = document.getElementById('training-unlock-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'training-unlock-toast';
    el.className = 'training-toast';
    el.innerHTML = `<span class="training-toast-mark">✦</span><span>${message}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 3600);
  }

  function createNavButton() {
    if (document.getElementById('nav-training')) return;
    const nav = document.getElementById('nav-grid');
    if (!nav) return;
    const homeButton = nav.querySelector('[data-target="page-home"]');
    if (!homeButton) return;

    const button = document.createElement('button');
    button.id = 'nav-training';
    button.type = 'button';
    button.className = 'nav-btn training-nav-btn group flex-1 flex flex-col items-center justify-center h-full transition-all';
    button.dataset.target = 'page-training';
    button.setAttribute('aria-label', '修煉');
    button.innerHTML = `
      <div class="relative p-1 training-nav-orb">
        <i class="fa-solid fa-fire-flame-curved text-lg"></i>
      </div>
      <span class="text-[10px] mt-1">修煉</span>
    `;
    button.addEventListener('click', () => {
      if (typeof window.switchToPage === 'function') window.switchToPage('page-training');
      renderTrainingPage();
    });

    homeButton.insertAdjacentElement('afterend', button);
  }

  function coreVisualMarkup(type, grade) {
    return `
      <div class="golden-core-stage" aria-label="${gradeLabel(grade)} ${type.name}">
        <div class="golden-core-halo halo-one"></div>
        <div class="golden-core-halo halo-two"></div>
        <div class="golden-core-orbit orbit-one"></div>
        <div class="golden-core-orbit orbit-two"></div>
        <div class="golden-core-sphere core-tone-${type.tone}">
          <span class="golden-core-glyph">${type.icon}</span>
        </div>
        <div class="golden-core-shadow"></div>
      </div>
    `;
  }

  function gradeScaleMarkup(currentGrade) {
    return `
      <div class="core-grade-scale" aria-label="金丹品階，一品最佳，九品最低">
        ${Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => `
          <div class="core-grade-node ${grade === currentGrade ? 'current' : ''} ${grade < currentGrade ? 'higher' : 'lower'}">
            <span>${grade}</span>
            <small>品</small>
          </div>
        `).join('')}
      </div>
      <div class="core-grade-hint"><span>一品 · 極品</span><span>九品 · 初成</span></div>
    `;
  }

  function pillCatalogueMarkup() {
    const core = currentType();
    return PILL_TYPES.map((pill) => {
      const owned = pill.id === core.id;
      return `
        <article class="pill-type-card ${owned ? 'owned' : 'unowned'}">
          <div class="pill-type-icon core-tone-${pill.tone}">${pill.icon}</div>
          <div class="pill-type-copy">
            <div class="pill-type-title-row">
              <h4>${pill.name}</h4>
              <span class="pill-status">${owned ? '丹田蘊養' : '尚未取得'}</span>
            </div>
            <p>${pill.effect(clampGrade(state.core.grade))}</p>
          </div>
        </article>
      `;
    }).join('');
  }

  function coreTabMarkup() {
    const type = currentType();
    const grade = clampGrade(state.core.grade);
    return `
      <div class="training-core-layout">
        <section class="core-showcase training-card">
          <div class="training-section-kicker">GOLDEN CORE</div>
          ${coreVisualMarkup(type, grade)}
          <div class="core-name-block">
            <span class="core-grade-badge">${gradeLabel(grade)}</span>
            <h3>${type.name}</h3>
            <p>${type.effect(grade)}</p>
          </div>
        </section>

        <section class="core-details training-card">
          <div class="training-section-heading">
            <div>
              <div class="training-section-kicker">QUALITY</div>
              <h3>金丹品階</h3>
            </div>
            <span class="quality-note">一品最好</span>
          </div>
          ${gradeScaleMarkup(grade)}
          <div class="core-rule-note">
            <i class="fa-solid fa-circle-info"></i>
            <span>同一丹種會依品階改變被動效果強度；一品最強，九品為初成。</span>
          </div>
        </section>
      </div>

      <section class="training-card pill-catalogue">
        <div class="training-section-heading">
          <div>
            <div class="training-section-kicker">CORE PATHS</div>
            <h3>金丹丹種</h3>
          </div>
          <span class="quality-note">各有不同效果</span>
        </div>
        <div class="pill-type-grid">${pillCatalogueMarkup()}</div>
      </section>
    `;
  }

  function inventoryMarkup() {
    const items = state.inventory;
    if (!items.length) {
      return `
        <section class="training-card backpack-panel">
          <div class="backpack-empty-icon"><i class="fa-solid fa-box-open"></i></div>
          <h3>背包尚空</h3>
          <p>之後取得的丹藥、煉丹素材與修煉物品會收納在此。</p>
          <div class="backpack-tip"><i class="fa-solid fa-circle-info"></i> 丹田中的本命金丹不占背包格。</div>
        </section>
      `;
    }

    return `
      <section class="training-card backpack-panel has-items">
        <div class="inventory-grid">
          ${items.map((item) => `
            <div class="inventory-slot">
              <div class="inventory-icon">${item.icon || '◆'}</div>
              <div><strong>${item.name || '修煉物品'}</strong><small>× ${Math.max(1, Number(item.qty) || 1)}</small></div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function createTrainingPage() {
    if (document.getElementById('page-training')) return;
    const main = document.querySelector('main');
    const home = document.getElementById('page-home');
    if (!main || !home) return;

    const page = document.createElement('div');
    page.id = 'page-training';
    page.className = 'page-section hidden px-4 training-page';
    page.innerHTML = `
      <div class="training-page-heading">
        <div>
          <div class="training-eyebrow">INNER ALCHEMY ／ 內丹修行</div>
          <h2>修煉</h2>
          <p>金丹既成，自此內觀丹田，溫養大道。</p>
        </div>
        <div class="training-realm-seal">金丹</div>
      </div>

      <div class="training-subtabs" role="tablist" aria-label="修煉分頁">
        <button type="button" class="training-subtab active" data-training-tab="core" role="tab" aria-selected="true">
          <i class="fa-solid fa-circle-dot"></i><span>金丹</span>
        </button>
        <button type="button" class="training-subtab" data-training-tab="bag" role="tab" aria-selected="false">
          <i class="fa-solid fa-box-open"></i><span>背包</span>
        </button>
      </div>

      <div id="training-tab-content" class="training-tab-content"></div>
    `;

    home.insertAdjacentElement('afterend', page);
    page.querySelectorAll('[data-training-tab]').forEach((button) => {
      button.addEventListener('click', () => switchTrainingTab(button.dataset.trainingTab));
    });
    renderTrainingPage();
  }

  function switchTrainingTab(tab) {
    activeTab = tab === 'bag' ? 'bag' : 'core';
    document.querySelectorAll('#page-training [data-training-tab]').forEach((button) => {
      const active = button.dataset.trainingTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderTrainingPage();
  }

  function renderTrainingPage() {
    const content = document.getElementById('training-tab-content');
    if (!content) return;
    content.innerHTML = activeTab === 'bag' ? inventoryMarkup() : coreTabMarkup();
  }

  function ensureUnlockedUI() {
    loadStyle();
    createNavButton();
    createTrainingPage();
    document.body.classList.add('cultivation-training-unlocked');

    if (!state.announced) {
      state.announced = true;
      saveState();
      toast('金丹已成！「修煉」分頁已開啟。');
    }
  }

  function removeLockedUI() {
    document.getElementById('nav-training')?.remove();
    document.getElementById('page-training')?.remove();
    document.body.classList.remove('cultivation-training-unlocked');
  }

  // 提供給 cultivation-rules.js 的金丹被動結算。
  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {
    if (!isUnlocked()) return { bonusGain: 0, message: '' };

    const type = currentType();
    const grade = clampGrade(state.core.grade);
    const previousStreak = Math.max(0, Number(stats?.currentStreak) || 0);
    const score = Math.max(0, Number(stats?.totalScore) || 0);
    let bonusGain = 0;
    let forceShield = false;
    let preserveShield = false;
    let message = '';

    if (isCorrect) {
      state.counters.correct = Math.max(0, Number(state.counters.correct) || 0) + 1;
    } else {
      state.counters.mistakes = Math.max(0, Number(state.counters.mistakes) || 0) + 1;
    }

    if (type.id === 'taichu' && isCorrect) {
      const interval = grade + 1;
      if (state.counters.correct % interval === 0) {
        bonusGain = 1;
        message = `${type.name}共鳴，額外 +1 修為`;
      }
    }

    if (type.id === 'ningxin' && isCorrect) {
      const threshold = Math.max(1, Math.ceil(grade / 3));
      if (previousStreak >= threshold) {
        forceShield = true;
        message = `${type.name}凝神，道心護體成形`;
      }
    }

    if (type.id === 'pojing' && isCorrect) {
      const next = REALM_THRESHOLDS.find((need) => need > score);
      const range = Math.max(2, (10 - grade) * 2);
      if (next && next - score <= range) {
        bonusGain = 1;
        message = `${type.name}助你破境，額外 +1 修為`;
      }
    }

    if (type.id === 'xingchen' && isCorrect && previousStreak >= Math.max(1, grade)) {
      bonusGain = 1;
      message = `${type.name}引星入體，額外 +1 修為`;
    }

    if (type.id === 'wugou' && !isCorrect) {
      const interval = grade + 1;
      if (state.counters.mistakes % interval === 0 && stats?.cultivationShield) {
        preserveShield = true;
        message = `${type.name}護住道心，本次護體未散`;
      }
    }

    saveState();
    return { bonusGain, forceShield, preserveShield, message };
  };

  window.getGoldenCoreState = function () {
    if (!isUnlocked()) return null;
    const type = currentType();
    const grade = clampGrade(state.core.grade);
    return {
      type: type.id,
      name: type.name,
      grade,
      effect: type.effect(grade),
      inventory: [...state.inventory]
    };
  };

  function syncUnlock() {
    const unlocked = isUnlocked();
    if (unlocked) {
      ensureUnlockedUI();
      if (!lastUnlocked) renderTrainingPage();
    } else if (lastUnlocked) {
      removeLockedUI();
    }
    lastUnlocked = unlocked;
  }

  function boot() {
    loadStyle();
    syncUnlock();
    setInterval(syncUnlock, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
