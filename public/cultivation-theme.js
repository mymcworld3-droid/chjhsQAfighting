// 修仙世界玩法層：不依賴卡牌／抽卡系統，將既有答題與 PvP 轉化為修仙成長體驗。
(function () {
  'use strict';

  // 修為只增不減：煉氣九層，每層 5 修為；築基三期，每期 20 修為。
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
    { name: '金丹', sub: '丹成一品', need: 150, emoji: '☀️' },
    { name: '元嬰', sub: '元嬰出竅', need: 200, emoji: '✨' },
    { name: '化神', sub: '神念通天', need: 300, emoji: '🔮' },
    { name: '煉虛', sub: '虛空悟道', need: 450, emoji: '🌌' },
    { name: '合體', sub: '天地合一', need: 650, emoji: '☯️' },
    { name: '大乘', sub: '大道將成', need: 900, emoji: '⚡' },
    { name: '渡劫', sub: '雷劫問道', need: 1200, emoji: '⛈️' },
    { name: '真仙', sub: '踏入仙門', need: 1600, emoji: '🪽' }
  ];

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
    // 🔥 直接從 main-legacy 的記憶體讀取真正的「修為 (totalScore)」，不再依賴畫面文字
    if (typeof window.getCurrentUserData === 'function') {
        const user = window.getCurrentUserData();
        if (user && user.stats) {
            return Math.max(0, Number(user.stats.totalScore) || 0);
        }
    }
    return 0;
  }
  
  function realmFor(value) {
    let current = REALMS[0];
    REALMS.forEach((r) => { 
      if (value >= r.need) current = r; 
    });
    return current;
  }

  function nextRealm(value) { 
    return REALMS.find((r) => r.need > value) || null; 
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

  function injectStyle() {
    if (document.getElementById('xiuxian-theme-style')) return;
    
    const style = document.createElement('style'); 
    style.id = 'xiuxian-theme-style';
    style.textContent = `
      :root { --xq-gold:#e9c46a; --xq-purple:#9b8cff; }
      body { background: radial-gradient(circle at 50% 15%, rgba(74,68,122,.28), transparent 34%), #080b16 !important; }
      
      /* 🔥 刪除 (隱藏) 舊版首頁最上方的 Current Rank 欄位 */
      #page-home .pb-4 > .glass-panel:first-child { display: none !important; }
      
      .xiuxian-panel { margin:0 auto 16px; padding:18px; border:1px solid rgba(233,196,106,.25); border-radius:22px; background:linear-gradient(145deg,rgba(24,27,48,.96),rgba(12,15,29,.96)); box-shadow:0 12px 40px rgba(0,0,0,.25), inset 0 1px rgba(255,255,255,.05); }
      .xiuxian-kicker { color:var(--xq-gold); font-size:10px; letter-spacing:.28em; font-weight:900; }
      .xiuxian-realm { font-size:28px; font-weight:900; color:#fff; margin:0; text-shadow:0 0 18px rgba(233,196,106,.28); line-height: 1.1; }
      .xiuxian-sub { color:#aab0c5; font-size:11px; margin-top:2px; }
      .xiuxian-bar { height:9px; margin-top:12px; border-radius:999px; overflow:hidden; background:#090c18; border:1px solid rgba(255,255,255,.08); }
      .xiuxian-bar>div { height:100%; border-radius:inherit; background:linear-gradient(90deg,#8b5cf6,#e9c46a); box-shadow:0 0 14px rgba(233,196,106,.35); transition:width .5s ease; }
      .xiuxian-row { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px; }
      .xiuxian-label { color:#9da4bc; font-size:10px; }
      .xiuxian-value { color:#f3d98b; font-weight:900; font-size:12px; }
      .xiuxian-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; }
      .xiuxian-btn { border:1px solid rgba(233,196,106,.25); border-radius:12px; padding:10px 8px; color:#f6e6b0; background:rgba(233,196,106,.08); font-size:11px; font-weight:900; cursor:pointer; }
      .xiuxian-btn:hover { background:rgba(233,196,106,.16); transform:translateY(-1px); }
      .xiuxian-toast { position:fixed; left:50%; bottom:105px; transform:translate(-50%,15px); z-index:100; opacity:0; pointer-events:none; padding:10px 16px; border:1px solid rgba(233,196,106,.35); border-radius:999px; background:rgba(12,15,29,.95); color:#f7e8b5; font-size:12px; box-shadow:0 10px 30px rgba(0,0,0,.35); transition:.25s ease; }
      .xiuxian-toast.show { opacity:1; transform:translate(-50%,0); }
    `;
    document.head.appendChild(style);
  }

  function text(selector, value) { 
    document.querySelectorAll(selector).forEach(el => {
      if (el.textContent !== value) {
        el.textContent = value;
      }
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
    
    // 🔥 加入了頭像容器 xiuxian-avatar-slot
    panel.innerHTML = `
      <div class="xiuxian-kicker">仙途修行 · Cultivation Path</div>
      <div class="xiuxian-row" style="align-items:center; margin-top:12px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <div id="xiuxian-avatar-slot" style="transform: scale(0.9); transform-origin: left center;"></div>
          <div>
            <div id="xiuxian-realm" class="xiuxian-realm">🌱 凡人</div>
            <div id="xiuxian-sub" class="xiuxian-sub">初入仙途</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="xiuxian-label">當前修為</div>
          <div id="xiuxian-score" class="xiuxian-value">0</div>
        </div>
      </div>
      <div class="xiuxian-bar"><div id="xiuxian-progress" style="width:0%"></div></div>
      <div class="xiuxian-row">
        <span id="xiuxian-progress-label" class="xiuxian-label">距離下一境界</span>
        <span id="xiuxian-next" class="xiuxian-value">5</span>
      </div>
      <div class="xiuxian-actions">
        <button id="xiuxian-meditate" class="xiuxian-btn">🧘 今日閉關</button>
        <button id="xiuxian-path" class="xiuxian-btn">📜 修仙境界</button>
      </div>
    `;
    
    anchor.parentNode.insertBefore(panel, anchor);
    
    document.getElementById('xiuxian-meditate').addEventListener('click', meditate);
    document.getElementById('xiuxian-path').addEventListener('click', () => {
      alert(REALMS.map(r => `${r.emoji} ${r.name} ${r.sub}：${r.need} 修為起`).join('\n'));
    });
  }

  function rewriteLabels() {
    text('[data-i18n="btn_solo"]', '問道試煉'); 
    text('[data-i18n="btn_pvp"]', '鬥法論道');
    text('[data-i18n="nav_home"]', '仙府'); 
    text('[data-i18n="nav_quiz"]', '問道'); 
    text('[data-i18n="nav_rank"]', '仙榜');
    text('[data-i18n="nav_settings"]', '洞府'); 
    text('[data-i18n="nav_social"]', '仙盟'); 
    text('[data-i18n="inventory_title"]', '法寶庫');
    text('[data-i18n="rank_title"]', '九州仙榜'); 
    text('[data-i18n="th_rank"]', '境界');
    text('[data-i18n="btn_next_q"]', '繼續悟道'); 
    text('[data-i18n="btn_back_home"]', '返回仙府');
    
    // 🔥 手動修改原本首頁的四格面板標題，更符合修仙主題
    document.querySelectorAll('.stat-label').forEach(el => {
        if (el.innerText === 'ACCURACY') el.innerText = '悟性 (正確率)';
        if (el.innerText === 'STREAK') el.innerText = '當前道心';
        if (el.innerText === 'BEST RECORD') el.innerText = '最高道心';
    });
  }

  function render() {
    injectStyle(); 
    addHomePanel(); 
    rewriteLabels();

    const value = score();
    const realm = realmFor(value);
    const next = nextRealm(value);
    
    // 🔥 將原始生成的頭像移動到仙途修行的面板裡
    const avatarContainer = document.getElementById('home-avatar-container');
    const avatarSlot = document.getElementById('xiuxian-avatar-slot');
    if (avatarContainer && avatarSlot && avatarContainer.parentNode !== avatarSlot) {
        // 拔除舊版用來將頭像定位在畫面左上角的 class
        avatarContainer.className = '';
        avatarSlot.appendChild(avatarContainer);
    }

    const rank = document.getElementById('display-rank'); 
    const targetRank = `${realm.emoji} ${realm.name} ${realm.sub}`;
    if (rank && rank.textContent !== targetRank) {
      rank.textContent = targetRank;
    }
    
    // 更新仙途修行的仙位名稱
    const realmEl = document.getElementById('xiuxian-realm');
    if (realmEl) realmEl.textContent = `${realm.emoji} ${realm.name}`;
    
    const scoreEl = document.getElementById('xiuxian-score'); 
    if (scoreEl) scoreEl.textContent = `${value.toLocaleString()} 修為`;
    
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
      med.textContent = done ? '✅ 今日已閉關' : '🧘 今日閉關'; 
      med.disabled = done; 
      med.style.opacity = done ? '.55' : '1'; 
    }
  }

  function boot() { 
    render(); 
    setInterval(render, 1200); 

    const rankEl = document.getElementById('display-rank');
    if (rankEl) {
      new MutationObserver(() => {
        const value = score();
        const realm = realmFor(value);
        const targetRank = `${realm.emoji} ${realm.name} ${realm.sub}`;
        if (rankEl.textContent !== targetRank) {
          rankEl.textContent = targetRank;
        }
      }).observe(rankEl, { childList: true, characterData: true, subtree: true });
    }

    // 🔥 新增：監聽底層總修為 (display-score) 的變化，達成無延遲時時更新
    const scoreEl = document.getElementById('display-score');
    if (scoreEl) {
      new MutationObserver(() => {
        render(); 
      }).observe(scoreEl, { childList: true, characterData: true, subtree: true });
    }

    if (typeof window.updateTexts === 'function') {
      const originalUpdateTexts = window.updateTexts;
      window.updateTexts = function() {
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
