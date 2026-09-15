// 修煉頁「狀態」分頁：顯示目前金丹與玩家戰鬥數值。
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

  const FALLBACK_COMBAT = {
    attack: 200,
    hp: 1000,
    maxHp: 1000,
    defense: 100,
    speed: 100,
    critRate: 5,
    critDamage: 150
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

  function getCombatSnapshot() {
    const live = window.getCombatStats?.();
    if (live) return live;

    const stats = window.getCurrentUserData?.()?.stats || {};
    const maxHp = Number.isFinite(Number(stats.maxHp)) ? Number(stats.maxHp) : FALLBACK_COMBAT.maxHp;
    return {
      attack: Number.isFinite(Number(stats.attack)) ? Number(stats.attack) : FALLBACK_COMBAT.attack,
      hp: Number.isFinite(Number(stats.hp)) ? Number(stats.hp) : maxHp,
      maxHp,
      defense: Number.isFinite(Number(stats.defense)) ? Number(stats.defense) : FALLBACK_COMBAT.defense,
      speed: Number.isFinite(Number(stats.speed)) ? Number(stats.speed) : FALLBACK_COMBAT.speed,
      critRate: Number.isFinite(Number(stats.critRate)) ? Number(stats.critRate) : FALLBACK_COMBAT.critRate,
      critDamage: Number.isFinite(Number(stats.critDamage)) ? Number(stats.critDamage) : FALLBACK_COMBAT.critDamage
    };
  }

  function currentCoreSnapshot() {
    const core = window.getGoldenCoreState?.();
    if (!core) return null;
    return {
      type: core.type || 'taichu',
      name: core.name || '金丹',
      grade: Number(core.grade) || 9,
      effect: core.effect || '尚無特性資料',
      equipped: !!core.equipped
    };
  }

  function currentCoreMarkup(core) {
    if (!core) {
      return `
        <div class="status-core-empty">
          <i class="fa-solid fa-circle-notch"></i>
          <span>尚未形成金丹</span>
        </div>
      `;
    }

    const meta = CORE_META[core.type] || CORE_META.taichu;
    return `
      <div class="status-core-row">
        <div class="status-core-orb core-tone-${meta.tone}" aria-hidden="true">
          <span>${meta.icon}</span>
          <i></i>
        </div>
        <div class="status-core-copy">
          <div class="status-core-topline">
            <span class="status-core-grade">${escapeHtml(core.grade)} 品</span>
            <span class="status-core-equipped ${core.equipped ? 'on' : 'off'}">${core.equipped ? '已裝配' : '未裝配'}</span>
          </div>
          <h3>${escapeHtml(core.name)}</h3>
          <p>${escapeHtml(core.effect)}</p>
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

  function statusSnapshot() {
    return {
      player: getCombatSnapshot(),
      core: currentCoreSnapshot()
    };
  }

  function statusMarkup(snapshot) {
    const player = snapshot.player;
    return `
      <section class="training-status-panel">
        <div class="status-section status-core-section">
          <div class="status-section-title"><span>目前金丹</span><small>CURRENT CORE</small></div>
          ${currentCoreMarkup(snapshot.core)}
        </div>

        <div class="status-section status-player-section">
          <div class="status-section-title"><span>戰鬥數值</span><small>COMBAT STATUS</small></div>
          <div class="status-stat-grid">
            ${statCard('fa-khanda', '攻擊力', Math.round(player.attack).toLocaleString(), '基礎 200')}
            ${statCard('fa-heart', '生命值', `${Math.round(player.hp).toLocaleString()} / ${Math.round(player.maxHp).toLocaleString()}`, '基礎 1000')}
            ${statCard('fa-shield-halved', '防禦力', Math.round(player.defense).toLocaleString(), '基礎 100')}
            ${statCard('fa-wind', '速度', Math.round(player.speed).toLocaleString(), '基礎 100')}
            ${statCard('fa-crosshairs', '暴擊率', `${player.critRate}%`, '基礎 5%')}
            ${statCard('fa-burst', '暴擊傷害', `${player.critDamage}%`, '基礎 150%')}
          </div>
        </div>
      </section>
    `;
  }

  function renderStatus() {
    if (!statusActive || rendering) return;
    const content = document.getElementById('training-tab-content');
    if (!content) return;

    const snapshot = statusSnapshot();
    const key = JSON.stringify(snapshot);
    const alreadyShowing = !!content.querySelector(':scope > .training-status-panel');
    if (alreadyShowing && content.dataset.statusSnapshot === key) return;

    rendering = true;
    content.innerHTML = statusMarkup(snapshot);
    content.dataset.statusSnapshot = key;
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
    window.ensureCombatStats?.();
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
    button.innerHTML = '<i class="fa-solid fa-chart-simple"></i><span>狀態</span>';
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
    window.addEventListener('combat-stats-ready', renderStatus);

    new MutationObserver(() => {
      sync();
    }).observe(document.body, { childList: true, subtree: true });

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
