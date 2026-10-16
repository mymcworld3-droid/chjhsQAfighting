import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

(function () {
  'use strict';
  const ID = 'admin-player-analytics';
  let loading = false, queued = false, requestId = 0, loaded = false, range = 7;
  const NAMES = {
    question_started: '進入問道題目', answer_completed: '完成有效作答',
    social_participated: '參與多人玩法', question_load_failed: '題目載入失敗'
  };
  const MODES = { solo: '問道', raid: '團本', duel: '鬥法', meditation: '閉關', other: '其他' };
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function isAdmin() {
    const player = window.getCurrentUserData?.();
    const user = authUser();
    return !!user && player?.isAdmin === true && (!player.uid || player.uid === user.uid);
  }
  function node(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = String(text);
    return e;
  }
  function value(n) { return Number(n || 0).toLocaleString('zh-TW'); }
  function ratio(n) { return n == null ? '—' : Number(n).toFixed(1) + '%'; }
  function note(text) { return node('span', 'apa-note', text); }
  function style() {
    if (document.getElementById('apa-style')) return;
    const s = node('style'); s.id = 'apa-style';
    s.textContent = [
      '#admin-player-analytics{color:#e5dac6;font-size:12px}',
      '#admin-player-analytics .apa-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
      '#admin-player-analytics h3{font-size:15px;font-weight:850;color:#f0dab2}',
      '#admin-player-analytics .apa-note{color:#968c7d;line-height:1.65;font-size:11px}',
      '#admin-player-analytics .apa-actions{display:flex;gap:7px;align-items:center}',
      '#admin-player-analytics button{padding:7px 10px;border:1px solid rgba(216,177,93,.25);border-radius:8px;background:#191711;color:#ddcba4;cursor:pointer;font-size:11px}',
      '#admin-player-analytics button[aria-pressed="true"]{background:#41341c;border-color:#c5a15a;color:#ffe7ab}',
      '#admin-player-analytics button:disabled{opacity:.5;cursor:default}',
      '#admin-player-analytics .apa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:14px 0}',
      '#admin-player-analytics .apa-stat{background:rgba(19,18,16,.76);border:1px solid rgba(216,177,93,.14);border-radius:10px;padding:11px;min-width:0}',
      '#admin-player-analytics .apa-label{font-size:11px;color:#b7a584;font-weight:800}',
      '#admin-player-analytics .apa-number{font-size:23px;color:#f0dfb7;font-weight:900;margin:3px 0;font-variant-numeric:tabular-nums}',
      '#admin-player-analytics .apa-section{margin:16px 0 7px;font-size:13px;font-weight:800;color:#dcc18c}',
      '#admin-player-analytics .apa-chart{display:flex;align-items:end;gap:8px;height:112px;padding:13px 7px 0;background:#100f0d;border:1px solid rgba(216,177,93,.14);border-radius:9px}',
      '#admin-player-analytics .apa-barcol{min-width:0;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:4px;height:100%}',
      '#admin-player-analytics .apa-bar{min-height:2px;width:70%;max-width:54px;background:#bd9a53;border-radius:3px 3px 0 0}',
      '#admin-player-analytics .apa-barcol small{font-size:9px;color:#968c7d;white-space:nowrap}',
      '#admin-player-analytics .apa-events{margin-top:8px;max-height:245px;overflow:auto;border:1px solid rgba(216,177,93,.13);border-radius:9px}',
      '#admin-player-analytics .apa-event{display:grid;grid-template-columns:minmax(90px,1.2fr) minmax(45px,.5fr) minmax(78px,1fr) minmax(62px,.7fr);gap:8px;padding:9px 10px;border-bottom:1px solid rgba(216,177,93,.1);align-items:center}',
      '#admin-player-analytics .apa-event:last-child{border-bottom:none}',
      '#admin-player-analytics .apa-event small{color:#928878;font-size:10px;overflow-wrap:anywhere}',
      '#admin-player-analytics .apa-defs{border-top:1px solid rgba(216,177,93,.16);margin-top:12px;padding-top:12px}',
      '#admin-player-analytics .apa-defs p{margin:5px 0}',
      '@media(max-width:520px){#admin-player-analytics .apa-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#admin-player-analytics .apa-event{grid-template-columns:minmax(85px,1fr) 42px 76px}#admin-player-analytics .apa-event small:last-child{display:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function mount() {
    if (!isAdmin()) return null;
    const page = document.getElementById('page-admin');
    if (!page) return null;
    const exists = document.getElementById(ID);
    if (exists) return exists;
    style();
    const panel = node('section', 'glass-panel p-4 rounded-xl mb-4');
    panel.id = ID;
    panel.dataset.adminSectionTitle = '玩家事件與留存分析';
    panel.dataset.adminSectionSummary = '首題、首三題、D1／D7、學習及多人參與';
    panel.dataset.adminSectionIcon = 'fa-chart-simple';
    panel.innerHTML = [
      '<div class="apa-head"><div><h3><i class="fa-solid fa-chart-simple"></i> 玩家事件與留存分析</h3>',
      '<span class="apa-note">台灣時間（UTC+8）・僅統計事件追蹤啟用後的資料</span></div>',
      '<div class="apa-actions"><button type="button" data-range="7" aria-pressed="true">近 7 日</button>',
      '<button type="button" data-range="30" aria-pressed="false">近 30 日</button>',
      '<button type="button" id="apa-refresh">更新</button></div></div>',
      '<p id="apa-status" class="apa-note" role="status">讀取中…</p>',
      '<div class="apa-grid" id="apa-grid"></div>',
      '<h4 class="apa-section">最近 7 天有效答題量</h4><div class="apa-chart" id="apa-chart"></div>',
      '<h4 class="apa-section">最近玩家事件（最多 25 筆）</h4><div class="apa-events" id="apa-events"></div>',
      '<div class="apa-defs">',
      '<p class="apa-note">首題開始率：所選期間首次到訪的瀏覽器中，曾成功顯示問道題目的比例；清除 Cookie 或換裝置會成為新訪客。</p>',
      '<p class="apa-note">首三題完成率：同期新建玩家帳號中，曾開始問道且已完成至少 3 題有效作答的比例；略過題目不計。</p>',
      '<p class="apa-note">D1／D7：依 Firebase 帳號建立日期固定分群，隔 1／7 個台灣日曆日有回訪即算留存。只納入在註冊當日被追蹤到、並已滿觀察天數的玩家；分母另行顯示。</p>',
      '<p class="apa-note">有效答題：問道、閉關、鬥法及團本的已完成作答（以事件識別碼去重）。社交參與：成功提交鬥法或團本行動；不以開啟頁面計算。</p>',
      '<p class="apa-note">載入失敗率：最近 7 天問道題目載入失敗／（成功顯示＋失敗）。社交與 D1 的比較僅代表相關，不能推論多人玩法造成留存成長。</p>',
      '<p class="apa-note">匿名 Cookie 與已登入玩家分開計算。追蹤功能停用、封鎖請求或網路中斷會使資料低估；事件不記錄題幹、答案、Email 或 IP。歷史資料不補算。</p>',
      '</div>'
    ].join('');
    const heading = page.querySelector('h2');
    if (heading?.nextSibling) page.insertBefore(panel, heading.nextSibling);
    else page.prepend(panel);
    panel.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
      range = Number(button.dataset.range);
      panel.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === range)));
      void load();
    }));
    panel.querySelector('#apa-refresh').addEventListener('click', () => void load());
    return panel;
  }
  function card(parent, label, metric, subtitle) {
    const el = node('div', 'apa-stat');
    el.append(node('div', 'apa-label', label), node('div', 'apa-number', metric), note(subtitle));
    parent.append(el);
  }
  function render(data) {
    const panel = document.getElementById(ID);
    if (!panel) return;
    const grid = panel.querySelector('#apa-grid');
    grid.replaceChildren();
    card(grid, '首題開始率', ratio(data.visitors.rate),
      value(data.visitors.started) + '／' + value(data.visitors.total) + ' 位新訪客');
    card(grid, '首三題完成率', ratio(data.firstThree.rate),
      value(data.firstThree.completed) + '／' + value(data.firstThree.started) + ' 位首題玩家');
    card(grid, 'D1 留存率', ratio(data.d1.rate),
      value(data.d1.returned) + '／' + value(data.d1.eligible) + ' 位成熟群組玩家');
    card(grid, 'D7 留存率', ratio(data.d7.rate),
      value(data.d7.returned) + '／' + value(data.d7.eligible) + ' 位成熟群組玩家');
    card(grid, '每週有效答題數', value(data.weekly.answers),
      '問道 ' + value(data.weekly.solo) + ' · 團本 ' + value(data.weekly.raid) + ' · 鬥法 ' + value(data.weekly.duel) + ' · 閉關 ' + value(data.weekly.meditation));
    card(grid, '社交參與率（7 天）', ratio(data.social.rate),
      value(data.social.participants) + '／' + value(data.social.active) + ' 位活躍玩家');
    card(grid, '題目載入失敗率（7 天）', ratio(data.loading.rate),
      value(data.loading.failed) + ' 次失敗／' + value(data.loading.success + data.loading.failed) + ' 次載入');
    card(grid, '社交玩家 D1', ratio(data.social.cohortD1Social.rate),
      '首日參與多人 ' + value(data.social.cohortD1Social.eligible) + ' 人；未參與 ' + ratio(data.social.cohortD1Other.rate));
    const chart = panel.querySelector('#apa-chart');
    chart.replaceChildren();
    const top = Math.max(1, ...data.daily.map(d => Number(d.answers) || 0));
    data.daily.forEach(item => {
      const col = node('div', 'apa-barcol');
      const amount = Number(item.answers) || 0;
      const bar = node('div', 'apa-bar');
      bar.style.height = String(Math.max(2, amount / top * 70)) + 'px';
      bar.title = item.day + '：' + amount + ' 題';
      col.append(node('small', '', amount), bar, node('small', '', item.day.slice(5)));
      chart.appendChild(col);
    });
    const events = panel.querySelector('#apa-events');
    events.replaceChildren();
    if (!data.recentEvents.length) events.appendChild(node('p', 'apa-note', '尚無事件資料。'));
    data.recentEvents.forEach(item => {
      const row = node('div', 'apa-event');
      row.append(node('span', '', NAMES[item.type] || '遊戲事件'),
        node('small', '', MODES[item.mode] || '其他'),
        node('small', '', item.at ? new Date(item.at).toLocaleString('zh-TW', {timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}) : item.day),
        node('small', '', '玩家 #' + item.player));
      events.appendChild(row);
    });
    const status = '新訪客群組：' + data.from + '～' + data.to +
      '；D1／D7 已排除未成熟群組。' +
      (data.truncated ? ' 資料量超出單次查詢上限，結果不完整，請縮短期間。' : '');
    panel.querySelector('#apa-status').textContent = status;
  }
  async function load() {
    const panel = mount();
    if (!panel || !isAdmin()) return;
    if (loading) { queued = true; return; }
    const user = authUser(), id = ++requestId;
    loading = true;
    panel.querySelector('#apa-status').textContent = '正在彙整事件與固定玩家群組…';
    panel.querySelector('#apa-refresh').disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/player-analytics', {
        method:'POST', cache:'no-store',
        headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
        body:JSON.stringify({range})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '統計服務讀取失敗：' + res.status);
      if (id !== requestId || authUser()?.uid !== user.uid || !isAdmin()) return;
      render(data); loaded = true;
    } catch (error) {
      if (id === requestId) panel.querySelector('#apa-status').textContent = error.message || '分析資料讀取失敗。';
    } finally {
      loading = false;
      panel.querySelector('#apa-refresh').disabled = false;
      if (queued) { queued = false; void load(); }
    }
  }
  function boot() {
    mount();
    window.addEventListener('xiuxian:user-ready', () => { if (mount() && !loaded) void load(); });
    window.addEventListener('xiuxian:user-data-ready', () => { if (mount() && !loaded) void load(); });
    // Layouts that were already mounted may become visible after role changes.
    document.addEventListener('click', event => {
      if (event.target.closest?.('#nav-admin') && mount() && !loaded) void load();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
