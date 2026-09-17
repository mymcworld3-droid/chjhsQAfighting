import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { replaceMaterialCatalog, replaceArtifactRecipes } from './material-catalog.js';

(function () {
  'use strict';

  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialCatalogV1';
  let unsubscribe = null;

  function start() {
    if (unsubscribe) return;
    let db;
    try { db = getFirestore(getApp()); } catch (_) { return; }
    const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      try {
        if (Array.isArray(data.items) && data.items.length) replaceMaterialCatalog(data.items, 'firestore');
        if (data.recipes && typeof data.recipes === 'object' && !Array.isArray(data.recipes)) replaceArtifactRecipes(data.recipes, 'firestore');
      } catch (error) {
        console.error('[Material catalog sync]', error);
      }
    }, (error) => console.error('[Material catalog snapshot]', error));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
