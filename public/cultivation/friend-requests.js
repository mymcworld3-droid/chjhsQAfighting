import { getMainUser, authenticatedMainFetch } from './data/project-repository.js';

// Persistent inbox; live hints reuse the existing invitation connection. No polling.
let owner = '', cache = null, fetchedAt = 0, loading = null, revision = 0, previousFocus;
let busy = false, needsRefresh = false;
const sending = new Map();
const $ = id => document.getElementById(id);
function resetOwner() {
  const uid = getMainUser()?.uid || '';
  if (owner !== uid) {
    owner = uid; cache = null; fetchedAt = 0; loading = null; revision++; sending.clear(); busy = false; needsRefresh = false;
    if ($('friend-requests-dialog')) $('friend-requests-dialog').hidden = true;
    $('friend-request-list')?.replaceChildren(); badge(false);
  }
  return uid;
}
async function request(body) {
  const uid = resetOwner();
  if (!uid) throw Error('請先登入');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('連線逾時，請稍後再試')); }, 15000);
  });
  try {
    const data = await Promise.race([(async () => {
      const response = await authenticatedMainFetch('/api/friends', { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw Error(payload.error || '好友服務暫時無法使用');
      return payload;
    })(), timeout]);
    if (getMainUser()?.uid !== uid) throw Error('登入帳號已變更');
    return data;
  } finally { clearTimeout(timer); }
}
function badge(active, count) {
  const el = $('friend-request-badge');
  if (el) { el.hidden = !active; el.textContent = count ? String(count) : '•'; }
}
function sync(data) {
  const local = window.getCurrentUserData?.();
  if (local && Array.isArray(data.friends)) {
    const changed = JSON.stringify(local.friends) !== JSON.stringify(data.friends);
    local.friends = data.friends;
    if (changed) { void window.loadFriendList?.(); void window.QAFriendChat?.start(); }
  }
  if (local && typeof data.acceptRequests === 'boolean') local.friendInvitesDisabled = !data.acceptRequests;
}
async function refresh(force = false) {
  if (!resetOwner()) return;
  if (busy) { needsRefresh = true; return cache; }
  if (loading) return loading;
  if (!force && cache && Date.now() - fetchedAt < 60000) { render(); return cache; }
  const epoch = revision;
  const job = request({ action: 'status' }).then(data => {
    if (epoch !== revision) return;
    cache = data; fetchedAt = Date.now(); sync(data); badge(data.pending.length > 0, data.pending.length); render(); return data;
  }).finally(() => { if (loading === job) loading = null; });
  loading = job;
  return job;
}
function notice(message) {
  let el = $('friend-request-notice');
  if (!el) { el = document.createElement('div'); el.id = 'friend-request-notice'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = message; el.hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { el.hidden = true; }, 4000);
}
function close() { $('friend-requests-dialog').hidden = true; previousFocus?.focus?.(); }
function beginMutation() {
  if (busy) return false;
  busy = true; revision++;
  $('friend-requests-disabled').disabled = true;
  $('friend-request-list').querySelectorAll('button').forEach(el => { el.disabled = true; });
  return true;
}
function finishMutation() {
  busy = false; render();
  if (needsRefresh) { needsRefresh = false; receive(); }
}
function modal() {
  let root = $('friend-requests-dialog');
  if (root) return root;
  root = document.createElement('div'); root.id = 'friend-requests-dialog'; root.hidden = true;
  root.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="friend-request-title" tabindex="-1"><header><h2 id="friend-request-title">好友邀請</h2><button type="button" data-close aria-label="關閉好友邀請">✕</button></header><label class="friend-request-setting"><input type="checkbox" id="friend-requests-disabled"> 不再接受新的好友邀請</label><p class="friend-request-help">關閉後，既有好友不受影響；待處理邀請仍可回覆。邀請保留 7 天。</p><p id="friend-request-message" role="status"></p><div id="friend-request-list"></div></section>`;
  document.body.appendChild(root);
  root.querySelector('[data-close]').addEventListener('click', close);
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  $('friend-requests-disabled').addEventListener('change', async event => {
    const input = event.target;
    if (!beginMutation()) return;
    try { const data = await request({ action: 'preferences', acceptRequests: !input.checked }); if (cache) cache.acceptRequests = data.acceptRequests; sync(data); }
    catch (error) { input.checked = cache ? !cache.acceptRequests : !input.checked; $('friend-request-message').textContent = error.message; }
    finally { finishMutation(); }
  });
  return root;
}
function render() {
  const root = $('friend-requests-dialog');
  if (!root || root.hidden || !cache) return;
  $('friend-requests-disabled').checked = !cache.acceptRequests;
  $('friend-requests-disabled').disabled = busy;
  const list = $('friend-request-list'); list.replaceChildren();
  if (!cache.pending.length) { list.textContent = '目前沒有待處理的好友邀請'; return; }
  for (const invite of cache.pending) {
    const row = document.createElement('div'); row.className = 'friend-request-row';
    const name = document.createElement('strong'); name.textContent = invite.name || '修士'; row.appendChild(name);
    for (const [decision, label] of [['accept', '同意'], ['decline', '拒絕']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.disabled = busy;
      button.addEventListener('click', async () => {
        if (!beginMutation()) return;
        try {
          const data = await request({ action: 'respond', requestId: invite.id, decision });
          cache = { ...cache, ...data }; sync(data); badge(data.pending.length > 0, data.pending.length); render();
          $('friend-request-message').textContent = data.decision === 'accept' ? '已成為好友' : '已拒絕邀請';
        } catch (error) { $('friend-request-message').textContent = error.message; }
        finally { finishMutation(); }
      });
      row.appendChild(button);
    }
    list.appendChild(row);
  }
}
async function open() {
  const root = modal(); resetOwner(); previousFocus = document.activeElement; root.hidden = false;
  root.querySelector('[data-close]').focus(); $('friend-request-message').textContent = '正在讀取邀請…';
  $('friend-requests-disabled').disabled = true;
  try { await refresh(true); $('friend-request-message').textContent = ''; }
  catch (error) { $('friend-request-message').textContent = error.message; }
}
function send(fields) {
  resetOwner();
  const key = fields.peerUid || fields.friendCode;
  if (sending.has(key)) return sending.get(key);
  const job = request({ action: 'send', ...fields }).then(data => {
    notice(data.alreadyFriends ? '你們已經是好友' : data.alreadyPending ? '已發送過邀請，等待對方同意' : '好友邀請已送出，等待對方同意');
    return true;
  }).catch(error => { notice(error.message); return false; }).finally(() => { if (sending.get(key) === job) sending.delete(key); });
  sending.set(key, job); return job;
}
function receive() {
  fetchedAt = 0; badge(true);
  // A hint can arrive during a status read: refresh again after that read completes.
  const active = loading;
  void Promise.resolve(active).catch(() => {}).then(() => refresh(true)).catch(error => console.warn('[Friends]', error.message));
}
window.QAFriendRequests = { open, send: uid => send({ peerUid: uid }), sendCode: code => send({ friendCode: code }), receive,
  reset: resetOwner,
  repaint: () => badge(Boolean(cache?.pending.length), cache?.pending.length) };
document.addEventListener('click', event => {
  if (event.target.closest?.('[data-friend-requests-open]')) void open();
});
const start = () => { if (getMainUser() && window.getCurrentUserData?.()?.friendCode) void refresh().catch(error => console.warn('[Friends]', error.message)); };
window.addEventListener('xiuxian:user-data-ready', start);
window.addEventListener('xiuxian:friend-request', receive);
document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'styles/friend-requests.css'; document.head.appendChild(style);
start();
