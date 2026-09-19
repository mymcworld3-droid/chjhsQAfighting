import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  deleteUser
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 帳號刪除屬於登入核心能力，不依賴修仙附加模組。
// 流程：二次確認 -> Google 重新驗證 -> 清除玩家自有資料 -> 刪除 users/{uid} -> 刪除 Firebase Auth。
(function () {
  'use strict';

  const BUTTON_ID = 'delete-account-btn';
  let deleting = false;

  function auth() { return getAuth(getApp()); }
  function db() { return getFirestore(getApp()); }

  function confirmDialog(message) {
    if (typeof window.openConfirm === 'function') return window.openConfirm(message);
    return Promise.resolve(window.confirm(message));
  }

  function setButtonState(button, busy, text = '') {
    if (!button) return;
    button.disabled = !!busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (text) button.innerHTML = text;
  }

  async function collectQueryRefs(database, collectionName, field, value, warnings) {
    try {
      const snap = await getDocs(query(collection(database, collectionName), where(field, '==', value)));
      return snap.docs.map((entry) => entry.ref);
    } catch (error) {
      warnings.push(`${collectionName}: ${error?.code || error?.message || 'cleanup failed'}`);
      console.warn(`[Account Delete] optional cleanup skipped for ${collectionName}`, error);
      return [];
    }
  }

  async function deleteRefs(database, refs, warnings, label = 'owned-data') {
    const unique = [];
    const seen = new Set();
    refs.forEach((ref) => {
      if (!ref?.path || seen.has(ref.path)) return;
      seen.add(ref.path);
      unique.push(ref);
    });

    for (let start = 0; start < unique.length; start += 400) {
      const slice = unique.slice(start, start + 400);
      try {
        const batch = writeBatch(database);
        slice.forEach((ref) => batch.delete(ref));
        await batch.commit();
      } catch (error) {
        warnings.push(`${label}: ${error?.code || error?.message || 'cleanup failed'}`);
        console.warn(`[Account Delete] optional cleanup batch skipped for ${label}`, error);
      }
    }
  }

  async function cleanupOwnedData(database, uid) {
    const warnings = [];

    const ownedDongtianRefs = await collectQueryRefs(database, 'dongtians', 'ownerUid', uid, warnings);
    const ownedDongtianIds = ownedDongtianRefs.map((ref) => ref.id);

    const baseGroups = await Promise.all([
      collectQueryRefs(database, 'dongtianIndex', 'ownerUid', uid, warnings),
      collectQueryRefs(database, 'worldImmortals', 'uid', uid, warnings),
      collectQueryRefs(database, 'global_chat', 'uid', uid, warnings),
      collectQueryRefs(database, 'dongtianPlays', 'uid', uid, warnings),
      collectQueryRefs(database, 'dongtianReports', 'reporterUid', uid, warnings)
    ]);

    const cascadeGroups = [];
    for (const dongtianId of ownedDongtianIds) {
      const [plays, reports] = await Promise.all([
        collectQueryRefs(database, 'dongtianPlays', 'dongtianId', dongtianId, warnings),
        collectQueryRefs(database, 'dongtianReports', 'dongtianId', dongtianId, warnings)
      ]);
      cascadeGroups.push(plays, reports);
    }

    await deleteRefs(
      database,
      [...ownedDongtianRefs, ...baseGroups.flat(), ...cascadeGroups.flat()],
      warnings,
      'player-owned-content'
    );

    return warnings;
  }

  async function permanentlyDeleteAccount(button) {
    if (deleting) return;
    const user = auth().currentUser;
    if (!user) {
      window.alert?.('目前沒有登入中的帳號。');
      return;
    }

    const first = await confirmDialog(
      '確定要永久刪除帳號嗎？\n\n角色、修為、背包、裝備與已建立內容將被刪除，而且無法復原。'
    );
    if (!first) return;

    const second = await confirmDialog(
      '最後確認：刪除後無法復原。\n\n系統會要求你再次用 Google 驗證身分。確定永久刪除？'
    );
    if (!second) return;

    deleting = true;
    const originalHtml = button?.innerHTML || '<i class="fa-solid fa-user-xmark mr-2"></i> 刪除帳號';
    setButtonState(button, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 驗證身分中...');

    try {
      // 主動重新驗證，避免最後 deleteUser 因 requires-recent-login 造成半刪除。
      await reauthenticateWithPopup(user, new GoogleAuthProvider());

      const database = db();
      setButtonState(button, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 清除角色資料中...');
      const warnings = await cleanupOwnedData(database, user.uid);

      // canonical 玩家文件必須成功刪除；失敗時不繼續刪 Auth，避免失去修復機會。
      await deleteDoc(doc(database, 'users', user.uid));

      setButtonState(button, true, '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 刪除登入帳號中...');
      await deleteUser(user);

      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}

      window.dispatchEvent(new CustomEvent('account-permanently-deleted', {
        detail: { cleanupWarnings: warnings.slice() }
      }));

      if (warnings.length) {
        console.warn('[Account Delete] account removed with optional cleanup warnings', warnings);
      }
      window.alert?.('帳號已永久刪除。');
    } catch (error) {
      console.error('[Account Delete]', error);
      let message = '刪除帳號失敗，帳號尚未完整刪除。';
      if (error?.code === 'auth/popup-closed-by-user') message = '已取消身分驗證，帳號沒有刪除。';
      else if (error?.code === 'auth/popup-blocked') message = '瀏覽器阻擋了 Google 驗證視窗，請允許彈出視窗後再試。';
      else if (error?.code === 'auth/requires-recent-login') message = '登入驗證已過期，請重新登入後再刪除帳號。';
      else if (error?.message) message += `\n\n${error.message}`;
      window.alert?.(message);
    } finally {
      deleting = false;
      if (auth().currentUser) setButtonState(button, false, originalHtml);
    }
  }

  function ensureDeleteButton() {
    if (document.getElementById(BUTTON_ID)) return true;
    const logoutButton = document.querySelector('button[onclick="logout()"]');
    if (!logoutButton) return false;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'w-full py-3 rounded-xl border border-red-500/70 text-red-300 hover:bg-red-950/40 transition text-xs font-bold tracking-widest';
    button.style.marginTop = '8px';
    button.innerHTML = '<i class="fa-solid fa-user-xmark mr-2"></i> 刪除帳號';
    button.title = '永久刪除 Firebase 帳號與玩家資料';
    button.addEventListener('click', () => permanentlyDeleteAccount(button));
    logoutButton.insertAdjacentElement('afterend', button);
    return true;
  }

  function boot() {
    ensureDeleteButton();
    if (!document.body) return;
    const observer = new MutationObserver(() => {
      if (ensureDeleteButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.deleteAccountPermanently = () => {
    const button = document.getElementById(BUTTON_ID);
    return permanentlyDeleteAccount(button);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
