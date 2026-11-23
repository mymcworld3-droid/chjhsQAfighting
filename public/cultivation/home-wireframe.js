// Artwork homepage. Data comes from the existing account and quest services.
import { getMainUser } from './data/project-repository.js';
const $ = id => document.getElementById(id);
let initialized = false;
function visible() { return $('page-home')?.classList.contains('active-page') === true; }
function put(id, value) {
  const el = $(id), text = String(value);
  if (el && el.textContent !== text) el.textContent = text;
}
const count = value => Math.max(0, Math.floor(Number(value) || 0));
function update() {
  const uid = getMainUser()?.uid || '';
  const raw = window.getCurrentUserData?.();
  const player = uid && raw && (!raw.uid || raw.uid === uid) ? raw : null;
  const stats = player?.stats || {};
  if (!player && $('home-avatar-container')) $('home-avatar-container').replaceChildren();
  put('home-art-name', player?.displayName || '青雲修士');
  put('home-art-gold', player ? count(stats.gold).toLocaleString('zh-TW') : '—');
  const realm = $('xiuxian-realm')?.textContent?.trim() || '凡人';
  const sub = $('xiuxian-sub')?.textContent?.trim() || '初入仙途';
  put('home-art-realm', player ? realm + ' · ' + sub : '初入仙途');
  const power = player ? window.getCombatPower?.() : null;
  put('home-art-power', power ? count(power.total).toLocaleString('zh-TW') : '—');
  $('home-art-power')?.setAttribute('title', power?.complete === false ? '功法同步中，暫顯示基礎戰力' : '目前裝備的戰力');
  const avatar = $('home-avatar-container'), slot = $('home-art-avatar-slot');
  if (avatar && slot && avatar.parentNode !== slot) slot.append(avatar);
  syncAlerts();
}
function forward(id) {
  if ($(id)) { $(id).click(); return; }
  window.showToast?.('這項功能尚未開啟。');
}
function activate(action) {
  switch (action) {
    case 'quest': return forward('quest-open');
    case 'meditation': return window.openDailyMeditation?.();
    case 'rank': window.switchToPage?.('page-rank'); window.loadLeaderboard?.(); return;
    case 'settings': return window.switchToPage?.('page-settings');
    case 'store': window.loadStoreItems?.(); window.switchToPage?.('page-store'); return;
    case 'training': {
      const nav = $('nav-training');
      if (nav) nav.click();
      else window.showToast?.('修行功能將隨境界開放。');
      return;
    }
    case 'gameplay': return window.switchToPage?.('page-gameplay');
    case 'social': return window.switchToPage?.('page-social');
    case 'mail': return openMail();
    case 'gold': return forward('quest-open');
  }
}
function alertFor(action, active) {
  const dot = document.querySelector('[data-home-alert="' + action + '"]');
  if (dot) dot.hidden = !active;
}
function shown(id) {
  const el = $(id);
  return !!el && !el.hidden && !el.classList.contains('hidden');
}
function syncAlerts() {
  const signedIn = !!getMainUser()?.uid;
  alertFor('quest', signedIn && shown('quest-ready-dot'));
  alertFor('meditation', signedIn && shown('meditation-pending-dot'));
  alertFor('mail', signedIn && (shown('friend-request-badge') || shown('alliance-chat-nav-unread')));
  // Rank and settings have no pending-action source; their dots stay hidden.
}
function openMail() {
  let dialog = $('home-art-mail');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'home-art-mail'; dialog.className = 'home-art-mail';
    dialog.setAttribute('aria-labelledby', 'home-art-mail-title');
    dialog.innerHTML = '<header><h2 id="home-art-mail-title">信件</h2><button type="button" data-close aria-label="關閉信件">×</button></header><button type="button" data-invites>好友邀請</button><button type="button" data-friends>好友訊息</button>';
    document.body.append(dialog);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => document.querySelector('[data-home-action="mail"]')?.focus());
    dialog.querySelector('[data-invites]').addEventListener('click', () => {
      dialog.close(); window.QAFriendRequests?.open();
    });
    dialog.querySelector('[data-friends]').addEventListener('click', () => {
      dialog.close(); window.switchToPage?.('page-social');
      $('tab-btn-friends')?.click();
    });
  }
  if (!dialog.open) dialog.showModal();
}
function init() {
  if (initialized || !document.querySelector('.home-art-scene')) return;
  initialized = true;
  const root = $('page-home');
  root.addEventListener('click', e => {
    const button = e.target.closest?.('[data-home-action]');
    if (button && root.contains(button)) activate(button.dataset.homeAction);
  });
  for (const name of ['xiuxian:user-data-ready', 'xiuxian:user-ready', 'xiuxian:stats-updated',
    'xiuxian:tactical-power-updated', 'material-system-updated', 'xiuxian:features-ready'])
    window.addEventListener(name, update);
  // Realm markup and badges are owned by existing services. Mirror changes
  // after their render cycle, without adding network requests or polling.
  let queued = false;
  new MutationObserver(records => {
    if (!records.some(r => r.target.closest?.('#xiuxian-panel, #friend-request-badge, #alliance-chat-nav-unread, #quest-ready-dot, #meditation-pending-dot'))) return;
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; update(); }); }
  }).observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  new MutationObserver(() => { if (visible()) update(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  update();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
