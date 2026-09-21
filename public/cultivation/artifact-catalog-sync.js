import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getDefaultArtifactCatalog, replaceArtifactCatalog } from './artifact-catalog.js';

// 全站法寶清單同步：Firestore 有管理員設定時使用遠端版本；否則退回程式內建預設值。
(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  const GENERATION_PROMPT_MAX = 1200;
  let unsubscribe = null;

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

  function start() {
    if (unsubscribe) return;
    let db;
    try { db = getFirestore(getApp()); } catch (_) { return; }
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
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
        replaceArtifactCatalog(data.items, 'firestore');
      } catch (error) {
        console.error('[Artifact catalog] remote config rejected; using defaults:', error);
        applyDefault('default-invalid-remote-config');
      }
    }, (error) => {
      console.warn('[Artifact catalog] Firestore sync unavailable; using defaults:', error);
      applyGenerationPrompt('', 'default-sync-error');
      applyEffectBounds({}, 'default-sync-error');
      applyDefault('default-sync-error');
    });
  }

  window.getArtifactEffectBounds = () => JSON.parse(JSON.stringify(window.__artifactEffectBoundsV2 || {}));
  window.setArtifactEffectBoundsLocal = (value, source = 'admin-save') => applyEffectBounds(value, source);
  window.getArtifactCatalogConfigPath = () => `${CONFIG_COLLECTION}/${CONFIG_DOC}`;
  window.getArtifactGenerationPrompt = () => normalizeGenerationPrompt(window.__artifactGenerationPrompt || '');
  window.setArtifactGenerationPromptLocal = (value, source = 'local') => applyGenerationPrompt(value, source);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
