import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';

  const ADMIN_TITLE = '《九州》';
  const RESERVED_RE = /《?\s*九州\s*》?/g;
  const auth = getAuth(getApp());
  const db = getFirestore(getApp());
  let syncing = false;
  let baseSaveProfile = null;

  function data() { return window.getCurrentUserData?.() || null; }
  function isAdmin(player = data()) { return player?.isAdmin === true; }
  function stripReserved(value) {
    return String(value || '').replace(RESERVED_RE, '').replace(/\s+/g, ' ').trim();
  }
  function publicName(value, admin = false) {
    const base = stripReserved(value) || '無名修士';
    return admin ? `${ADMIN_TITLE}${base}` : base;
  }

  window.getPlayerDisplayName = function (player = data(), fallback = '無名修士') {
    if (!player) return fallback;
    const raw = player.displayName || player.name || fallback;
    return publicName(raw, player.isAdmin === true);
  };
  window.formatPublicPlayerName = (name, admin = false) => publicName(name, admin === true);
  window.stripReservedPlayerTitle = stripReserved;

  function syncVisibleName() {
    const player = data();
    if (!player) return;
    const name = window.getPlayerDisplayName(player);
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
      userInfo.removeAttribute('data-i18n');
      userInfo.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${name}`;
    }
    document.querySelectorAll('[data-self-player-name]').forEach((node) => { node.textContent = name; });
  }

  async function normalizeStoredIdentity() {
    const player = data();
    const user = auth.currentUser;
    if (!player || !user || syncing) return;
    const desired = publicName(player.displayName || user.displayName || '無名修士', isAdmin(player));
    if (player.displayName === desired) { syncVisibleName(); return; }
    syncing = true;
    try {
      await updateDoc(doc(db, 'users', user.uid), { displayName: desired });
      player.displayName = desired;
      syncVisibleName();
      window.dispatchEvent(new CustomEvent('player-name-updated', { detail: { displayName: desired } }));
    } catch (error) {
      console.warn('[Identity] failed to normalize stored name', error);
    } finally {
      syncing = false;
    }
  }

  async function reviewBaseName(rawName) {
    const base = stripReserved(rawName);
    if (base.length < 2) throw new Error('名稱至少需要 2 個字元。');
    if (base.length > 24) throw new Error('名稱最多 24 個字元。');
    const response = await fetch('/api/review-player-name', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: base })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.approved !== true) throw new Error(payload.error || payload.reason || '名稱未通過 AI 審核。');
    return stripReserved(payload.normalizedName || base);
  }

  function installSaveProfileGuard() {
    if (baseSaveProfile || typeof window.saveProfile !== 'function') return;
    baseSaveProfile = window.saveProfile;
    window.saveProfile = async function (...args) {
      const input = document.getElementById('set-display-name');
      const player = data();
      if (!input || !player) return baseSaveProfile.apply(this, args);
      const requested = input.value.trim();
      if (!isAdmin(player) && /九州/.test(requested)) {
        alert('「九州」為管理員專屬稱號，其他修士不能使用。');
        return;
      }
      const oldText = input.value;
      try {
        const approvedBase = await reviewBaseName(requested);
        input.value = publicName(approvedBase, isAdmin(player));
        await baseSaveProfile.apply(this, args);
        player.displayName = input.value;
        syncVisibleName();
        window.dispatchEvent(new CustomEvent('player-name-updated', { detail: { displayName: player.displayName } }));
      } catch (error) {
        input.value = oldText;
        alert(error.message || '名稱審核失敗，請稍後再試。');
      }
    };
  }

  function boot() {
    installSaveProfileGuard();
    normalizeStoredIdentity();
    syncVisibleName();
    const target = document.getElementById('user-info');
    if (target) new MutationObserver(syncVisibleName).observe(target, { childList: true, subtree: true, characterData: true });
    window.addEventListener('focus', syncVisibleName);
    window.addEventListener('xiuxian:user-ready', () => { installSaveProfileGuard(); normalizeStoredIdentity(); syncVisibleName(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
