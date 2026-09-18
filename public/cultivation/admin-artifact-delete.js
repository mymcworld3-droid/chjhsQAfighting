import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, collection, getDocs, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, replaceArtifactCatalog, validateArtifactCatalog } from './artifact-catalog.js';
import {
  ARTIFACT_RECIPES,
  validateArtifactRecipes,
  replaceArtifactRecipes
} from './material-catalog.js';
import { REFINERY_JOB_FIELD } from './refinery-economy.js';

// 管理員徹底刪除法寶：同步移除 catalog、配方鏈、所有玩家持有／裝備／buff，並給持有人補償。
// 為避免多批次只完成一半，受影響玩家超過單一 Firestore batch 安全上限時直接中止。
(function () {
  'use strict';

  const MODAL_ID = 'admin-artifact-modal';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  const MATERIAL_CONFIG_DOC = 'materialCatalogV1';
  const MAX_BATCH_USER_WRITES = 440;
  const MIN_COMPENSATION_PER_COPY = 100;
  let deleting = false;

  function playerData() { return window.getCurrentUserData?.() || null; }
  function isAdmin() { return playerData()?.isAdmin === true; }
  function clone(value) { return JSON.parse(JSON.stringify(value || {})); }

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

  function compensationPerCopy(item) {
    return Math.max(
      MIN_COMPENSATION_PER_COPY,
      Math.max(0, Math.floor(Number(item?.craft?.gold) || 0))
    );
  }

  function recipeTotal(recipe = []) {
    return (Array.isArray(recipe) ? recipe : []).reduce(
      (sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)),
      0
    );
  }

  function buildRecipesAfterDeletion(itemId) {
    // 一旦某配方依賴被刪法寶，整條依賴鏈的「配方」都取消；
    // 法寶本體不連帶刪除，避免改寫玩家其他既有收藏。
    const invalidRecipeIds = new Set([itemId]);
    let changed = true;
    while (changed) {
      changed = false;
      Object.entries(ARTIFACT_RECIPES).forEach(([artifactId, recipe]) => {
        if (invalidRecipeIds.has(artifactId)) return;
        const dependsOnInvalid = (Array.isArray(recipe) ? recipe : []).some(
          (row) => row?.artifactId && invalidRecipeIds.has(String(row.artifactId))
        );
        if (dependsOnInvalid) {
          invalidRecipeIds.add(artifactId);
          changed = true;
        }
      });
    }

    const raw = {};
    Object.entries(ARTIFACT_RECIPES).forEach(([artifactId, recipe]) => {
      if (invalidRecipeIds.has(artifactId)) return;
      const copied = clone(recipe);
      if (recipeTotal(copied) >= 2) raw[artifactId] = copied;
    });

    return {
      recipes: validateArtifactRecipes(raw),
      invalidatedRecipeIds: [...invalidRecipeIds]
    };
  }

  function jobReferencesArtifact(job, itemId) {
    if (!job || typeof job !== 'object' || !job.id) return false;
    if (String(job.knownArtifactId || '') === itemId) return true;
    if ((Array.isArray(job.ingredients) ? job.ingredients : []).some(
      (row) => row?.type === 'artifact' && String(row.id || '') === itemId
    )) return true;
    return (Array.isArray(job.recipe) ? job.recipe : []).some(
      (row) => String(row?.artifactId || '') === itemId
    );
  }

  function cleanPlayerForDeletion(raw, item, compensationEach) {
    const itemId = item.id;
    const artifactSystem = raw?.artifactSystem && typeof raw.artifactSystem === 'object'
      ? clone(raw.artifactSystem)
      : { inventory: {}, equipped: {}, buffs: {} };
    artifactSystem.inventory = artifactSystem.inventory && typeof artifactSystem.inventory === 'object'
      ? { ...artifactSystem.inventory } : {};
    artifactSystem.equipped = artifactSystem.equipped && typeof artifactSystem.equipped === 'object'
      ? { ...artifactSystem.equipped } : {};
    artifactSystem.buffs = artifactSystem.buffs && typeof artifactSystem.buffs === 'object'
      ? { ...artifactSystem.buffs } : {};

    const heldCopies = Math.max(0, Math.floor(Number(artifactSystem.inventory[itemId]) || 0));
    if (Object.prototype.hasOwnProperty.call(artifactSystem.inventory, itemId)) {
      delete artifactSystem.inventory[itemId];
    }

    Object.entries(artifactSystem.equipped).forEach(([slot, equippedId]) => {
      if (String(equippedId || '') === itemId) delete artifactSystem.equipped[slot];
    });
    Object.entries(artifactSystem.buffs).forEach(([key, buff]) => {
      if (String(buff?.artifactId || '') === itemId || String(key).startsWith(itemId + ':')) {
        delete artifactSystem.buffs[key];
      }
    });

    let canceledJob = false;
    let deletedJobInputs = 0;
    let jobGoldRefund = 0;
    let materialSystem = raw?.materialSystem && typeof raw.materialSystem === 'object'
      ? clone(raw.materialSystem) : { inventory: {} };
    materialSystem.inventory = materialSystem.inventory && typeof materialSystem.inventory === 'object'
      ? { ...materialSystem.inventory } : {};

    const job = raw?.[REFINERY_JOB_FIELD];
    if (jobReferencesArtifact(job, itemId)) {
      canceledJob = true;
      jobGoldRefund = Math.max(0, Math.floor(Number(job?.goldCost) || 0));
      (Array.isArray(job?.ingredients) ? job.ingredients : []).forEach((row) => {
        const qty = Math.max(0, Math.floor(Number(row?.quantity) || 0));
        if (!qty) return;
        if (row?.type === 'artifact') {
          const sourceId = String(row.id || '');
          if (sourceId === itemId) {
            deletedJobInputs += qty;
          } else if (sourceId) {
            artifactSystem.inventory[sourceId] =
              (Math.max(0, Number(artifactSystem.inventory[sourceId]) || 0) + qty);
          }
        } else {
          const materialId = String(row?.id || '');
          if (materialId) {
            materialSystem.inventory[materialId] =
              (Math.max(0, Number(materialSystem.inventory[materialId]) || 0) + qty);
          }
        }
      });
    }

    const compensatedCopies = heldCopies + deletedJobInputs;
    const compensationGold = compensatedCopies * compensationEach;
    const oldGold = Math.max(0, Math.floor(Number(raw?.stats?.gold) || 0));
    const newGold = oldGold + compensationGold + jobGoldRefund;

    const changed = heldCopies > 0 ||
      deletedJobInputs > 0 ||
      canceledJob ||
      Object.keys(raw?.artifactSystem?.equipped || {}).length !== Object.keys(artifactSystem.equipped).length ||
      Object.keys(raw?.artifactSystem?.buffs || {}).length !== Object.keys(artifactSystem.buffs).length;

    return {
      changed,
      heldCopies,
      deletedJobInputs,
      compensatedCopies,
      compensationGold,
      jobGoldRefund,
      newGold,
      artifactSystem,
      materialSystem,
      canceledJob
    };
  }

  async function buildDeletionPlan(item) {
    const db = getFirestore(getApp());
    const usersSnap = await getDocs(collection(db, 'users'));
    const compensationEach = compensationPerCopy(item);
    const affected = [];
    let totalHeldCopies = 0;
    let totalDeletedJobInputs = 0;
    let totalCompensationGold = 0;
    let canceledJobs = 0;

    usersSnap.forEach((userSnap) => {
      const raw = userSnap.data() || {};
      const cleanup = cleanPlayerForDeletion(raw, item, compensationEach);
      if (!cleanup.changed) return;
      affected.push({ ref: userSnap.ref, uid: userSnap.id, raw, cleanup });
      totalHeldCopies += cleanup.heldCopies;
      totalDeletedJobInputs += cleanup.deletedJobInputs;
      totalCompensationGold += cleanup.compensationGold + cleanup.jobGoldRefund;
      if (cleanup.canceledJob) canceledJobs += 1;
    });

    if (affected.length > MAX_BATCH_USER_WRITES) {
      throw new Error(`受影響玩家有 ${affected.length} 人，超過單次安全刪除上限 ${MAX_BATCH_USER_WRITES} 人；未進行任何刪除。`);
    }

    const recipePlan = buildRecipesAfterDeletion(item.id);
    return {
      item,
      compensationEach,
      affected,
      totalHeldCopies,
      totalDeletedJobInputs,
      totalCompensationGold,
      canceledJobs,
      recipePlan
    };
  }

  async function persistDeletion(plan) {
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!user || !isAdmin()) throw new Error('僅管理員可以刪除法寶');

    const itemId = plan.item.id;
    const next = ARTIFACT_CATALOG
      .filter((item) => item.id !== itemId)
      .map((item) => clone(item));

    if (next.length === ARTIFACT_CATALOG.length) throw new Error('找不到要刪除的法寶，請重新整理。');
    if (!next.length) throw new Error('至少需要保留 1 件法寶，不能刪除最後一件法寶。');

    const normalized = validateArtifactCatalog(next);
    const normalizedRecipes = plan.recipePlan.recipes;
    const db = getFirestore(getApp());

    // 明確再讀一次管理員資料；實際 batch 仍會再受 Firestore rules 約束。
    const adminSnap = await getDoc(doc(db, 'users', user.uid));
    if (!adminSnap.exists() || adminSnap.data()?.isAdmin !== true) {
      throw new Error('管理員權限驗證失敗');
    }

    const batch = writeBatch(db);
    const audit = {
      updatedBy: user.uid,
      updatedByName: playerData()?.displayName || user.displayName || '管理員',
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    };
    batch.set(doc(db, CONFIG_COLLECTION, CONFIG_DOC), {
      version: 1,
      items: normalized,
      deletedArtifactId: itemId,
      ...audit
    }, { merge: true });
    batch.set(doc(db, CONFIG_COLLECTION, MATERIAL_CONFIG_DOC), {
      version: 1,
      recipes: normalizedRecipes,
      deletedArtifactId: itemId,
      ...audit
    }, { merge: true });

    plan.affected.forEach(({ ref, cleanup }) => {
      const patch = {
        artifactSystem: cleanup.artifactSystem,
        'stats.gold': cleanup.newGold
      };
      if (cleanup.canceledJob) {
        patch.materialSystem = cleanup.materialSystem;
        patch[REFINERY_JOB_FIELD] = null;
      }
      batch.update(ref, patch);
    });

    await batch.commit();

    replaceArtifactCatalog(normalized, 'admin-delete');
    replaceArtifactRecipes(normalizedRecipes, 'admin-delete');

    const localUid = user.uid;
    const localEntry = plan.affected.find((entry) => entry.uid === localUid);
    if (localEntry) {
      const local = playerData();
      if (local) {
        local.artifactSystem = localEntry.cleanup.artifactSystem;
        local.stats = local.stats || {};
        local.stats.gold = localEntry.cleanup.newGold;
        if (localEntry.cleanup.canceledJob) {
          local.materialSystem = localEntry.cleanup.materialSystem;
          local[REFINERY_JOB_FIELD] = null;
        }
      }
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: localEntry.cleanup.artifactSystem }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: {
          source: 'artifact-delete-compensation',
          gold: localEntry.cleanup.newGold,
          artifactDeleted: itemId,
          compensationGold: localEntry.cleanup.compensationGold
        }
      }));
      if (localEntry.cleanup.canceledJob) {
        window.dispatchEvent(new CustomEvent('material-system-updated', { detail: localEntry.cleanup.materialSystem }));
        window.dispatchEvent(new CustomEvent('xiuxian:refinery-job-updated', { detail: null }));
      }
    }

    return { normalized, normalizedRecipes };
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

    deleting = true;
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 掃描影響…'; }
    if (save) save.disabled = true;
    if (cancel) cancel.disabled = true;
    if (status) status.textContent = '正在掃描全站持有人、配方依賴與煉器任務…';

    try {
      const plan = await buildDeletionPlan(item);
      const displayName = String(nameInput?.value || item.name || itemId).trim() || itemId;
      const invalidatedOtherRecipes = plan.recipePlan.invalidatedRecipeIds.filter((id) => id !== itemId).length;
      const confirmed = window.confirm(
        `確定要「徹底刪除」法寶「${displayName}」嗎？\n\n` +
        `• 持有玩家：${plan.affected.length} 人\n` +
        `• 玩家現存數量：${plan.totalHeldCopies} 件\n` +
        `• 每件補償：${plan.compensationEach.toLocaleString()} 金幣\n` +
        `• 預計補償／退款總額：${plan.totalCompensationGold.toLocaleString()} 金幣\n` +
        `• 取消相關煉器任務：${plan.canceledJobs} 個\n` +
        `• 連帶取消依賴配方：${invalidatedOtherRecipes} 個\n\n` +
        '刪除後會清除玩家背包、裝備、限時效果、自己的配方與所有依賴配方；此動作不可復原。'
      );
      if (!confirmed) {
        if (status) status.textContent = '已取消刪除。';
        return;
      }

      if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 徹底刪除中…';
      if (status) status.textContent = '正在一次提交玩家清理、補償、配方與法寶目錄…';

      await persistDeletion(plan);
      modal.remove();
      toast(`已徹底刪除 ${displayName}；補償 ${plan.totalCompensationGold.toLocaleString()} 金幣`);
    } catch (error) {
      console.error('[Admin artifact delete]', error);
      if (status) status.textContent = error.message || '法寶刪除失敗';
      toast(error.message || '法寶刪除失敗', false);
    } finally {
      deleting = false;
      if (document.body.contains(modal)) {
        if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-trash"></i> 徹底刪除法寶'; }
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
    if (!ARTIFACT_CATALOG.some((item) => item.id === itemId)) return;

    ensureStyle();
    modal.dataset.artifactDeleteReady = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aam-delete';
    button.innerHTML = '<i class="fa-solid fa-trash"></i> 徹底刪除法寶';
    button.title = '從全站法寶、玩家持有資料與配方鏈徹底移除';
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
