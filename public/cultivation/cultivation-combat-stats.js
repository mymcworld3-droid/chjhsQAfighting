import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 修仙戰鬥基礎數值：目前只保留攻擊力與生命值。
// 正式鬥法會以此數值建立新的單場投影；房間內生命的損失不會寫回玩家資料。
// 缺少欄位的舊玩家會自動補上，但既有數值絕不覆蓋。
(function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    attack: 200,
    hp: 1000,
    maxHp: 1000
  });

  let initializedUid = null;
  let initializing = false;

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalized(stats = {}) {
    const maxHp = Math.max(1, finiteNumber(stats.maxHp, DEFAULTS.maxHp));
    const hp = Math.max(0, Math.min(maxHp, finiteNumber(stats.hp, maxHp)));
    return {
      attack: Math.max(0, finiteNumber(stats.attack, DEFAULTS.attack)),
      hp,
      maxHp
    };
  }

  function missingPatch(stats = {}) {
    const patch = {};
    Object.entries(DEFAULTS).forEach(([key, value]) => {
      const current = Number(stats[key]);
      if (!Number.isFinite(current)) patch[`stats.${key}`] = value;
    });
    return patch;
  }

  window.getCombatStats = function () {
    const data = window.getCurrentUserData?.();
    return normalized(data?.stats || {});
  };

  window.getCombatStatDefaults = function () {
    return { ...DEFAULTS };
  };

  async function ensureDefaults() {
    if (initializing) return;
    const data = window.getCurrentUserData?.();
    const auth = getAuth(getApp());
    const user = auth.currentUser;
    if (!data?.stats || !user) return;

    if (initializedUid === user.uid) return;
    const patch = missingPatch(data.stats);
    if (!Object.keys(patch).length) {
      initializedUid = user.uid;
      return;
    }

    initializing = true;
    try {
      // 先同步記憶體，讓狀態頁立即看到預設值。
      Object.entries(DEFAULTS).forEach(([key, value]) => {
        const current = Number(data.stats[key]);
        if (!Number.isFinite(current)) data.stats[key] = value;
      });

      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), patch);
      initializedUid = user.uid;
      window.dispatchEvent(new CustomEvent('combat-stats-ready', {
        detail: normalized(data.stats)
      }));
    } catch (error) {
      console.warn('Combat stat defaults could not be persisted:', error);
    } finally {
      initializing = false;
    }
  }

  window.ensureCombatStats = ensureDefaults;

  function boot() {
    // 登入或玩家資料就緒後補一次即可；不要每 1.2 秒檢查。
    // 鬥法與狀態頁仍可透過 window.ensureCombatStats 主動補全。
    void ensureDefaults();
    window.addEventListener('xiuxian:user-data-ready', () => { void ensureDefaults(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
