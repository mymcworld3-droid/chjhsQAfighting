import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, replaceArtifactCatalog, validateArtifactCatalog } from './artifact-catalog.js';

// 管理員刪除法寶：只移除全站 catalog 定義。
// 玩家背包中舊 artifact id 不硬刪，作為休眠資料保留；未來若用相同 id 重建，原持有數量可恢復顯示。
(function () {
  'use strict';

  const MODAL_ID = 'admin-artifact-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  let deleting = false;

  function playerData() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return playerData()?.isAdmin === true; }

  function ensureStyle() {
    if (document.getElementById('admin-artifact-delete-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-artifact-delete-style';
    style.textContent = `
      .aam-delete{flex:.72!important;border:1px solid rgba(248,113,113,.4)!important;background:rgba(127,29,29,.18)!important;color:#fecaca!important}
      .aam-delete:hover:not(:disabled){border-color:rgba(248,113,113,.75)!important;background:rgba(127,29,29,.3)!important}
      .aam-delete:disabled{opacity:.42!important;cursor:not-allowed!important}
      @media(max-width:620px){.aam-actions{flex-wrap:wrap}.aam-delete{flex-basis:100%!important;order:3}}
    `;
    document.head.appendChild(style);
  }

  function toast(message, ok = true) {
    document.getElementById('admin-artifact-delete-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'admin-artifact-delete-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:12100;padding:10px 15px;border-radius:999px;background:rgba(8,8,8,.97);border:1px solid ${ok ? 'rgba(216,177,93,.55)' : 'rgba(248,113,113,.55)'};color:${ok ? '#f5dfa7' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 15px 45px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function persistDeletion(itemId) {
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以刪除法寶');

    const next = ARTIFACT_CATALOG
      .filter((item) => item.id !== itemId)
      .map((item) => JSON.parse(JSON.stringify(item)));

    if (next.length === ARTIFACT_CATALOG.length) throw new Error('找不到要刪除的法寶，請重新整理。');
    if (!next.length) throw new Error('至少需要保留 1 件法寶，不能刪除最後一件法寶。');

    const normalized = validateArtifactCatalog(next);
    const db = getFirestore(getApp());
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists() || userSnap.data()?.isAdmin !== true) throw new Error('管理員權限驗證失敗');
      const configRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      tx.set(configRef, {
        version: 1,
        items: normalized,
        updatedBy: user.uid,
        updatedByName: playerData()?.displayName || user.displayName || '管理員',
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now()
      }, { merge: true });
    });

    replaceArtifactCatalog(normalized, 'admin-delete');
    return normalized;
  }

  async function deleteFromModal(modal) {
    if (deleting || !isAdmin()) return;
    const idInput = modal.querySelector('#aam-id');
    const nameInput = modal.querySelector('#aam-name');
    const status = modal.querySelector('#aam-status');
    const button = modal.querySelector('.aam-delete');
    const save = modal.querySelector('.aam-save');
    const cancel = modal.querySelector('.aam-cancel');
    const itemId = String(idInput?.value || '').trim();
    const item = ARTIFACT_CATALOG.find((candidate) => candidate.id === itemId);
    if (!item) {
      if (status) status.textContent = '找不到要刪除的法寶，請重新整理。';
      return;
    }
    if (ARTIFACT_CATALOG.length <= 1) {
      if (status) status.textContent = '至少需要保留 1 件法寶，不能刪除最後一件法寶。';
      return;
    }

    const displayName = String(nameInput?.value || item.name || itemId).trim() || itemId;
    const confirmed = window.confirm(`確定要刪除法寶「${displayName}」嗎？\n\n刪除後會立即從全站法寶清單、煉器室與可用效果中移除。玩家舊背包中的法寶 ID 會保留為休眠資料，若之後用相同 ID 重建，可恢復原持有數量。`);
    if (!confirmed) return;

    deleting = true;
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 刪除中…'; }
    if (save) save.disabled = true;
    if (cancel) cancel.disabled = true;
    if (status) status.textContent = '正在驗證管理員權限並刪除全站法寶設定…';

    try {
      await persistDeletion(itemId);
      modal.remove();
      toast(`已刪除法寶：${displayName}`);
    } catch (error) {
      console.error('[Admin artifact delete]', error);
      if (status) status.textContent = error.message || '法寶刪除失敗';
      toast(error.message || '法寶刪除失敗', false);
      if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-trash"></i> 刪除法寶'; }
      if (save) save.disabled = false;
      if (cancel) cancel.disabled = false;
    } finally {
      deleting = false;
    }
  }

  function enhanceModal(modal) {
    if (!modal || modal.dataset.artifactDeleteReady === '1' || !isAdmin()) return;
    const idInput = modal.querySelector('#aam-id');
    const actions = modal.querySelector('.aam-actions');
    if (!idInput || !actions || !idInput.readOnly) return;
    const itemId = String(idInput.value || '').trim();
    if (!ARTIFACT_CATALOG.some((item) => item.id === itemId)) return;

    ensureStyle();
    modal.dataset.artifactDeleteReady = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aam-delete';
    button.innerHTML = '<i class="fa-solid fa-trash"></i> 刪除法寶';
    button.title = '從全站法寶清單移除此法寶';
    if (ARTIFACT_CATALOG.length <= 1) {
      button.disabled = true;
      button.title = '至少需要保留 1 件法寶';
    }
    button.onclick = () => deleteFromModal(modal);
    actions.appendChild(button);
  }

  function scan() {
    enhanceModal(document.getElementById(MODAL_ID));
  }

  function boot() {
    ensureStyle();
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('artifact-catalog-updated', scan);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
