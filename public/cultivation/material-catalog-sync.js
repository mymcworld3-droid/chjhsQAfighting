import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  MATERIAL_CATALOG_SCHEMA_VERSION,
  mergeMaterialCatalogWithDefaults,
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

  async function persistRecipeRepair(ref, repair) {
    if (recipeRepairWriteStarted || !repair?.changed || !isAdmin()) return;
    recipeRepairWriteStarted = true;
    try {
      await setDoc(ref, {
        recipes: repair.recipes,
        orphanRecipeCleanupAt: serverTimestamp(),
        orphanRecipeCleanupRemovedIds: repair.removedRecipeIds.slice(0, 100)
      }, { merge: true });
    } catch (error) {
      recipeRepairWriteStarted = false;
      console.warn('[Material recipe repair] runtime cleanup applied, Firestore persistence deferred:', error);
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
          const repair = repairArtifactRecipes(data.recipes);
          replaceArtifactRecipes(repair.recipes, repair.changed ? 'firestore-orphan-repair' : 'firestore');
          if (repair.changed) {
            console.warn('[Material catalog sync] removed orphan recipe chain:', repair.removedRecipeIds, repair.reasons);
            persistRecipeRepair(ref, repair);
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
