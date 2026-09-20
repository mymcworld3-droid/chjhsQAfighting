import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 消耗道具只負責數量與服用；唯一背包畫面由 unified-inventory-grid.js 繪製。
(function () {
  'use strict';
  const PILL_FIELD = 'revivalPills';
  const PILL_GAIN = 100;
  let busy = false;
  function userData() { return window.getCurrentUserData?.() || null; }
  function pillCount() { return Math.max(0, Number(userData()?.stats?.[PILL_FIELD]) || 0); }
  function realmIndexFor(score) {
    if (typeof window.getXiuxianRealmIndex === 'function') return window.getXiuxianRealmIndex(score);
    return Math.max(0, Number(userData()?.stats?.rankLevel) || 0);
  }
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'xiuxian-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 2400);
  }
  async function useRevivalPill() {
    if (busy || pillCount() <= 0) return;
    const data = userData();
    let user;
    try { user = getAuth(getApp()).currentUser; } catch (_) { return; }
    if (!data?.stats || !user) return;

    busy = true;

    const oldScore = Math.max(0, Number(data.stats.totalScore) || 0);
    const oldCount = pillCount();
    const newScore = oldScore + PILL_GAIN;
    const newCount = oldCount - 1;

    try {
      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), {
        'stats.totalScore': newScore,
        'stats.rankLevel': realmIndexFor(newScore),
        [`stats.${PILL_FIELD}`]: newCount
      });

      data.stats.totalScore = newScore;
      data.stats.rankLevel = realmIndexFor(newScore);
      data.stats[PILL_FIELD] = newCount;

      const displayScore = document.getElementById('display-score');
      if (displayScore) displayScore.textContent = String(newScore);

      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: { totalScore: newScore, revivalPills: newCount, inventoryItem: 'revival-pill' }
      }));
      window.refreshCultivationRealmUI?.();
      toast(`服用回魂聚靈丹，修為 +${PILL_GAIN}`);
    } catch (error) {
      console.error('Use revival pill from cultivation backpack failed:', error);
      toast('道具使用失敗，請稍後再試。');
    } finally {
      busy = false;
      }
  }


  window.getCultivationInventoryItems = function () {
    const count = pillCount();
    return count > 0 ? [{ id:'revival-pill', name:'回魂聚靈丹', type:'consumable', quantity:count, cultivationGain:PILL_GAIN }] : [];
  };
  window.useRevivalPillItem = useRevivalPill;
})();
