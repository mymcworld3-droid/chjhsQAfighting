// 修煉頁「狀態」分頁：顯示目前金丹與玩家基本數值。
(function () {
  'use strict';

  const CSS_HREF = 'cultivation-status-panel.css';
  let statusActive = false;
  let rendering = false;

  const CORE_META = {
    ocean: { icon: '≈', tone: 'ocean' },
    taichu: { icon: '☀', tone: 'gold' },
    ningxin: { icon: '◈', tone: 'ivory' },
    pojing: { icon: '✦', tone: 'amber' },
    xingchen: { icon: '✧', tone: 'pale' },
    wugou: { icon: '◇', tone: 'silver' },
    thunder: { icon: 'ϟ', tone: 'thunder' },
    reverse: { icon: '↺', tone: 'violet' }
  };

  function loadStyle() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readText(id, fallback = '0') {
    const value = document.getElementById(id)?.textContent?.trim();
    return value || fallback;
  }

  function getPlayerSnapshot() {
    const data = window.getCurrentUserData?.() || {};
    const stats = data.stats || {};
    return {
      realm: readText('display-rank', '金丹'),
      score: Number(stats.totalScore ?? readText('display-score', '0')) || 0,
      gold: Number(stats.gold) || 0,
      accuracy: readText('display-accuracy', '0%'),
      streak: Number(stats.currentStreak ?? readText('display-streak', '0')) || 0,
      bestStreak: Number(stats.bestStreak ?? stats.maxStreak ?? readText('display-best-streak', '0')) || 0
    };
  }

  function currentCoreMarkup() {
    const core = window.getGoldenCoreState?.();
    if (!core) {
      return `
        <div class="status-core-empty">
          <i class="fa-solid fa-circle-notch"></i>
          <span>尚未形成金丹</span>
        </div>
      `;
    }

    const meta = CORE_META[core.type] || CORE_META.taichu;
    const equipped = !!core.equipped;
    return `
      <div class="status-core-row">
        <div class="status-core-orb core-tone-${meta.tone}" aria-hidden="true">
          <span>${meta.icon}</span>
          <i></i>
        </div>
        <div class="status-core-copy">
          <div class="status-core-topline">
            <span class="status-core-grade">${escapeHtml(core.grade)} 品</span>
            <span class="status-core-equipped ${equipped ? 'on' : 'off'}">${equipped ? '已裝配' : '未裝配'}</span>
          </div>
          <h3>${escapeHtml(core.name || '金丹')}</h3>
          <p>${escapeHtml(core.effect || '尚無特性資料')}</p>
        </div>
      </div>
    `;
  }

  function statCard(icon, label, value, note = '') {
    return `
      <div class="status-stat-card">
        <div class="status-stat-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="status-stat-copy">
          <span>${label}</span>
          <strong>${escapeHtml(value)}</strong>
          ${note ? `<small>${escapeHtml(note)}</small>` : ''}
        </div>
      </div>
    `;
  }

  function statusMarkup() {
    const player = getPlayerSnapshot();
    return `
      <section class="training-status-panel">
        <div class="status-section status-core-section">
          <div class="status-section-title"><span>目前金丹</span><small>CURRENT CORE</small></div>
          ${currentCoreMarkup()}
        </div>

        <div class="status-section status-player-section">
          <div class="status-section-title"><span>玩家數值</span><small>STATUS</small></div>
          <div class="status-stat-grid">
            ${statCard('fa-mountain-sun', '境界', player.realm)}
            ${statCard('fa-fire-flame-curved', '修為', player.score.toLocaleString())}
            ${statCard('fa-coins', '靈石', player.gold.toLocaleString())}
            ${statCard('fa-bullseye', '悟性', player.accuracy)}
            ${statCard('fa-fire', '當前道心', player.streak.toLocaleString())}
            ${statCard('fa-crown', '最高道心', player.bestStreak.toLocaleString())}
          </div>
        </div>
      </section>
    `;
  }

  function renderStatus() {
    if (!statusActive || rendering) return;
    const content = document.getElementById('training-tab-content');
    if (!content) return;
    rendering = true;
    content.innerHTML = statusMarkup();
    rendering = false;
  }

  function setNativeTabsInactive(page) {
    page.querySelectorAll('.training-subtab-v3').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-selected', 'false');
    });
  }

  function activateStatus() {
    const page = document.getElementById('page-training');
    const button = document.getElementById('training-status-tab');
    if (!page || !button) return;
    statusActive = true;
    setNativeTabsInactive(page);
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    renderStatus();
  }

  function deactivateStatus() {
    statusActive = false;
    const button = document.getElementById('training-status-tab');
    button?.classList.remove('active');
    button?.setAttribute('aria-selected', 'false');
  }

  function ensureStatusTab() {
    const tabs = document.querySelector('#page-training .training-subtabs-v3');
    if (!tabs || document.getElementById('training-status-tab')) return;

    const button = document.createElement('button');
    button.id = 'training-status-tab';
    button.type = 'button';
    button.className = 'training-subtab-v3 training-status-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = '<i class="fa-solid fa-user-astronaut"></i><span>狀態</span>';
    button.addEventListener('click', activateStatus);
    tabs.appendChild(button);
  }

  function bindNativeTabExit() {
    const page = document.getElementById('page-training');
    if (!page || page.dataset.statusExitBound === '1') return;
    page.dataset.statusExitBound = '1';
    page.addEventListener('click', (event) => {
      const nativeTab = event.target.closest?.('[data-training-tab]');
      if (nativeTab) deactivateStatus();
    }, true);
  }

  function sync() {
    ensureStatusTab();
    bindNativeTabExit();
    if (statusActive) renderStatus();
  }

  function boot() {
    loadStyle();
    sync();

    new MutationObserver(() => {
      sync();
    }).observe(document.body, { childList: true, subtree: true });

    // 玩家數值與金丹狀態可能在答題、洗髓、裝配後更新；狀態頁開啟時同步刷新。
    setInterval(() => {
      if (statusActive) renderStatus();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
