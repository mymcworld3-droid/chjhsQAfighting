import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 舊核心仍會依舊門檻重算 rankLevel；此層把資料索引校正成新版境界曲線。
(function () {
  'use strict';

  let writing = false;
  let lastPersistedKey = '';

  function realms() {
    return Array.isArray(window.XIUXIAN_REALMS) ? window.XIUXIAN_REALMS : [];
  }

  function expectedRank(score) {
    const list = realms();
    let index = 0;
    list.forEach((realm, i) => {
      if (Number(score) >= Number(realm.need || 0)) index = i;
    });
    return window.limitImmortalRank(index, score, list);
  }

  async function sync() {
    if (writing || !window.trueImmortalBoardReady) return;
    const data = window.getCurrentUserData?.();
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!data?.stats || !user || !realms().length) return;

    const score = Math.max(0, Number(data.stats.totalScore) || 0);
    const rank = expectedRank(score);

    const previousRank = Number(data.stats.rankLevel);
    data.stats.rankLevel = rank;
    // The normal reward save already persists a correct rank. Do not write again
    // simply because the score changed while the player remained in the same realm.
    const key = `${user.uid}:${rank}`;
    if (lastPersistedKey === key || previousRank === rank) {
      lastPersistedKey = key;
      return;
    }

    writing = true;
    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), { 'stats.rankLevel': rank });
      lastPersistedKey = key;
    } catch (error) {
      console.warn('Rank sync failed:', error);
    } finally {
      writing = false;
    }
  }

  function boot() {
    sync();
    setInterval(sync, 700);
    window.addEventListener('xiuxian:stats-updated', sync);
    window.addEventListener('xiuxian:immortals-updated', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
