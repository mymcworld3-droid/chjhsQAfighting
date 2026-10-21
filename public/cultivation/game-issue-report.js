import { authenticatedMainFetch, getMainUser } from './data/project-repository.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import './refinery-errors.js';

const $ = id => document.getElementById(id);
const uid = () => getMainUser()?.uid || '';
const isAdmin = () => {
  const player = window.getCurrentUserData?.();
  return !!uid() && player?.isAdmin === true && (!player.uid || player.uid === uid());
};
const clean = (value, max) => globalThis.QARefineryErrors.clean(value, max);
const CATEGORIES = ['功能異常', '畫面與操作', '資料與獎勵', '其他問題'];
const STATUS = { open: '待處理', investigating: '處理中', resolved: '已解決' };
let account = '', entries = [], cursor = null, loading = false, generation = 0;
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function request(endpoint, payload) {
  const owner = uid(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    if (!owner) throw new Error('請先登入後再回報問題。');
    const response = await authenticatedMainFetch(endpoint, { method: 'POST', body: JSON.stringify(payload), signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (uid() !== owner) throw new Error('帳號已切換，請重新開啟回報。');
    if (!response.ok || !result.ok) throw new Error(result.error || '回報服務暫時無法使用，請稍後重試。');
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('回報連線逾時，內容已保留，可重試送出。');
    throw error;
  } finally { clearTimeout(timer); }
}
function addStyle() {
  if ($('game-issue-style')) return;
  const style = node('style'); style.id = 'game-issue-style';
  style.textContent = `
    #game-issue-dialog{width:min(520px,calc(100vw - 24px));max-height:88dvh;overflow:auto;border:1px solid #9c804a;border-radius:16px;background:#141b21;color:#eee3cb;padding:20px;z-index:23000}
    #game-issue-dialog::backdrop{background:#02070bd6}
    #game-issue-dialog h3{font-size:19px;margin:0 0 10px}
    #game-issue-dialog p,#game-issue-dialog label,#admin-game-issues p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}
    #game-issue-dialog label{display:block;margin:12px 0 5px}
    #game-issue-dialog textarea,#game-issue-dialog select,#admin-game-issues textarea,#admin-game-issues select{width:100%;padding:10px;border:1px solid #766744;border-radius:9px;background:#0b1218;color:#f0e4ce;font:inherit;box-sizing:border-box}
    #game-issue-dialog textarea{min-height:140px;resize:vertical}
    #game-issue-dialog pre,#admin-game-issues pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
    .game-issue-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}
    #game-issue-dialog button,#admin-game-issues button{padding:10px 14px;min-height:42px;border:1px solid #8f7847;border-radius:9px;background:#423720;color:#f4dfad;font:inherit;cursor:pointer}
    #game-issue-dialog button:disabled,#admin-game-issues button:disabled{opacity:.5;cursor:wait}
    #admin-game-issues{color:#e6dcc5}#admin-game-issues article{padding:13px;border:1px solid #a98b4b44;border-radius:10px;margin:10px 0;background:#ffffff03}
    #admin-game-issues h4{font-size:14px;margin:0 0 7px}#admin-game-issues textarea{min-height:65px;font-size:12px}
    #admin-game-issues .issue-description{white-space:pre-wrap}
  `;
  document.head.appendChild(style);
}
window.openGameIssueReport = (options = {}) => {
  if (!uid()) { window.showToast?.('請先登入後再回報問題。'); return; }
  if ($('game-issue-dialog')) { $('game-issue-description')?.focus(); return; }
  addStyle();
  const owner = uid();
  // A failed/uncertain submission keeps this ID, so retrying cannot create duplicates.
  const requestId = globalThis.crypto?.randomUUID?.() || `issue-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  const context = {
    page: document.querySelector('.page-section.active-page')?.id || '',
    version: '20261021-issues-v1', viewport: `${window.innerWidth}×${window.innerHeight}`,
    browser: clean(navigator.userAgent, 400), diagnostics: clean(options.diagnostics || '', 6000)
  };
  const dialog = node('dialog'); dialog.id = 'game-issue-dialog'; dialog.setAttribute('aria-labelledby', 'game-issue-title');
  dialog.innerHTML = '<h3 id="game-issue-title">回報問題</h3><p>請說明在哪個功能、做了什麼，以及實際發生的情況。送出後管理員可在管理頁查看。</p><form><label for="game-issue-category">問題類型</label><select id="game-issue-category"></select><label for="game-issue-description">問題說明（5～3000 字）</label><textarea id="game-issue-description" required minlength="5" maxlength="3000" placeholder="例如：在機緣洞天按展卷後直接返回問道，下一題又再次出現。"></textarea><details><summary>隨回報附上的資訊</summary><pre></pre></details><p id="game-issue-status" role="status"></p><div class="game-issue-actions"><button type="submit">送出回報</button><button type="button" data-close>取消</button></div></form>';
  const form = dialog.querySelector('form'), select = dialog.querySelector('select'), description = dialog.querySelector('textarea');
  CATEGORIES.forEach(category => { const option = node('option', category); option.value = category; select.appendChild(option); });
  select.value = CATEGORIES.includes(options.category) ? options.category : CATEGORIES[0];
  description.value = String(options.description || '').slice(0, 3000);
  dialog.querySelector('pre').textContent = JSON.stringify(context, null, 2);
  const close = () => { dialog.close?.(); dialog.remove(); };
  dialog.querySelector('[data-close]').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  let sending = false, sent = false, pendingPayload = null;
  form.onsubmit = async event => {
    event.preventDefault();
    if (sending || sent || uid() !== owner) return;
    if (description.value.trim().length < 5) { $('game-issue-status').textContent = '請至少用五個字說明問題。'; return; }
    sending = true;
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    pendingPayload ||= { requestId, category: select.value, description: description.value.trim(), context };
    description.disabled = true; select.disabled = true;
    try {
      const result = await request('/api/game-issues', pendingPayload);
      if (!dialog.isConnected || uid() !== owner) return;
      sent = true;
      $('game-issue-status').textContent = `回報已送出，管理員可查看。編號：${result.reportId}`;
      submit.textContent = '已送出'; description.disabled = true; select.disabled = true;
      dialog.querySelector('[data-close]').textContent = '關閉';
    } catch (error) {
      if (dialog.isConnected && uid() === owner) { $('game-issue-status').textContent = error.message; submit.disabled = false; }
    } finally { sending = false; }
  };
  document.body.appendChild(dialog);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  description.focus();
};
function renderEntries() {
  const list = $('admin-game-issue-list'); if (!list) return;
  list.replaceChildren();
  for (const entry of entries) {
    const card = node('article');
    card.append(node('h4', `${STATUS[entry.status] || entry.status} · ${entry.category}`),
      node('p', `${entry.reporterName || '修士'} · ${new Date(entry.createdAtMs).toLocaleString('zh-TW')}`),
      node('p', entry.description, 'issue-description'));
    const details = node('details'), summary = node('summary', '回報資訊與診斷'), pre = node('pre', JSON.stringify({ id: entry.id, uid: entry.reporterUid, ...entry.context }, null, 2));
    details.append(summary, pre); card.appendChild(details);
    const select = node('select'); select.setAttribute('aria-label', '處理狀態');
    Object.entries(STATUS).forEach(([value, label]) => { const option = node('option', label); option.value = value; select.appendChild(option); }); select.value = entry.status;
    const note = node('textarea'); note.value = entry.adminNote || ''; note.maxLength = 1000; note.setAttribute('aria-label', '管理員處理備註'); note.placeholder = '管理員處理備註';
    const save = node('button', '儲存處理狀態'), status = node('p'); status.setAttribute('role', 'status');
    save.type = 'button';
    save.onclick = async () => {
      if (!isAdmin()) return;
      const owner = uid(), operation = generation; save.disabled = true;
      try {
        const result = await request('/api/admin/game-issues', { action: 'update', reportId: entry.id, status: select.value, adminNote: note.value });
        if (uid() !== owner || !isAdmin() || generation !== operation) return;
        Object.assign(entry, result.entry); renderEntries();
      } catch (error) { if (card.isConnected) status.textContent = error.message; }
      finally { if (save.isConnected) save.disabled = false; }
    };
    const actions = node('div', undefined, 'game-issue-actions'); actions.append(select, save);
    card.append(note, actions, status); list.appendChild(card);
  }
  if (!entries.length) list.appendChild(node('p', '目前沒有問題回報。'));
  $('admin-game-issues-more').hidden = !cursor;
}
async function load(reset = false) {
  if (loading || !isAdmin()) return;
  const owner = uid(), operation = generation; loading = true;
  const status = $('admin-game-issues-status'); status.textContent = '正在讀取回報…';
  try {
    const result = await request('/api/admin/game-issues', { action: 'list', cursor: reset ? null : cursor });
    if (owner !== uid() || !isAdmin() || generation !== operation) return;
    entries = reset ? result.entries : [...entries, ...result.entries]; cursor = result.nextCursor;
    renderEntries(); status.textContent = `已載入 ${entries.length} 筆；按重新整理取得最新回報。`;
  } catch (error) { if (owner === uid() && generation === operation) status.textContent = error.message; }
  finally { if (generation === operation) loading = false; }
}
function reconcile() {
  if (account !== uid()) {
    account = uid(); generation++; loading = false; entries = []; cursor = null;
    $('game-issue-dialog')?.remove(); $('admin-game-issues')?.remove();
  }
  const trigger = $('btn-game-issue-report'); if (trigger) trigger.onclick = () => window.openGameIssueReport();
  if (!isAdmin()) { $('admin-game-issues')?.remove(); return; }
  if ($('admin-game-issues') || !$('page-admin')) return;
  addStyle();
  const panel = node('section', undefined, 'glass-panel p-4 rounded-xl mb-4'); panel.id = 'admin-game-issues';
  panel.dataset.adminSectionTitle = '玩家問題回報'; panel.dataset.adminSectionIcon = 'fa-flag';
  panel.innerHTML = '<h3>玩家問題回報</h3><p>查看玩家送出的問題與診斷，並標記處理進度。</p><button type="button" id="admin-game-issues-refresh">載入／重新整理</button><p id="admin-game-issues-status" role="status">按上方按鈕讀取，每次最多 20 筆。</p><div id="admin-game-issue-list"></div><button type="button" id="admin-game-issues-more" hidden>載入更早的回報</button>';
  $('page-admin').appendChild(panel);
  $('admin-game-issues-refresh').onclick = () => { void load(true); };
  $('admin-game-issues-more').onclick = () => { void load(); };
}
window.addEventListener('xiuxian:user-ready', reconcile);
onAuthStateChanged(getAuth(getApp()), reconcile);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reconcile, { once: true }); else reconcile();
