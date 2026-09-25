import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// 管理員帳號目錄。與統計儀表板共用 users/{uid}，不將公開排行榜當作註冊帳號。
(function () {
  'use strict';

  const PANEL_ID = 'admin-account-manager';
  const PAGE_SIZE = 20;
  let entries = [];
  let selectedUid = '';
  let activeUid = '';
  let loadSequence = 0;
  let loading = false;

  function currentUser() { return getAuth(getApp()).currentUser; }
  function isAdmin() {
    const user = currentUser();
    const player = window.getCurrentUserData?.();
    return !!user && player?.isAdmin === true && (!player.uid || player.uid === user.uid);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function fmtNumber(value) {
    return (Number(value) || 0).toLocaleString('zh-TW');
  }
  function dateNumber(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value.seconds !== undefined) return Number(value.seconds) * 1000;
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  function fmtDate(value) {
    const ms = dateNumber(value);
    return ms ? new Date(ms).toLocaleString('zh-TW') : '未記錄';
  }
  function errorMessage(error) {
    if (error?.status === 401) return '登入已失效，請重新登入後再開啟帳號管理。';
    if (error?.status === 403) return '此帳號沒有管理員權限。';
    if (error?.status === 503) return '帳號管理後端尚未就緒，請確認 Render 已設定 FIREBASE_A_SERVICE_ACCOUNT_JSON。';
    return error?.message || '讀取失敗，請檢查網路連線後再試。';
  }
  async function requestAdminAccounts(action, payload = {}) {
    const user = currentUser();
    if (!user || !isAdmin()) {
      const error = new Error('管理員身分已失效。');
      error.status = 401;
      throw error;
    }
    const idToken = await user.getIdToken();
    const response = await fetch('/api/admin/accounts', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + idToken
      },
      body: JSON.stringify({ action, ...payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error || '帳號管理服務讀取失敗。');
      error.status = response.status;
      throw error;
    }
    if (currentUser()?.uid !== user.uid) {
      const error = new Error('管理員帳號已切換。');
      error.status = 401;
      throw error;
    }
    return body;
  }
  function addStyle() {
    if (document.getElementById('admin-account-manager-style')) return;
    const style = el('style');
    style.id = 'admin-account-manager-style';
    style.textContent = [
      '#admin-account-manager{color:#e7ddc9}',
      '#admin-account-manager .aum-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}',
      '#admin-account-manager .aum-header h3{font-size:15px;font-weight:900;color:#f2dfa8}',
      '#admin-account-manager .aum-muted{color:#998e7a;font-size:11px;line-height:1.6}',
      '#admin-account-manager .aum-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}',
      '#admin-account-manager input{flex:1;min-width:150px;border:1px solid rgba(216,177,93,.25);border-radius:9px;padding:9px 10px;background:#0c0b09;color:#f0e4c9;font-size:12px}',
      '#admin-account-manager button{cursor:pointer}',
      '#admin-account-manager button:disabled{cursor:default;opacity:.45}',
      '#admin-account-manager .aum-action{padding:8px 12px;border:1px solid rgba(216,177,93,.38);border-radius:9px;background:rgba(216,177,93,.09);color:#f2dfa8;font-size:11px;font-weight:800}',
      '#admin-account-manager .aum-list{display:grid;gap:6px;margin-top:8px}',
      '#admin-account-manager .aum-player{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;padding:10px 12px;border:1px solid rgba(216,177,93,.14);border-radius:10px;background:rgba(24,20,15,.7)}',
      '#admin-account-manager .aum-player:hover,#admin-account-manager .aum-player[aria-pressed="true"]{border-color:rgba(216,177,93,.6);background:rgba(216,177,93,.08)}',
      '#admin-account-manager .aum-player b{display:block;color:#ebdfc7;font-size:12px;overflow-wrap:anywhere}',
      '#admin-account-manager .aum-player small{display:block;color:#998e7a;font-size:10px;overflow-wrap:anywhere}',
      '#admin-account-manager .aum-tag{display:inline-block;border:1px solid rgba(216,177,93,.3);border-radius:6px;padding:2px 6px;color:#f3d38b;font-size:9px;white-space:nowrap}',
      '#admin-account-manager .aum-pager{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:10px}',
      '#admin-account-manager .aum-detail{margin-top:14px;padding-top:12px;border-top:1px solid rgba(216,177,93,.18)}',
      '#admin-account-manager .aum-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:8px 0 12px}',
      '#admin-account-manager .aum-field{padding:9px;background:rgba(255,255,255,.025);border:1px solid rgba(216,177,93,.12);border-radius:9px;min-width:0}',
      '#admin-account-manager .aum-field dt{font-size:10px;color:#9b8a6e;margin-bottom:3px}',
      '#admin-account-manager .aum-field dd{margin:0;font-size:12px;color:#f4e8ce;overflow-wrap:anywhere;white-space:pre-wrap}',
      '#admin-account-manager .aum-section{font-size:12px;color:#e6c77c;font-weight:900;margin:13px 0 7px}',
      '#admin-account-manager .aum-json{max-height:260px;overflow:auto;padding:10px;border:1px solid rgba(216,177,93,.18);border-radius:9px;background:#080807;font-size:10px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:#c9bca4}',
      '#admin-account-manager .aum-detail details{margin-top:9px}',
      '#admin-account-manager .aum-detail summary{cursor:pointer;color:#d7be84;font-size:11px}',
      '@media(max-width:560px){#admin-account-manager .aum-player{align-items:flex-start;flex-direction:column;gap:4px}}'
    ].join('\n');
    document.head.appendChild(style);
  }
  function mount() {
    if (!isAdmin()) return null;
    const page = document.getElementById('page-admin');
    if (!page) return null;
    const found = document.getElementById(PANEL_ID);
    if (found) return found;
    addStyle();
    const panel = el('section', 'glass-panel p-4 rounded-xl mb-4');
    panel.id = PANEL_ID;
    panel.dataset.adminSectionTitle = '帳號管理';
    panel.dataset.adminSectionSummary = '搜尋及檢視已註冊玩家資訊';
    panel.dataset.adminSectionIcon = 'fa-users-gear';
    panel.innerHTML = [
      '<div class="aum-header"><div><h3><i class="fa-solid fa-users-gear"></i> 帳號管理</h3>',
      '<p class="aum-muted">由後端驗證管理員身分後讀取 users；本頁不再直接監聽或列舉 Firestore。</p></div>',
      '<button type="button" class="aum-action" id="aum-refresh"><i class="fa-solid fa-rotate"></i> 重新整理</button></div>',
      '<div class="aum-bar"><input id="aum-search" type="search" autocomplete="off" placeholder="搜尋名稱、Email、UID、好友碼" aria-label="搜尋已註冊帳號"></div>',
      '<p id="aum-status" class="aum-muted" role="status">進入管理員頁面後載入帳號。</p>',
      '<div id="aum-list" class="aum-list"></div>',
      '<div id="aum-pager" class="aum-pager"></div>',
      '<div id="aum-detail" class="aum-detail" hidden></div>'
    ].join('');
    const heading = page.querySelector('h2');
    if (heading?.nextSibling) page.insertBefore(panel, heading.nextSibling);
    else page.prepend(panel);
    panel.querySelector('#aum-search').addEventListener('input', () => renderList(0));
    panel.querySelector('#aum-refresh').addEventListener('click', () => void loadAccounts(true));
    panel.querySelector('#aum-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-uid]');
      if (button) void showDetail(button.dataset.uid);
    });
    return panel;
  }
  function matches(entry, keyword) {
    if (!keyword) return true;
    return [entry.uid, entry.data.displayName, entry.data.name, entry.data.email, entry.data.friendCode]
      .some(value => String(value || '').toLocaleLowerCase().includes(keyword));
  }
  function renderList(pageIndex = 0) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin()) return;
    const keyword = panel.querySelector('#aum-search').value.trim().toLocaleLowerCase();
    const visible = entries.filter(entry => matches(entry, keyword));
    const count = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const index = Math.min(Math.max(0, pageIndex), count - 1);
    panel.querySelector('#aum-status').textContent = loading ? '正在讀取帳號…' : '共 ' + entries.length + ' 個遊戲帳號，符合搜尋 ' + visible.length + ' 個。';
    const list = panel.querySelector('#aum-list');
    list.replaceChildren();
    visible.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE).forEach(({ uid, data }) => {
      const button = el('button', 'aum-player');
      button.type = 'button';
      button.dataset.uid = uid;
      button.setAttribute('aria-pressed', String(uid === selectedUid));
      const text = el('span');
      text.append(el('b', '', data.displayName || data.name || '未命名玩家'),
        el('small', '', (data.email || '無 Email') + ' · ' + uid),
        el('small', '', '最後活躍：' + fmtDate(data.lastActive)));
      button.append(text, el('span', 'aum-tag', data.isAdmin === true ? '管理員' : '玩家'));
      list.appendChild(button);
    });
    if (!visible.length && !loading) list.appendChild(el('p', 'aum-muted', '沒有符合條件的帳號。'));
    const pager = panel.querySelector('#aum-pager');
    pager.replaceChildren();
    if (count > 1) {
      const prev = el('button', 'aum-action', '上一頁');
      prev.disabled = index === 0;
      prev.addEventListener('click', () => renderList(index - 1));
      const next = el('button', 'aum-action', '下一頁');
      next.disabled = index === count - 1;
      next.addEventListener('click', () => renderList(index + 1));
      pager.append(prev, el('span', 'aum-muted', (index + 1) + ' / ' + count), next);
    }
  }
  async function loadAccounts(force = false) {
    const panel = mount();
    if (!panel || !isAdmin()) return;
    if (loading || (!force && entries.length)) {
      renderList(0);
      return;
    }
    const uid = currentUser().uid;
    const sequence = ++loadSequence;
    loading = true;
    panel.querySelector('#aum-refresh').disabled = true;
    panel.querySelector('#aum-status').textContent = '正在讀取帳號…';
    try {
      const payload = await requestAdminAccounts('list');
      if (sequence !== loadSequence || currentUser()?.uid !== uid || !isAdmin()) return;
      entries = Array.isArray(payload.entries) ? payload.entries : [];
      renderList(0);
      // 正在檢視的玩家可能已刪除或被改名；重新整理時清除舊的詳細資訊。
      selectedUid = '';
      panel.querySelector('#aum-detail').replaceChildren();
      panel.querySelector('#aum-detail').hidden = true;
    } catch (error) {
      if (sequence !== loadSequence) return;
      console.error('[Admin Accounts] list failed', error);
      panel.querySelector('#aum-status').textContent = error?.message === '管理員身分已失效。'
        ? error.message : errorMessage(error);
    } finally {
      if (sequence === loadSequence) {
        loading = false;
        panel.querySelector('#aum-refresh').disabled = false;
        // 成功載入後同步更新人數狀態；錯誤訊息不會被覆蓋。
        if (panel.querySelector('#aum-status').textContent === '正在讀取帳號…') renderList(0);
      }
    }
  }
  function field(grid, label, value) {
    const wrapper = el('div', 'aum-field');
    const key = el('dt', '', label);
    const text = el('dd', '', value === undefined || value === null || value === '' ? '未記錄' : value);
    wrapper.append(key, text);
    grid.appendChild(wrapper);
  }
  function section(root, title, pairs) {
    root.appendChild(el('h4', 'aum-section', title));
    const grid = el('dl', 'aum-grid');
    pairs.forEach(([key, value]) => field(grid, key, value));
    root.appendChild(grid);
  }
  function inventoryEntries(inventory) {
    if (Array.isArray(inventory)) {
      return inventory.map((item, i) => [item?.name || item?.id || '物品 ' + (i + 1),
        item?.quantity ?? item?.count ?? (typeof item === 'string' ? item : JSON.stringify(item))]);
    }
    if (inventory && typeof inventory === 'object') return Object.entries(inventory);
    return [];
  }
  function describeInventory(value) {
    const pairs = inventoryEntries(value).filter(([, count]) => count !== 0 && count !== null);
    return pairs.length ? pairs.slice(0, 150).map(([id, count]) => id + '：' + (typeof count === 'object' ? JSON.stringify(count) : String(count))).join('\n') : '無';
  }
  function safeJson(value) {
    const hidden = /password|secret|token|credential|private.?key|authorization|api.?key/i;
    const seen = new WeakSet();
    return JSON.stringify(value, (key, item) => {
      if (hidden.test(key)) return '[已遮蔽]';
      if (item && typeof item === 'object') {
        if (typeof item.toDate === 'function') return fmtDate(item);
        if (seen.has(item)) return '[循環參照]';
        seen.add(item);
      }
      return item;
    }, 2);
  }
  async function showDetail(uid) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !isAdmin() || !uid) return;
    const requesterUid = currentUser().uid;
    selectedUid = uid;
    const sequence = ++loadSequence;
    const detail = panel.querySelector('#aum-detail');
    detail.hidden = false;
    detail.replaceChildren(el('p', 'aum-muted', '正在載入玩家詳情…'));
    renderListPageSelection();
    try {
      const payload = await requestAdminAccounts('detail', { uid });
      if (sequence !== loadSequence || !isAdmin() || currentUser()?.uid !== requesterUid || selectedUid !== uid) return;
      detail.replaceChildren();
      const data = payload?.data || {};
      const stats = data.stats || {};
      const profile = data.profile || {};
      const answered = Number(stats.totalAnswered) || 0;
      const correct = Number(stats.totalCorrect) || 0;
      detail.appendChild(el('h3', 'aum-section', (data.displayName || data.name || '未命名玩家') + ' · 玩家資訊'));
      section(detail, '帳號與個人資料', [
        ['帳號 UID', uid], ['角色名稱', data.displayName || data.name],
        ['Email', data.email], ['身分', data.isAdmin === true ? '管理員' : '一般玩家'],
        ['好友碼', data.friendCode], ['註冊時間', fmtDate(data.createdAt)],
        ['最後活躍', fmtDate(data.lastActive)], ['學習階段', profile.educationLevel],
        ['擅長科目', profile.strongSubjects], ['待加強科目', profile.weakSubjects]
      ]);
      section(detail, '修為與學習進度', [
        ['修為', fmtNumber(stats.totalScore)], ['境界級別', stats.rankLevel ?? 0],
        ['當前星數', fmtNumber(stats.currentStars)], ['靈石', fmtNumber(stats.gold)],
        ['累積答題', fmtNumber(answered)], ['答對題數', fmtNumber(correct)],
        ['正確率', answered ? (correct / answered * 100).toFixed(1) + '%' : '尚未答題'],
        ['目前連勝', fmtNumber(stats.currentStreak)], ['最佳連勝', fmtNumber(stats.bestStreak)]
      ]);
      const slots = data.artifactSystem?.equipped || {};
      section(detail, '已裝備法寶', [
        ...['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶'].map(slot => [slot, slots[slot] || '未裝備']),
        ['頭像外觀', data.equipped?.avatar], ['頭像框', data.equipped?.frame]
      ]);
      section(detail, '背包與資源', [
        ['法寶', describeInventory(data.artifactSystem?.inventory)],
        ['材料', describeInventory(data.materialSystem?.inventory)],
        ['其他背包物品', describeInventory(data.inventory)]
      ]);
      const more = el('details');
      more.appendChild(el('summary', '', '展開其他玩家儲存資料（唯讀，私密欄位已遮蔽）'));
      const json = el('pre', 'aum-json');
      const dataText = safeJson(data);
      json.textContent = dataText.length > 40000 ? dataText.slice(0, 40000) + '\n…資料過長，已截斷' : dataText;
      more.appendChild(json);
      detail.appendChild(more);
    } catch (error) {
      if (sequence !== loadSequence) return;
      console.error('[Admin Accounts] detail failed', error);
      detail.replaceChildren(el('p', 'aum-muted',
        error?.message === '管理員身分已失效。' ? error.message : errorMessage(error)));
    }
  }
  function renderListPageSelection() {
    document.querySelectorAll('#aum-list button[data-uid]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.uid === selectedUid));
    });
  }
  function clear() {
    ++loadSequence;
    loading = false;
    entries = [];
    selectedUid = '';
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }
  function install() {
    if (typeof window.loadAdminData !== 'function' || window.loadAdminData.__accountDirectoryWrapped) return;
    const original = window.loadAdminData;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (isAdmin()) void loadAccounts();
      return result;
    };
    wrapped.__accountDirectoryWrapped = true;
    window.loadAdminData = wrapped;
  }
  function boot() {
    install();
    mount();
    onAuthStateChanged(getAuth(getApp()), user => {
      if (!user || (activeUid && activeUid !== user.uid)) clear();
      activeUid = user?.uid || '';
      if (isAdmin()) mount();
    });
    window.addEventListener('xiuxian:user-ready', () => { install(); mount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
