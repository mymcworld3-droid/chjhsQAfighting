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

(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialCatalogV1';
  let unsubscribe = null;
  let migrationWriteStarted = false;
  let recipeRepairWriteStarted = false;

  function isAdmin() {
    try {
      return window.getCurrentUserData?.()?.isAdmin === true && !!getAuth(getApp()).currentUser;
    } catch (_) {
      return false;
    }
  }

  async function persistBackfill(ref, items) {
    if (migrationWriteStarted || !isAdmin()) return;
    migrationWriteStarted = true;
    try {
      await setDoc(ref, {
        items,
        materialCatalogSchemaVersion: MATERIAL_CATALOG_SCHEMA_VERSION,
        materialCatalogBackfilledAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn('[Material catalog migration] runtime backfill applied, Firestore persistence deferred:', error);
    }
  }

  async function persistRecipeRepair(ref, repair, { backfilled = false } = {}) {
    if (recipeRepairWriteStarted || (!repair?.changed && !backfilled) || !isAdmin()) return;
    recipeRepairWriteStarted = true;
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
      console.warn('[Material recipe repair] runtime repair applied, Firestore persistence deferred:', error);
    }
  }

  function start() {
    if (unsubscribe) return;
    let db;
    try { db = getFirestore(getApp()); } catch (_) { return; }
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
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
      } catch (error) {
        console.error('[Material catalog sync]', error);
      }
    }, (error) => console.error('[Material catalog snapshot]', error));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
