import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, doc, updateDoc, collection, query, where, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';

  const ADMIN_TITLE = '《九州》';
  const RESERVED_RE = /《?\s*九州\s*》?/g;
  const NAME_REVIEW_TIMEOUT_MS = 12000;
  const auth = getAuth(getApp());
  const db = getFirestore(getApp());
  let syncing = false;
  let baseSaveProfile = null;
  let propagatedKey = '';
  let saveBusy = false;

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
      // MutationObserver 會監聽這個節點；只有名稱真的改變時才碰 DOM，
      // 避免「observer -> innerHTML -> observer」無限迴圈造成整頁卡死。
      if (userInfo.dataset.gameDisplayName !== name) {
        userInfo.dataset.gameDisplayName = name;
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-user-astronaut';
        userInfo.replaceChildren(icon, document.createTextNode(` ${name}`));
      }
    }
    document.querySelectorAll('[data-self-player-name]').forEach((node) => {
      if (node.textContent !== name) node.textContent = name;
    });
  }

  async function propagateNameSnapshots(force = false) {
    const user = auth.currentUser;
    const player = data();
    if (!user || !player) return;
    const name = window.getPlayerDisplayName(player);
    const key = `${user.uid}|${name}`;
    if (!force && propagatedKey === key) return;

    try {
      const [indexSnap, dataSnap, immortalSnap] = await Promise.all([
        getDocs(query(collection(db, 'dongtianIndex'), where('ownerUid', '==', user.uid))),
        getDocs(query(collection(db, 'dongtians'), where('ownerUid', '==', user.uid))),
        getDocs(query(collection(db, 'worldImmortals'), where('uid', '==', user.uid)))
      ]);
      const refs = [
        ...indexSnap.docs.map((entry) => entry.ref),
        ...dataSnap.docs.map((entry) => entry.ref),
        ...immortalSnap.docs.map((entry) => entry.ref)
      ];
      for (let start = 0; start < refs.length; start += 450) {
        const batch = writeBatch(db);
        refs.slice(start, start + 450).forEach((ref) => batch.update(ref, ref.parent.id === 'worldImmortals' ? { displayName: name } : { ownerName: name }));
        await batch.commit();
      }
      propagatedKey = key;
      window.dispatchEvent(new CustomEvent('player-name-snapshots-updated', { detail: { displayName: name } }));
    } catch (error) {
      // Snapshot propagation is best-effort. The canonical users/{uid}.displayName remains the source of truth.
      console.warn('[Identity] failed to propagate saved name snapshots', error);
    }
  }

  function queueSnapshotPropagation(force = false) {
    // 舊洞天／五仙名稱只是快照，不得阻塞玩家改名主流程。
    Promise.resolve().then(() => propagateNameSnapshots(force)).catch((error) => {
      console.warn('[Identity] background snapshot propagation failed', error);
    });
  }

  async function normalizeStoredIdentity() {
    const player = data();
    const user = auth.currentUser;
    if (!player || !user || syncing) return;
    const desired = publicName(player.displayName || user.displayName || '無名修士', isAdmin(player));
    if (player.displayName === desired) {
      syncVisibleName();
      queueSnapshotPropagation(false);
      return;
    }
    syncing = true;
    try {
      await updateDoc(doc(db, 'users', user.uid), { displayName: desired });
      player.displayName = desired;
      syncVisibleName();
      queueSnapshotPropagation(true);
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NAME_REVIEW_TIMEOUT_MS);
    try {
      const response = await fetch('/api/review-player-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: base }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.approved !== true) throw new Error(payload.error || payload.reason || '名稱未通過 AI 審核。');
      return stripReserved(payload.normalizedName || base);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('名稱 AI 審核逾時，請再試一次。');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  window.updatePlayerDisplayName = async function (rawName) {
    const player = data();
    const user = auth.currentUser;
    if (!player || !user) throw new Error('尚未載入玩家資料。');
    if (saveBusy) throw new Error('名稱正在儲存，請稍候。');
    const requested = String(rawName || '').trim();
    if (!isAdmin(player) && /九州/.test(requested)) throw new Error('「九州」為管理員專屬稱號。');

    saveBusy = true;
    try {
      const approvedBase = await reviewBaseName(requested);
      const approvedName = publicName(approvedBase, isAdmin(player));
      await updateDoc(doc(db, 'users', user.uid), { displayName: approvedName });
      player.displayName = approvedName;
      syncVisibleName();
      window.dispatchEvent(new CustomEvent('player-name-updated', { detail: { displayName: approvedName } }));
      queueSnapshotPropagation(true);
      return approvedName;
    } finally {
      saveBusy = false;
    }
  };

  function installSaveProfileGuard() {
    if (baseSaveProfile || typeof window.saveProfile !== 'function') return;
    baseSaveProfile = window.saveProfile;
    window.saveProfile = async function (...args) {
      const input = document.getElementById('set-display-name');
      const player = data();
      if (!input || !player) return baseSaveProfile.apply(this, args);
      if (saveBusy) return;

      const requested = input.value.trim();
      if (!isAdmin(player) && /九州/.test(requested)) {
        alert('「九州」為管理員專屬稱號，其他修士不能使用。');
        return;
      }

      const oldText = input.value;
      saveBusy = true;
      try {
        const approvedBase = await reviewBaseName(requested);
        const approvedName = publicName(approvedBase, isAdmin(player));
        input.value = approvedName;

        // canonical users/{uid}.displayName 與其餘設定先完成儲存；成功後 UI 立即更新。
        await baseSaveProfile.apply(this, args);
        player.displayName = approvedName;
        input.value = approvedName;
        syncVisibleName();
        window.dispatchEvent(new CustomEvent('player-name-updated', { detail: { displayName: approvedName } }));

        // 洞天／五仙舊快照在背景同步，失敗或資料很多都不能拖住改名介面。
        queueSnapshotPropagation(true);
      } catch (error) {
        input.value = oldText;
        alert(error.message || '名稱審核失敗，請稍後再試。');
      } finally {
        saveBusy = false;
      }
    };
  }

  function boot() {
    installSaveProfileGuard();
    normalizeStoredIdentity();
    syncVisibleName();
    const target = document.getElementById('user-info');
    if (target) {
      new MutationObserver(() => syncVisibleName()).observe(target, { childList: true, subtree: true, characterData: true });
    }
    window.addEventListener('focus', syncVisibleName);
    window.addEventListener('xiuxian:user-ready', () => { installSaveProfileGuard(); normalizeStoredIdentity(); syncVisibleName(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
