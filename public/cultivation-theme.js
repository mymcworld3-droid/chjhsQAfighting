// 修仙世界玩法層：不依賴卡牌／抽卡系統，將既有答題與 PvP 轉化為修仙成長體驗。
(function () {
  'use strict';

  // 築基以前維持原進度；金丹以上因金丹特性會加速修煉，因此拉長後期曲線。
  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0, emoji: '🌱' },
    { name: '煉氣', sub: '一層', need: 5, emoji: '🌬️' },
    { name: '煉氣', sub: '二層', need: 10, emoji: '🌬️' },
    { name: '煉氣', sub: '三層', need: 15, emoji: '🌬️' },
    { name: '煉氣', sub: '四層', need: 20, emoji: '🌬️' },
    { name: '煉氣', sub: '五層', need: 25, emoji: '🌬️' },
    { name: '煉氣', sub: '六層', need: 30, emoji: '🌬️' },
    { name: '煉氣', sub: '七層', need: 35, emoji: '🌬️' },
    { name: '煉氣', sub: '八層', need: 40, emoji: '🌬️' },
    { name: '煉氣', sub: '九層', need: 45, emoji: '🌬️' },
    { name: '築基', sub: '初期', need: 60, emoji: '🪨' },
    { name: '築基', sub: '中期', need: 80, emoji: '🪨' },
    { name: '築基', sub: '後期', need: 100, emoji: '🪨' },
    { name: '金丹', sub: '丹成一品', need: 300, emoji: '☀️' },
    { name: '元嬰', sub: '元嬰出竅', need: 500, emoji: '✨' },
    { name: '化神', sub: '神念通天', need: 800, emoji: '🔮' },
    { name: '煉虛', sub: '虛空悟道', need: 1200, emoji: '🌌' },
    { name: '合體', sub: '天地合一', need: 1800, emoji: '☯️' },
    { name: '大乘', sub: '大道將成', need: 2600, emoji: '⚡' },
    { name: '渡劫', sub: '雷劫問道', need: 3600, emoji: '⛈️' },
    { name: '真仙', sub: '踏入仙門', need: 5000, emoji: '🪽' }
  ];

  window.XIUXIAN_REALMS = REALMS.map((realm) => ({ ...realm }));

  const KEY = 'xiuxian_world_state_v2';
  let state = loadState();

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { meditation: 0, lastMeditation: '' };
    } catch (_) {
      return { meditation: 0, lastMeditation: '' };
    }
  }

  function saveState() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function score() {
    if (typeof window.getCurrentUserData === 'function') {
      const user = window.getCurrentUserData();
      if (user && user.stats) return Math.max(0, Number(user.stats.totalScore) || 0);
    }
    return 0;
  }

  function realmFor(value) {
    let current = REALMS[0];
    REALMS.forEach((realm) => {
      if (value >= realm.need) current = realm;
    });
    return current;
  }

  function nextRealm(value) {
    return REALMS.find((realm) => realm.need > value) || null;
  }

  function pct(value) {
    const current = realmFor(value);
    const next = nextRealm(value);
    if (!next) return 100;
    return Math.max(0, Math.min(100, ((value - current.need) / (next.need - current.need)) * 100));
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'xiuxian-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 20);
    setTimeout(() => el.remove(), 2800);
  }

  function meditate() {
    const today = todayKey();
    if (state.lastMeditation === today) {
      toast('今日已閉關，明日再來吸納靈氣。');
      return;
    }
    state.lastMeditation = today;
    state.meditation = (state.meditation || 0) + 1;
    saveState();
    toast(`閉關完成！道心穩固（累計 ${state.meditation} 日）`);
    render();
  }

  function text(selector, value) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.textContent !== value) el.textContent = value;
      el.removeAttribute('data-i18n');
    });
  }

  function addHomePanel() {
    if (document.getElementById('xiuxian-panel')) return;
    const home = document.getElementById('page-home');
    if (!home) return;
    const anchor = home.querySelector('.grid.grid-cols-2');
    if (!anchor) return;

    const panel = document.createElement('section');
    panel.id = 'xiuxian-panel';
    panel.className = 'xiuxian-panel';
    panel.setAttribute('aria-label', '仙途修行');
    panel.innerHTML = `
      <div class="xiuxian-kicker">修行境界 ／ CULTIVATION</div>
      <p class="xiuxian-invocation">心向青雲，步履不停。</p>
      <div class="xiuxian-identity">
        <div id="xiuxian-avatar-slot"></div>
        <div>
          <div id="xiuxian-realm" class="xiuxian-realm">凡人</div>
          <div id="xiuxian-sub" class="xiuxian-sub">初入仙途</div>
        </div>
      </div>
      <div class="xiuxian-row">
        <span class="xiuxian-label">當前修為</span>
        <span id="xiuxian-score" class="xiuxian-value" aria-live="polite" aria-atomic="true">0 修為</span>
      </div>
      <div class="xiuxian-bar"><div id="xiuxian-progress" style="width:0%"></div></div>
      <div class="xiuxian-row">
        <span id="xiuxian-progress-label" class="xiuxian-label">距離下一境界</span>
        <span id="xiuxian-next" class="xiuxian-value">5 修為</span>
      </div>
      <div class="xiuxian-actions">
        <button id="xiuxian-meditate" class="xiuxian-btn">今日閉關</button>
        <button id="xiuxian-path" class="xiuxian-btn">境界圖錄</button>
      </div>
    `;

    anchor.parentNode.insertBefore(panel, anchor);
    document.getElementById('xiuxian-meditate').addEventListener('click', meditate);
    document.getElementById('xiuxian-path').addEventListener('click', () => {
      alert(REALMS.map((realm) => `${realm.emoji} ${realm.name} ${realm.sub}：${realm.need} 修為起`).join('\n'));
    });
  }

  function rewriteLabels() {
    text('[data-i18n="btn_solo"]', '問道試煉');
    text('[data-i18n="btn_pvp"]', '鬥法論道');
    text('[data-i18n="nav_home"]', '仙府');
    text('[data-i18n="nav_store"]', '坊市');
    text('[data-i18n="store_title"]', '雲間坊市');
    text('[data-i18n="nav_quiz"]', '問道');
    text('[data-i18n="nav_rank"]', '仙榜');
    text('[data-i18n="nav_settings"]', '洞府');
    text('[data-i18n="nav_social"]', '仙盟');
    text('[data-i18n="inventory_title"]', '法寶庫');
    text('[data-i18n="rank_title"]', '九州仙榜');
    text('[data-i18n="th_rank"]', '境界');
    text('[data-i18n="btn_next_q"]', '繼續悟道');
    text('[data-i18n="btn_back_home"]', '返回仙府');

    document.querySelectorAll('.stat-label').forEach((el) => {
      if (el.innerText === 'ACCURACY') el.innerText = '悟性 (正確率)';
      if (el.innerText === 'STREAK') el.innerText = '當前道心';
      if (el.innerText === 'BEST RECORD') el.innerText = '最高道心';
    });
  }

  function render() {
    addHomePanel();
    rewriteLabels();

    const value = score();
    const realm = realmFor(value);
    const next = nextRealm(value);

    const avatarContainer = document.getElementById('home-avatar-container');
    const avatarSlot = document.getElementById('xiuxian-avatar-slot');
    if (avatarContainer && avatarSlot && avatarContainer.parentNode !== avatarSlot) {
      avatarContainer.className = '';
      avatarSlot.appendChild(avatarContainer);
    }

    const rank = document.getElementById('display-rank');
    const targetRank = `${realm.emoji} ${realm.name} ${realm.sub}`;
    if (rank && rank.textContent !== targetRank) rank.textContent = targetRank;

    const realmEl = document.getElementById('xiuxian-realm');
    if (realmEl) realmEl.textContent = realm.name;

    const scoreEl = document.getElementById('xiuxian-score');
    if (scoreEl && scoreEl.textContent !== `${value.toLocaleString()} 修為`) {
      scoreEl.textContent = `${value.toLocaleString()} 修為`;
    }

    const sub = document.getElementById('xiuxian-sub');
    if (sub) sub.textContent = realm.sub;

    const bar = document.getElementById('xiuxian-progress');
    if (bar) bar.style.width = `${pct(value)}%`;

    const nextEl = document.getElementById('xiuxian-next');
    if (nextEl) nextEl.textContent = next ? `${Math.max(0, next.need - value).toLocaleString()} 修為` : '已登仙';

    const label = document.getElementById('xiuxian-progress-label');
    if (label) label.textContent = next ? `下一境界：${next.name} ${next.sub}` : '已登仙，繼續悟道';

    const med = document.getElementById('xiuxian-meditate');
    if (med) {
      const done = state.lastMeditation === todayKey();
      med.textContent = done ? '今日已閉關' : '今日閉關';
      med.disabled = done;
      med.style.opacity = done ? '.55' : '1';
    }
  }

  window.refreshCultivationRealmUI = render;

  function boot() {
    render();
    setInterval(render, 1200);

    const rankEl = document.getElementById('display-rank');
    if (rankEl) {
      new MutationObserver(() => {
        const value = score();
        const realm = realmFor(value);
        const targetRank = `${realm.emoji} ${realm.name} ${realm.sub}`;
        if (rankEl.textContent !== targetRank) rankEl.textContent = targetRank;
      }).observe(rankEl, { childList: true, characterData: true, subtree: true });
    }

    const scoreEl = document.getElementById('display-score');
    if (scoreEl) {
      new MutationObserver(render).observe(scoreEl, { childList: true, characterData: true, subtree: true });
    }

    window.addEventListener('xiuxian:stats-updated', render);

    if (typeof window.updateTexts === 'function') {
      const originalUpdateTexts = window.updateTexts;
      window.updateTexts = function () {
        originalUpdateTexts.apply(this, arguments);
        setTimeout(render, 0);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
