// 修仙世界玩法層：不依賴卡牌／抽卡系統，將既有答題與 PvP 轉化為修仙成長體驗。
(function () {
  'use strict';

  const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0, emoji: '🌱' },
    { name: '煉氣', sub: '聚氣入體', need: 100, emoji: '🌬️' },
    { name: '築基', sub: '道基初成', need: 500, emoji: '🪨' },
    { name: '金丹', sub: '丹成一品', need: 1500, emoji: '☀️' },
    { name: '元嬰', sub: '元嬰出竅', need: 3500, emoji: '✨' },
    { name: '化神', sub: '神念通天', need: 7000, emoji: '🔮' },
    { name: '煉虛', sub: '虛空悟道', need: 12000, emoji: '🌌' },
    { name: '合體', sub: '天地合一', need: 20000, emoji: '☯️' },
    { name: '大乘', sub: '大道將成', need: 32000, emoji: '⚡' },
    { name: '渡劫', sub: '雷劫問道', need: 50000, emoji: '⛈️' },
    { name: '真仙', sub: '踏入仙門', need: 80000, emoji: '🪽' }
  ];

  const KEY = 'xiuxian_world_state_v1';
  let state = loadState();

  function loadState() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { meditation: 0, lastMeditation: '' }; }
    catch (_) { return { meditation: 0, lastMeditation: '' }; }
  }
  function saveState() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function score() {
    const el = document.getElementById('display-score');
    if (!el) return 0;
    const n = String(el.textContent || '').replace(/[^0-9.-]/g, '');
    return Number(n) || 0;
  }
  function realmFor(value) {
    let current = REALMS[0];
    REALMS.forEach((r) => { if (value >= r.need) current = r; });
    return current;
  }
  function nextRealm(value) { return REALMS.find((r) => r.need > value) || null; }
  function pct(value) {
    const current = realmFor(value), next = nextRealm(value);
    if (!next) return 100;
    return Math.max(0, Math.min(100, ((value - current.need) / (next.need - current.need)) * 100));
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'xiuxian-toast'; el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 20);
    setTimeout(() => el.remove(), 2800);
  }
  function meditate() {
    const today = todayKey();
    if (state.lastMeditation === today) { toast('今日已閉關，明日再來吸納靈氣。'); return; }
    state.lastMeditation = today;
    state.meditation = (state.meditation || 0) + 1;
    saveState();
    toast(`閉關完成！道心穩固（累計 ${state.meditation} 日）`);
    render();
  }

  function injectStyle() {
    if (document.getElementById('xiuxian-theme-style')) return;
    const style = document.createElement('style'); style.id = 'xiuxian-theme-style';
    style.textContent = `
      :root { --xq-gold:#e9c46a; --xq-purple:#9b8cff; }
      body { background: radial-gradient(circle at 50% 15%, rgba(74,68,122,.28), transparent 34%), #080b16 !important; }
      .xiuxian-panel { margin:0 auto 16px; padding:18px; border:1px solid rgba(233,196,106,.25); border-radius:22px; background:linear-gradient(145deg,rgba(24,27,48,.96),rgba(12,15,29,.96)); box-shadow:0 12px 40px rgba(0,0,0,.25), inset 0 1px rgba(255,255,255,.05); }
      .xiuxian-kicker { color:var(--xq-gold); font-size:10px; letter-spacing:.28em; font-weight:900; }
      .xiuxian-realm { font-size:30px; font-weight:900; color:#fff; margin:4px 0 0; text-shadow:0 0 18px rgba(233,196,106,.28); }
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

  function text(selector, value) { const el = document.querySelector(selector); if (el) el.textContent = value; }

  function addHomePanel() {
    if (document.getElementById('xiuxian-panel')) return;
    const home = document.getElementById('page-home');
    if (!home) return;
    const anchor = home.querySelector('.grid.grid-cols-2');
    if (!anchor) return;
    const panel = document.createElement('section');
    panel.id = 'xiuxian-panel'; panel.className = 'xiuxian-panel';
    panel.innerHTML = `
      <div class="xiuxian-kicker">仙途修行 · Cultivation Path</div>
      <div class="xiuxian-row" style="align-items:flex-end">
        <div><div id="xiuxian-realm" class="xiuxian-realm">🌱 凡人</div><div id="xiuxian-sub" class="xiuxian-sub">初入仙途</div></div>
        <div style="text-align:right"><div class="xiuxian-label">當前修為</div><div id="xiuxian-score" class="xiuxian-value">0</div></div>
      </div>
      <div class="xiuxian-bar"><div id="xiuxian-progress" style="width:0%"></div></div>
      <div class="xiuxian-row"><span id="xiuxian-progress-label" class="xiuxian-label">距離下一境界</span><span id="xiuxian-next" class="xiuxian-value">100</span></div>
      <div class="xiuxian-actions"><button id="xiuxian-meditate" class="xiuxian-btn">🧘 今日閉關</button><button id="xiuxian-path" class="xiuxian-btn">📜 修仙境界</button></div>
    `;
    anchor.parentNode.insertBefore(panel, anchor);
    document.getElementById('xiuxian-meditate').addEventListener('click', meditate);
    document.getElementById('xiuxian-path').addEventListener('click', () => alert(REALMS.map(r => `${r.emoji} ${r.name}：${r.need} 修為起`).join('\n')));
  }

  function rewriteLabels() {
    document.title = '修仙世界 · 問道試煉';
    text('[data-i18n="app_name"]','修仙問道'); text('[data-i18n="app_title"]','修仙世界 · 問道試煉');
    text('[data-i18n="welcome_title"]','踏入仙途'); text('[data-i18n="welcome_desc"]','答題悟道 × 真人鬥法 × 境界突破');
    text('[data-i18n="btn_solo"]','問道試煉'); text('[data-i18n="btn_pvp"]','鬥法論道');
    text('[data-i18n="nav_home"]','仙府'); text('[data-i18n="nav_quiz"]','問道'); text('[data-i18n="nav_rank"]','仙榜');
    text('[data-i18n="nav_settings"]','洞府'); text('[data-i18n="nav_social"]','仙盟'); text('[data-i18n="inventory_title"]','法寶庫');
    text('[data-i18n="history_title"]','悟道紀錄'); text('[data-i18n="rank_title"]','九州仙榜'); text('[data-i18n="th_rank"]','境界');
    text('[data-i18n="stat_score"]','修為'); text('[data-i18n="stat_streak"]','連勝道心'); text('[data-i18n="stat_best_streak"]','最高連勝');
    text('[data-i18n="btn_next_q"]','繼續悟道'); text('[data-i18n="btn_back_home"]','返回仙府');
  }

  function render() {
    injectStyle(); addHomePanel(); rewriteLabels();
    const value = score(), realm = realmFor(value), next = nextRealm(value);
    const rank = document.getElementById('display-rank'); if (rank) rank.textContent = `${realm.emoji} ${realm.name}`;
    const scoreEl = document.getElementById('xiuxian-score'); if (scoreEl) scoreEl.textContent = `${value.toLocaleString()} 修為`;
    const sub = document.getElementById('xiuxian-sub'); if (sub) sub.textContent = realm.sub;
    const bar = document.getElementById('xiuxian-progress'); if (bar) bar.style.width = `${pct(value)}%`;
    const nextEl = document.getElementById('xiuxian-next'); if (nextEl) nextEl.textContent = next ? `${Math.max(0,next.need-value).toLocaleString()} 修為` : '已登仙';
    const label = document.getElementById('xiuxian-progress-label'); if (label) label.textContent = next ? `下一境界：${next.name}` : '已登仙，繼續悟道';
    const med = document.getElementById('xiuxian-meditate');
    if (med) { const done = state.lastMeditation === todayKey(); med.textContent = done ? '✅ 今日已閉關' : '🧘 今日閉關'; med.disabled = done; med.style.opacity = done ? '.55' : '1'; }
  }

  function boot() { render(); setInterval(render, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
