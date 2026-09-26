import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  ARTIFACT_CATALOG_SCHEMA_VERSION,
  getDefaultArtifactCatalog,
  mergeArtifactCatalogWithDefaults,
  replaceArtifactCatalog
} from './artifact-catalog.js';

// 全站法寶清單同步：Firestore 有管理員設定時使用遠端版本；否則退回程式內建預設值。
(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  const GENERATION_PROMPT_MAX = 1200;
  let unsubscribe = null;
  let migrationWriteStarted = false;
  let pendingMigration = null;
  // A fallback catalog cannot validate remotely created artifacts. Never remove
  // a player's saved equipment until the authoritative catalog is available.
  window.__artifactCatalogReadyForEquipment = false;

  function normalizeGenerationPrompt(value) {
    return String(value || '').trim().slice(0, GENERATION_PROMPT_MAX);
  }

  function applyGenerationPrompt(value, source = 'sync') {
    const prompt = normalizeGenerationPrompt(value);
    window.__artifactGenerationPrompt = prompt;
    window.dispatchEvent(new CustomEvent('artifact-generation-prompt-updated', {
      detail: { prompt, source }
    }));
    return prompt;
  }

  function applyEffectBounds(value, source = 'sync') {
    const bounds = value && typeof value === 'object' && !Array.isArray(value)
      ? JSON.parse(JSON.stringify(value)) : {};
    window.__artifactEffectBoundsV2 = bounds;
    window.dispatchEvent(new CustomEvent('artifact-effect-bounds-updated', { detail: { source } }));
  }

  function applyDefault(reason = 'fallback') {
    try {
      replaceArtifactCatalog(getDefaultArtifactCatalog(), reason);
    } catch (error) {
      console.error('[Artifact catalog] default catalog invalid:', error);
    }
  }

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
      pendingMigration = { ref, items };
      return;
    }
    migrationWriteStarted = true;
    pendingMigration = null;
    try {
      await setDoc(ref, {
        items,
        artifactCatalogSchemaVersion: ARTIFACT_CATALOG_SCHEMA_VERSION,
        artifactCatalogBackfilledAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      migrationWriteStarted = false;
      pendingMigration = { ref, items };
      console.warn('[Artifact catalog migration] runtime backfill applied, Firestore persistence deferred:', error);
    }
  }

  function retryPendingMigration() {
    if (!pendingMigration || migrationWriteStarted || !isAdmin()) return;
    const pending = pendingMigration;
    persistBackfill(pending.ref, pending.items);
  }

  function start() {
    if (unsubscribe) return;
    let db;
    try { db = getFirestore(getApp()); } catch (_) { return; }
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        window.__artifactCatalogReadyForEquipment = true;
        applyGenerationPrompt('', 'default-no-remote-config');
        applyEffectBounds({}, 'default-no-remote-config');
        applyDefault('default-no-remote-config');
        return;
      }
      const data = snap.data() || {};
      applyGenerationPrompt(data.generationPrompt || '', 'firestore');
      applyEffectBounds(data.effectBoundsV2 || {}, 'firestore');
      try {
        if (!Array.isArray(data.items) || !data.items.length) throw new Error('遠端法寶清單為空');
        const schemaVersion = Math.max(0, Number(data.artifactCatalogSchemaVersion) || 0);
        const needsBackfill = schemaVersion < ARTIFACT_CATALOG_SCHEMA_VERSION;
        const items = needsBackfill ? mergeArtifactCatalogWithDefaults(data.items) : data.items;
        // Mark ready before replace fires artifact-catalog-updated, which may
        // validate equipment from the saved users/{uid} document.
        window.__artifactCatalogReadyForEquipment = true;
        replaceArtifactCatalog(items, needsBackfill ? 'firestore-backfill' : 'firestore');
        if (needsBackfill) persistBackfill(ref, items);
      } catch (error) {
        window.__artifactCatalogReadyForEquipment = false;
        console.error('[Artifact catalog] remote config rejected; using defaults:', error);
        applyDefault('default-invalid-remote-config');
      }
    }, (error) => {
      window.__artifactCatalogReadyForEquipment = false;
      console.warn('[Artifact catalog] Firestore sync unavailable; using defaults:', error);
      applyGenerationPrompt('', 'default-sync-error');
      applyEffectBounds({}, 'default-sync-error');
      applyDefault('default-sync-error');
    });
  }

  window.addEventListener('xiuxian:user-ready', retryPendingMigration);
  window.addEventListener('xiuxian:features-ready', retryPendingMigration);

  window.getArtifactEffectBounds = () => JSON.parse(JSON.stringify(window.__artifactEffectBoundsV2 || {}));
  window.setArtifactEffectBoundsLocal = (value, source = 'admin-save') => applyEffectBounds(value, source);
  window.getArtifactCatalogConfigPath = () => `${CONFIG_COLLECTION}/${CONFIG_DOC}`;
  window.getArtifactGenerationPrompt = () => normalizeGenerationPrompt(window.__artifactGenerationPrompt || '');
  window.setArtifactGenerationPromptLocal = (value, source = 'local') => applyGenerationPrompt(value, source);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
