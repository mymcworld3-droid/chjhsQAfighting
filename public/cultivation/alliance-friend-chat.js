import { collection, query, orderBy, limit, onSnapshot } from '../data-store.js';
import { getProjectServices, getMainUser, authenticatedMainFetch } from './data/project-repository.js';

const state = {
  uid: '', conversations: new Map(), peer: '', messages: [], lastMessageId: '',
  timer: null, polling: false, loading: false, sending: false,
  friendCount: null, friendSignature: '', failures: 0, retryAt: 0,
  globalUnsub: null, globalListenGeneration: 0, globalLatest: '', globalUnread: false
};
const $ = id => document.getElementById(id);
const currentUid = () => getMainUser()?.uid || '';
const validUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
function showBadge(id, active, count) {
  const el = $(id);
  if (!el) return;
  el.hidden = !active;
  if (count != null) el.textContent = count > 99 ? '99+' : String(count || '');
}
function updateBadges() {
  const total = [...state.conversations.values()].reduce((sum, x) => sum + (x.unread || 0), 0);
  showBadge('alliance-chat-nav-unread', total > 0);
  showBadge('alliance-chat-title-unread', total > 0, total);
  showBadge('alliance-friend-unread', total > 0, total);
  showBadge('alliance-global-unread', state.globalUnread); // NEVER light navigation for global chat.
  document.querySelectorAll('[data-friend-chat-unread]').forEach(el => {
    const count = state.conversations.get(el.dataset.friendChatUnread)?.unread || 0;
    el.hidden = !count; el.textContent = count > 99 ? '99+' : String(count || '');
  });
}
function ensureModal() {
  if (!$('alliance-chat-css')) {
    const css = document.createElement('link');
    css.id = 'alliance-chat-css'; css.rel = 'stylesheet'; css.href = '/styles/alliance-chat.css';
    document.head.append(css);
  }
  if ($('alliance-chat-layer')) return;
  const root = document.createElement('div');
  root.id = 'alliance-chat-layer'; root.hidden = true;
  root.innerHTML = `<section class="alliance-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="alliance-chat-title">
    <header class="alliance-chat-header"><div><small>仙盟 · 好友私訊</small><h3 id="alliance-chat-title">道友</h3></div>
      <button type="button" id="alliance-chat-close" aria-label="關閉私訊">×</button></header>
    <div id="alliance-chat-messages" class="alliance-chat-messages" role="log" aria-live="polite"></div>
    <p id="alliance-chat-error" class="alliance-chat-error" hidden role="alert"></p>
    <form id="alliance-chat-form" class="alliance-chat-form">
      <input id="alliance-chat-input" placeholder="傳送訊息給好友…" autocomplete="off" maxlength="400" required aria-label="私訊內容">
      <button id="alliance-chat-send" type="submit" aria-label="傳送">➤</button>
    </form><small class="alliance-chat-footnote">僅雙方好友可閱讀 · 顯示最近 60 則</small>
  </section>`;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  root.querySelector('#alliance-chat-close').addEventListener('click', close);
  root.querySelector('#alliance-chat-form').addEventListener('submit', send);
  document.body.append(root);
}
function reportError(message = '') {
  const node = $('alliance-chat-error');
  if (!node) return;
  node.hidden = !message; node.textContent = message;
}
async function request(action, payload = {}) {
  const response = await authenticatedMainFetch('/api/alliance-chat/' + action, {
    method: 'POST', body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw Error(data.error || '私訊服務暫時無法使用');
  return data;
}
function render() {
  const list = $('alliance-chat-messages');
  if (!list) return;
  list.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'alliance-chat-empty'; empty.textContent = '還沒有訊息，先向好友打聲招呼吧。';
    list.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of state.messages) {
    const bubble = document.createElement('div');
    bubble.className = 'alliance-chat-bubble' + (item.senderUid === state.uid ? ' mine' : '');
    const text = document.createElement('p');
    text.textContent = item.text || ''; // Message content is NEVER HTML.
    const time = document.createElement('time');
    time.textContent = item.sentAt ? new Date(item.sentAt).toLocaleTimeString('zh-TW', {
      hour: '2-digit', minute: '2-digit'
    }) : '';
    bubble.append(text, time); fragment.append(bubble);
  }
  list.append(fragment); list.scrollTop = list.scrollHeight;
}
function close() {
  if ($('alliance-chat-layer')) $('alliance-chat-layer').hidden = true;
  state.peer = ''; state.messages = []; state.lastMessageId = '';
  reportError();
}
async function loadThread() {
  const uid = state.uid, peerUid = state.peer;
  if (!uid || !peerUid || currentUid() !== uid || state.loading) return;
  state.loading = true;
  try {
    const data = await request('thread', { peerUid });
    if (state.uid !== uid || state.peer !== peerUid || currentUid() !== uid) return;
    state.messages = data.messages || [];
    state.lastMessageId = data.lastMessageId || '';
    $('alliance-chat-title').textContent = data.peerName || '道友';
    render(); reportError();
    if (state.lastMessageId) {
      const seen = await request('read', { peerUid, lastMessageId: state.lastMessageId });
      if (seen.cleared && state.peer === peerUid && state.uid === uid) {
        const row = state.conversations.get(peerUid);
        if (row) row.unread = 0;
        updateBadges();
      }
    }
  } catch (error) { reportError(error.message); }
  finally { state.loading = false; }
}
function open(peerUid, name) {
  if (!validUid(peerUid) || !currentUid() || peerUid === currentUid()) return;
  ensureModal(); state.peer = peerUid; state.messages = []; state.lastMessageId = '';
  $('alliance-chat-title').textContent = String(name || state.conversations.get(peerUid)?.name || '道友').slice(0, 35);
  $('alliance-chat-layer').hidden = false;
  render(); reportError();
  $('alliance-chat-input').focus();
  void loadThread();
  void poll({ force: true });
}
async function send(event) {
  event.preventDefault();
  const input = $('alliance-chat-input'), sendButton = $('alliance-chat-send');
  const text = String(input.value || '').trim(), uid = state.uid, peer = state.peer;
  if (!text || !uid || !peer || currentUid() !== uid || state.sending) return;
  state.sending = true; sendButton.disabled = true;
  try {
    await request('send', { peerUid: peer, text });
    if (state.uid === uid && state.peer === peer) {
      input.value = ''; await loadThread(); await poll();
    }
  } catch (error) { reportError(error.message); }
  finally { state.sending = false; sendButton.disabled = false; }
}
function stopGlobalListener() {
  state.globalListenGeneration++;
  if (state.globalUnsub) { state.globalUnsub(); state.globalUnsub = null; }
}
function reset(uid) {
  close(); state.uid = uid; state.conversations.clear();
  state.friendCount = null; state.friendSignature = ''; state.failures = 0; state.retryAt = 0;
  stopGlobalListener();
  state.globalLatest = ''; state.globalUnread = false; updateBadges();
}
async function poll({ force = false } = {}) {
  const uid = currentUid();
  if (!uid) { if (state.uid) reset(''); return; }
  if (uid !== state.uid) reset(uid);
  if (state.polling || document.visibilityState === 'hidden') return;
  if (Date.now() < state.retryAt) return;
  const profile = window.getCurrentUserData?.();
  const signature = JSON.stringify(profile && (!profile.uid || profile.uid === uid) ? profile.friends || [] : []);
  // Confirm once with the server. Resume on friend changes, explicit opening,
  // social-page entry or foregrounding, including friends added on another device.
  if (!force && state.friendCount === 0 && state.friendSignature === signature) return;
  state.polling = true;
  try {
    const data = await request('inbox');
    if (uid !== currentUid()) return;
    state.friendCount = Number.isInteger(data.friendCount) ? data.friendCount : null;
    state.friendSignature = signature; state.failures = 0; state.retryAt = 0;
    state.conversations = new Map((data.conversations || [])
      .filter(row => validUid(row.peerUid)).map(row => [row.peerUid, row]));
    updateBadges();
    const active = state.conversations.get(state.peer);
    // Inbox still checks reciprocal friendship on every poll. Only reload the
    // open message history when it changed or unread messages need marking.
    if (state.peer && !state.loading && (!active || !active.lastMessageId ||
      active.lastMessageId !== state.lastMessageId || active.unread > 0)) await loadThread();
  } catch (error) {
    if (uid !== currentUid()) return;
    state.retryAt = Date.now() + Math.min(300000, 12000 * 2 ** Math.min(state.failures++, 5));
    console.warn('[Friend chat] inbox unavailable:', error.message);
  } finally { state.polling = false; }
}
const globalChatVisible = () => $('page-social')?.classList.contains('active-page') &&
  !$('section-chat')?.classList.contains('hidden');
function ackGlobalChat() {
  state.globalUnread = false;
  if (state.uid && state.globalLatest) {
    try { localStorage.setItem('xiuxian-global-chat-seen:' + state.uid, state.globalLatest); }
    catch (_) {}
  }
  updateBadges();
}
async function listenGlobal() {
  const uid = state.uid;
  if (!uid || state.globalUnsub || document.visibilityState === 'hidden') return;
  const generation = ++state.globalListenGeneration;
  try {
    const { db } = await getProjectServices('A', { authenticateSecondary: false });
    if (state.uid !== uid || generation !== state.globalListenGeneration || document.visibilityState === 'hidden') return;
    state.globalUnsub = onSnapshot(query(collection(db, 'global_chat'),
      orderBy('timestamp', 'desc'), limit(1)), snap => {
      if (uid !== state.uid || generation !== state.globalListenGeneration || document.visibilityState === 'hidden') return;
      const latest = snap.docs[0]?.id || '';
      const key = 'xiuxian-global-chat-seen:' + uid;
      let lastSeen = '';
      try { lastSeen = localStorage.getItem(key) || ''; } catch (_) {}
      if (latest && !lastSeen) {
        try { localStorage.setItem(key, latest); } catch (_) {}
        lastSeen = latest; // No false alert for messages predating first login.
      }
      state.globalLatest = latest;
      const mine = snap.docs[0]?.data()?.uid === uid;
      state.globalUnread = Boolean(latest && latest !== lastSeen && !mine && !globalChatVisible());
      if (globalChatVisible() || (mine && latest)) ackGlobalChat();
      updateBadges();
    }, err => {
      if (generation !== state.globalListenGeneration) return;
      stopGlobalListener();
      console.warn('[Friend chat] public badge unavailable', err.message);
    });
  } catch (err) { console.warn('[Friend chat] public listener unavailable', err.message); }
}
function start() {
  const uid = currentUid();
  if (!uid || !$('page-social') || document.visibilityState === 'hidden') return;
  if (uid !== state.uid) reset(uid);
  ensureModal();
  if (!state.timer) state.timer = setInterval(() => { void poll(); }, 12000);
  void poll({ force: true }); void listenGlobal();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopGlobalListener();
  } else if (state.uid) {
    void poll({ force: true });
    void listenGlobal();
  }
});
window.addEventListener('pagehide', stopGlobalListener);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('alliance-chat-layer') && !$('alliance-chat-layer').hidden) close();
});
window.addEventListener('xiuxian:user-ready', start);
window.addEventListener('xiuxian:features-ready', start);
window.QAFriendChat = Object.freeze({ start, poll, open, close, updateBadges, ackGlobalChat,
  unreadFor: peer => state.conversations.get(peer)?.unread || 0 });
if (currentUid() && $('page-social')) start();
