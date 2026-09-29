import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  MATERIAL_CATALOG_SCHEMA_VERSION,
  ARTIFACT_RECIPE_SCHEMA_VERSION,
  mergeMaterialCatalogWithDefaults,
  mergeArtifactRecipesWithDefaults,
  replaceMaterialCatalog,
  replaceArtifactRecipes,
  repairArtifactRecipes
} from './material-catalog.js';

let resolveMaterialCatalogReady;
let materialCatalogReadySettled = false;
export const featureReady = new Promise((resolve) => { resolveMaterialCatalogReady = resolve; });
function markMaterialCatalogReady(source) {
  if (materialCatalogReadySettled) return;
  materialCatalogReadySettled = true;
  window.__materialCatalogStartupReady = true;
  resolveMaterialCatalogReady({ ok: true, source });
  window.dispatchEvent(new CustomEvent('xiuxian:material-catalog-startup-ready', { detail: { source } }));
}

(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialCatalogV1';
  let unsubscribe = null;
  let migrationWriteStarted = false;
  let recipeRepairWriteStarted = false;
  let pendingMaterialBackfill = null;
  let pendingRecipeRepair = null;

  function isAdmin() {
    try {
      return window.getCurrentUserData?.()?.isAdmin === true && !!getAuth(getApp()).currentUser;
    } catch (_) {
      return false;
    }
  }

  async function persistBackfill(ref, items) {
    if (migrationWriteStarted) return;
    if (!isAdmin()) {
      pendingMaterialBackfill = { ref, items };
      return;
    }
    migrationWriteStarted = true;
    pendingMaterialBackfill = null;
    try {
      await setDoc(ref, {
        items,
        materialCatalogSchemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION,
        materialCatalogBackfilledAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      migrationWriteStarted = false;
      pendingMaterialBackfill = { ref, items };
      console.warn('[Material catalog migration] runtime backfill applied, Firestore persistence deferred:', error);
    }
  }

  async function persistRecipeRepair(ref, repair, { backfilled = false } = {}) {
    if (recipeRepairWriteStarted || (!repair?.changed && !backfilled)) return;
    if (!isAdmin()) {
      pendingRecipeRepair = { ref, repair, backfilled };
      return;
    }
    recipeRepairWriteStarted = true;
    pendingRecipeRepair = null;
    try {
      const payload = {
        recipes: repair.recipes,
        artifactRecipeSchemaVersion: ARTIFACT_RECIPE_SCHEMA_VERSION
      };
      if (backfilled) payload.artifactRecipeBackfilledAt = serverTimestamp();
      if (repair.changed) {
        payload.orphanRecipeCleanupAt = serverTimestamp();
        payload.orphanRecipeCleanupRemovedIds = repair.removedRecipeIds.slice(0, 100);
      }
      await setDoc(ref, payload, { merge: true });
    } catch (error) {
      recipeRepairWriteStarted = false;
      pendingRecipeRepair = { ref, repair, backfilled };
      console.warn('[Material recipe repair] runtime repair applied, Firestore persistence deferred:', error);
    }
  }

  function retryPendingWrites() {
    if (!isAdmin()) return;
    if (pendingMaterialBackfill && !migrationWriteStarted) {
      const pending = pendingMaterialBackfill;
      persistBackfill(pending.ref, pending.items);
    }
    if (pendingRecipeRepair && !recipeRepairWriteStarted) {
      const pending = pendingRecipeRepair;
      persistRecipeRepair(pending.ref, pending.repair, { backfilled: pending.backfilled });
    }
  }

  function start() {
    if (unsubscribe) return;
    setTimeout(() => {
      if (!materialCatalogReadySettled) markMaterialCatalogReady('startup-timeout');
    }, 4500);
    let db;
    try { db = getFirestore(getApp()); } catch (_) { return; }
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        markMaterialCatalogReady('default-no-remote-config');
        return;
      }
      const data = snap.data() || {};
      try {
        if (Array.isArray(data.items) && data.items.length) {
          const schemaVersion = Math.max(0, Number(data.materialCatalogSchemaVersion) || 0);
          const needsBackfill = schemaVersion < MATERIAL_CATALOG_SCHEMA_VERSION;
          const items = needsBackfill ? mergeMaterialCatalogWithDefaults(data.items) : data.items;
          replaceMaterialCatalog(items, needsBackfill ? 'firestore-backfill' : 'firestore');
          if (needsBackfill) persistBackfill(ref, items);
        }
        if (data.recipes && typeof data.recipes === 'object' && !Array.isArray(data.recipes)) {
          const recipeSchemaVersion = Math.max(0, Number(data.artifactRecipeSchemaVersion) || 0);
          const needsRecipeBackfill = recipeSchemaVersion < ARTIFACT_RECIPE_SCHEMA_VERSION;
          const recipeSource = needsRecipeBackfill
            ? mergeArtifactRecipesWithDefaults(data.recipes)
            : data.recipes;
          const repair = repairArtifactRecipes(recipeSource);
          const source = repair.changed
            ? 'firestore-orphan-repair'
            : (needsRecipeBackfill ? 'firestore-recipe-backfill' : 'firestore');
          replaceArtifactRecipes(repair.recipes, source);
          if (repair.changed) {
            console.warn('[Material catalog sync] removed orphan recipe chain:', repair.removedRecipeIds, repair.reasons);
          }
          if (repair.changed || needsRecipeBackfill) {
            persistRecipeRepair(ref, repair, { backfilled: needsRecipeBackfill });
          }
        }
        markMaterialCatalogReady('firestore');
      } catch (error) {
        console.error('[Material catalog sync]', error);
        markMaterialCatalogReady('default-invalid-remote-config');
      }
    }, (error) => {
      console.error('[Material catalog snapshot]', error);
      markMaterialCatalogReady('default-sync-error');
    });
  }

  window.addEventListener('xiuxian:user-ready', retryPendingWrites);
  window.addEventListener('xiuxian:features-ready', retryPendingWrites);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
