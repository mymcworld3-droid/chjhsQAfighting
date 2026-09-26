import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  ARTIFACT_CATALOG,
  replaceArtifactCatalog,
  validateArtifactCatalog
} from './artifact-catalog.js';
import {
  validateArtifactRecipes,
  replaceArtifactRecipes
} from './material-catalog.js';
import { REFINERY_JOB_FIELD } from './refinery-economy.js';

// 管理員徹底刪除法寶：高權限掃描、玩家清理、補償與目錄更新全部交由後端 Admin SDK。
// 瀏覽器不再列出全站 users，也不再直接修改其他玩家文件，避免 Firestore Rules 阻擋。
(function () {
  'use strict';

  const MODAL_ID = 'admin-artifact-modal';
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
    setTimeout(() => el.remove(), 3400);
  }

  async function requestArtifactDeletion(action, itemId) {
    const user = getAuth(getApp()).currentUser;
    if (!user) throw new Error('請先登入管理員帳號。');
    if (!isAdmin()) throw new Error('僅管理員可以刪除法寶。');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/admin/artifacts/delete', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + idToken
      },
      body: JSON.stringify({ action, itemId })
    });
    const raw = await response.text().catch(() => '');
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok || payload?.ok !== true) {
      const message = String(payload?.error || raw || '').trim().slice(0, 420);
      const error = new Error(message || ('法寶刪除服務失敗 (' + response.status + ')'));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function applyLocalResult(payload) {
    const items = validateArtifactCatalog(payload?.items || []);
    const recipes = validateArtifactRecipes(payload?.recipes || {});
    if (!items.length) throw new Error('伺服器回傳的法寶目錄無效，請重新整理。');

    replaceArtifactCatalog(items, 'admin-delete-api');
    replaceArtifactRecipes(recipes, 'admin-delete-api');

    const self = payload?.self;
    if (!self) return;

    const local = playerData();
    if (local) {
      local.artifactSystem = self.artifactSystem || local.artifactSystem;
      local.stats = local.stats || {};
      if (Number.isFinite(Number(self.gold))) local.stats.gold = Number(self.gold);
      if (self.refineryJobCanceled) {
        if (self.materialSystem) local.materialSystem = self.materialSystem;
        local[REFINERY_JOB_FIELD] = null;
      }
    }

    if (self.artifactSystem) {
      window.dispatchEvent(new CustomEvent('artifact-system-updated', {
        detail: self.artifactSystem
      }));
    }
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
      detail: {
        source: 'artifact-delete-compensation',
        gold: Number(self.gold) || 0,
        artifactDeleted: payload.deletedArtifactId,
        compensationGold: Number(self.compensationGold) || 0
      }
    }));
    if (self.refineryJobCanceled) {
      if (self.materialSystem) {
        window.dispatchEvent(new CustomEvent('material-system-updated', {
          detail: self.materialSystem
        }));
      }
      window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));
    }
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
    const item = ARTIFACT_CATALOG.find(candidate => candidate.id === itemId);

    if (!item) {
      if (status) status.textContent = '找不到要刪除的法寶，請重新整理。';
      return;
    }
    if (ARTIFACT_CATALOG.length <= 1) {
      if (status) status.textContent = '至少需要保留 1 件法寶，不能刪除最後一件法寶。';
      return;
    }

    deleting = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 掃描影響…';
    }
    if (save) save.disabled = true;
    if (cancel) cancel.disabled = true;
    if (status) status.textContent = '正在由伺服器安全掃描持有人、配方依賴與煉器任務…';

    try {
      const previewPayload = await requestArtifactDeletion('preview', itemId);
      const plan = previewPayload.preview || {};
      const displayName = String(nameInput?.value || plan.item?.name || item.name || itemId).trim() || itemId;
      const invalidatedOtherRecipes = (Array.isArray(plan.invalidatedRecipeIds) ? plan.invalidatedRecipeIds : [])
        .filter(id => id !== itemId).length;

      const confirmed = window.confirm(
        `確定要「徹底刪除」法寶「${displayName}」嗎？\n\n` +
        `• 持有玩家：${Number(plan.affectedPlayers) || 0} 人\n` +
        `• 玩家現存數量：${Number(plan.totalHeldCopies) || 0} 件\n` +
        `• 每件補償：${(Number(plan.compensationEach) || 0).toLocaleString()} 金幣\n` +
        `• 預計補償／退款總額：${(Number(plan.totalCompensationGold) || 0).toLocaleString()} 金幣\n` +
        `• 取消相關煉器任務：${Number(plan.canceledJobs) || 0} 個\n` +
        `• 連帶取消依賴配方：${invalidatedOtherRecipes} 個\n\n` +
        '刪除後會清除玩家背包、裝備、限時效果、自己的配方與所有依賴配方；此動作不可復原。'
      );

      if (!confirmed) {
        if (status) status.textContent = '已取消刪除。';
        return;
      }

      if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 徹底刪除中…';
      if (status) status.textContent = '伺服器正在重新核對並一次提交玩家清理、補償、配方與法寶目錄…';

      const result = await requestArtifactDeletion('delete', itemId);
      applyLocalResult(result);
      modal.remove();
      toast(
        `已徹底刪除 ${displayName}；補償 ${(Number(result.summary?.totalCompensationGold) || 0).toLocaleString()} 金幣`
      );
    } catch (error) {
      console.error('[Admin artifact delete]', {
        status: Number(error?.status) || 0,
        message: String(error?.message || '法寶刪除失敗')
      });
      if (status) status.textContent = error.message || '法寶刪除失敗';
      toast(error.message || '法寶刪除失敗', false);
    } finally {
      deleting = false;
      if (document.body.contains(modal)) {
        if (button) {
          button.disabled = false;
          button.innerHTML = '<i class="fa-solid fa-trash"></i> 徹底刪除法寶';
        }
        if (save) save.disabled = false;
        if (cancel) cancel.disabled = false;
      }
    }
  }

  function enhanceModal(modal) {
    if (!modal || modal.dataset.artifactDeleteReady === '1' || !isAdmin()) return;
    const idInput = modal.querySelector('#aam-id');
    const actions = modal.querySelector('.aam-actions');
    if (!idInput || !actions || !idInput.readOnly) return;
    const itemId = String(idInput.value || '').trim();
    if (!ARTIFACT_CATALOG.some(item => item.id === itemId)) return;

    ensureStyle();
    modal.dataset.artifactDeleteReady = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aam-delete';
    button.innerHTML = '<i class="fa-solid fa-trash"></i> 徹底刪除法寶';
    button.title = '由後端安全移除全站法寶、玩家持有資料與配方鏈';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
