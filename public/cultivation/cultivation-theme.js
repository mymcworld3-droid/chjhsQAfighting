// 修仙世界玩法層：不依賴卡牌／抽卡系統，將既有答題與 PvP 轉化為修仙成長體驗。
(function () {
  'use strict';

  // 前 10 題快速完成煉氣並築基；金丹後每題基礎 +2，因此後期門檻按實際答題量漸進。
  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0 },
    { name: '煉氣', sub: '一層', need: 1 },
    { name: '煉氣', sub: '二層', need: 2 },
    { name: '煉氣', sub: '三層', need: 3 },
    { name: '煉氣', sub: '四層', need: 4 },
    { name: '煉氣', sub: '五層', need: 5 },
    { name: '煉氣', sub: '六層', need: 6 },
    { name: '煉氣', sub: '七層', need: 7 },
    { name: '煉氣', sub: '八層', need: 8 },
    { name: '煉氣', sub: '九層', need: 9 },
    { name: '築基', sub: '初期', need: 10 },
    { name: '築基', sub: '中期', need: 16 },
    { name: '築基', sub: '後期', need: 22 },
    { name: '金丹', sub: '丹成一品', need: 28 },
    { name: '元嬰', sub: '元嬰出竅', need: 68 },
    { name: '化神', sub: '神念通天', need: 128 },
    { name: '煉虛', sub: '虛空悟道', need: 208 },
    { name: '合體', sub: '天地合一', need: 308 },
    { name: '大乘', sub: '大道將成', need: 448 },
    { name: '渡劫', sub: '雷劫問道', need: 628 },
    { name: '登仙', sub: '仙門在望', need: 868 },
    { name: '真仙', sub: '榜上仙位', need: 868 }
  ];

  window.XIUXIAN_REALMS = REALMS.map((realm) => ({ ...realm }));

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
    return REALMS[window.limitImmortalRank(REALMS.indexOf(current), value, REALMS)];
  }

  function nextRealm(value) {
    return REALMS[REALMS.indexOf(realmFor(value)) + 1] || null;
  }

  function pct(value) {
    const current = realmFor(value);
    const next = nextRealm(value);
    if (!next) return 100;
    if (next.name === '真仙' && next.need <= value) return 100;
    return Math.max(0, Math.min(100, ((value - current.need) / Math.max(1, next.need - current.need)) * 100));
  }

  function text(selector, value) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.textContent !== value) el.textContent = value;
      el.removeAttribute('data-i18n');
    });
  }

  function updateRankNode(rank, realm) {
    if (!rank) return;
    const label = `${realm.name} ${realm.sub}`;
    if (rank.dataset.realm === realm.name && rank.textContent === label && rank.querySelector('.realm-icon')) return;
    rank.dataset.realm = realm.name;
    rank.innerHTML = `${window.getRealmIconMarkup?.(realm.name) || ''}<span>${label}</span>`;
  }

  function openRealmAtlas() {
    document.getElementById('xiuxian-realm-atlas')?.remove();
    const current = realmFor(score());
    const grouped = REALMS.filter((realm, index) => index === 0 || realm.name !== REALMS[index - 1].name);
    const dialog = document.createElement('div');
    dialog.id = 'xiuxian-realm-atlas';
    dialog.className = 'xiuxian-realm-atlas';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '修行境界圖錄');
    dialog.innerHTML = `
      <section class="xiuxian-realm-atlas-panel">
        <header class="xiuxian-realm-atlas-head">
          <h2>修行境界圖錄</h2>
          <button type="button" class="xiuxian-realm-atlas-close" data-realm-atlas-close aria-label="關閉境界圖錄"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <p class="xiuxian-realm-atlas-intro">境界各有獨立紋章；煉氣共九層，築基分初、中、後期。真仙須登上九州五大仙榜。</p>
        <ul class="xiuxian-realm-atlas-list">
          ${grouped.map(realm => {
            const subtitle = realm.name === '煉氣' ? '一至九層' :
              realm.name === '築基' ? '初期 · 中期 · 後期' : realm.sub;
            const requirement = realm.name === '真仙' ? '868 修為＋榜上仙位' : `${realm.need} 修為起`;
            return `<li class="xiuxian-realm-atlas-item" data-current="${current.name === realm.name}">
              ${window.getRealmIconMarkup?.(realm.name) || ''}
              <span class="xiuxian-realm-atlas-name"><strong>${realm.name}</strong><small>${subtitle}</small></span>
              <span class="xiuxian-realm-atlas-need">${requirement}</span>
            </li>`;
          }).join('')}
        </ul>
      </section>`;
    const close = () => {
      document.removeEventListener('keydown', onKeyDown);
      dialog.remove();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-realm-atlas-close]')) close();
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(dialog);
    dialog.querySelector('[data-realm-atlas-close]')?.focus();
  }

  function addHomePanel() {
    const home = document.getElementById('page-home');
    if (!home) return;
    const anchor = home.querySelector('.grid.grid-cols-2');
    if (!anchor) return;

    let panel = document.getElementById('xiuxian-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'xiuxian-panel';
      panel.className = 'xiuxian-panel';
      panel.setAttribute('aria-label', '仙途修行');
      panel.innerHTML = `
        <div class="xiuxian-kicker">修行境界 ／ CULTIVATION</div>
        <p class="xiuxian-invocation">心向青雲，步履不停。</p>
        <div class="xiuxian-identity">
          <div id="xiuxian-avatar-slot"><div id="home-avatar-container"></div></div>
          <div>
            <div id="xiuxian-realm" class="xiuxian-realm">凡人</div>
            <div id="xiuxian-sub" class="xiuxian-sub">初入仙途</div>
          </div>
        </div>
        <div class="xiuxian-row"><span class="xiuxian-label">當前修為</span><span id="xiuxian-score" class="xiuxian-value" aria-live="polite" aria-atomic="true">0 修為</span></div>
        <div class="xiuxian-bar"><div id="xiuxian-progress" style="width:0%"></div></div>
        <div class="xiuxian-row"><span id="xiuxian-progress-label" class="xiuxian-label">距離下一境界</span><span id="xiuxian-next" class="xiuxian-value">5 修為</span></div>
        <div class="xiuxian-row"><span class="xiuxian-label" id="xiuxian-meditation-streak">連續閉關 0 日 · 累計 0 日</span></div>
        <div class="xiuxian-actions"><button id="xiuxian-meditate" class="xiuxian-btn" type="button">今日閉關</button><button id="xiuxian-path" class="xiuxian-btn" type="button">境界圖錄</button></div>
      `;
      anchor.parentNode.insertBefore(panel, anchor);
    }

    if (panel.dataset.xiuxianBound !== '1') {
      panel.dataset.xiuxianBound = '1';
      panel.querySelector('#xiuxian-meditate')?.addEventListener('click', () => window.openDailyMeditation?.());
      panel.querySelector('#xiuxian-path')?.addEventListener('click', openRealmAtlas);
    }
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
      if (el.innerText === 'STREAK' || el.innerText === '當前道心') el.innerText = '當前連勝';
      if (el.innerText === 'BEST RECORD' || el.innerText === '最高道心') el.innerText = '最高連勝';
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
    updateRankNode(rank, realm);

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
    if (nextEl) nextEl.textContent = next?.name === '真仙' && value >= next.need ? '需登上九州五大仙榜' : next ? `${Math.max(0, next.need - value).toLocaleString()} 修為` : '已成真仙';

    const label = document.getElementById('xiuxian-progress-label');
    if (label) label.textContent = next?.name === '真仙' && value >= next.need ? '登仙已成 · 爭奪真仙席位' : next ? `下一境界：${next.name} ${next.sub}` : '榜上有名，位列真仙';

    window.refreshDailyMeditationPanel?.();
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
        updateRankNode(rankEl, realm);
      }).observe(rankEl, { childList: true, characterData: true, subtree: true });
    }

    const scoreEl = document.getElementById('display-score');
    if (scoreEl) {
      new MutationObserver(render).observe(scoreEl, { childList: true, characterData: true, subtree: true });
    }

    window.addEventListener('xiuxian:stats-updated', render);
    window.addEventListener('xiuxian:immortals-updated', render);

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
