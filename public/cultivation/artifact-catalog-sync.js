import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getDefaultArtifactCatalog, replaceArtifactCatalog } from './artifact-catalog.js';

// 全站法寶清單同步：Firestore 有管理員設定時使用遠端版本；否則退回程式內建預設值。
(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'artifactCatalogV1';
  let unsubscribe = null;

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
        applyDefault('default-no-remote-config');
        return;
      }
      const data = snap.data() || {};
      try {
        if (!Array.isArray(data.items) || !data.items.length) throw new Error('遠端法寶清單為空');
        replaceArtifactCatalog(data.items, 'firestore');
      } catch (error) {
        console.error('[Artifact catalog] remote config rejected; using defaults:', error);
        applyDefault('default-invalid-remote-config');
      }
    }, (error) => {
      console.warn('[Artifact catalog] Firestore sync unavailable; using defaults:', error);
      applyDefault('default-sync-error');
    });
  }

  window.getArtifactCatalogConfigPath = () => `${CONFIG_COLLECTION}/${CONFIG_DOC}`;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
