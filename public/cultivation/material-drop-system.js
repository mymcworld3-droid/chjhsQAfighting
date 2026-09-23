import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { MATERIAL_CATALOG, getMaterialById, materialDropRateFor, materialRealmForScore } from './material-catalog.js';

// 問道答對與洞天首次通關材料掉落。
// 材料掉率不再由管理員手動百分比控制，而由「材料境界 × 玩家境界」自動決定：
// - 玩家未達材料境界：該材料不會出現。
// - 玩家達到同境界：依該材料境界的基礎稀有度抽取。
// - 玩家高出材料境界：舊境界材料的掉率逐步提高。
// 問道命中時每種材料 +1；洞天若至少命中一種材料，則本次總獎勵擴充為 3～10 個並分配到命中的材料種類。
(function () {
  'use strict';

  const FIELD = 'materialSystem';
  const DONGTIAN_MIN_MATERIALS = 3;
  const DONGTIAN_MAX_MATERIALS = 10;
  const rewardedQuizObjects = new WeakSet();
  let lastAnswered = null;
  let lastCorrect = null;
  let grantQueue = Promise.resolve();

  function userData() { return window.getCurrentUserData?.() || null; }
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function database() { return getFirestore(getApp()); }
  function currentScore() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function normalizeMaterialSystem(raw = {}) {
    const inventory = {};
    Object.entries(raw?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    return { inventory };
  }
  function toast(message) {
    document.getElementById('material-drop-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'material-drop-toast';
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:178px;z-index:10120;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid rgba(216,177,93,.48);border-radius:999px;background:rgba(10,8,12,.97);color:#f4e8c6;font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function roll(source) {
    const score = currentScore();
    return MATERIAL_CATALOG.flatMap((material) => {
      const rate = materialDropRateFor(material, score, source);
      return rate > 0 && Math.random() < rate ? [{ materialId: material.id, quantity: 1 }] : [];
    });
  }

  function expandDongtianDrops(drops) {
    if (!Array.isArray(drops) || !drops.length) return [];
    const compact = new Map();
    drops.forEach((drop) => {
      const materialId = String(drop?.materialId || '').trim();
      if (!materialId || !getMaterialById(materialId)) return;
      compact.set(materialId, Math.max(1, Math.floor(Number(drop?.quantity) || 1)));
    });
    const materialIds = [...compact.keys()];
    if (!materialIds.length) return [];

    const rolledTotal = DONGTIAN_MIN_MATERIALS + Math.floor(Math.random() * (DONGTIAN_MAX_MATERIALS - DONGTIAN_MIN_MATERIALS + 1));
    const currentTotal = [...compact.values()].reduce((sum, quantity) => sum + quantity, 0);
    const targetTotal = Math.max(currentTotal, rolledTotal);
    let remaining = targetTotal - currentTotal;
    while (remaining > 0) {
      const materialId = materialIds[Math.floor(Math.random() * materialIds.length)];
      compact.set(materialId, (compact.get(materialId) || 0) + 1);
      remaining -= 1;
    }
    return [...compact.entries()].map(([materialId, quantity]) => ({ materialId, quantity }));
  }

  // Firestore already retries a transaction internally, but the player's shared
  // users document may still change under heavy concurrent activity. Retry only
  // known version-conflict errors, with bounded backoff; never retry unknown
  // commit outcomes (which could otherwise grant the same drop twice).
  async function runDropTransactionWithRetry(operation, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
    const MAX_CONFLICT_RETRIES = 3;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const code = String(error?.code || '').replace(/^firestore\\//, '');
        if (!['failed-precondition', 'aborted'].includes(code) || attempt >= MAX_CONFLICT_RETRIES) throw error;
        await sleep(180 * (2 ** attempt) + Math.floor(Math.random() * 90));
      }
    }
  }

  async function grantDrops(source, drops) {
    if (!Array.isArray(drops) || !drops.length) return [];
    const user = authUser();
    if (!user) return [];
    const compact = new Map();
    drops.forEach((drop) => {
      const materialId = String(drop?.materialId || '').trim();
      const quantity = Math.max(0, Math.floor(Number(drop?.quantity) || 0));
      if (!materialId || quantity <= 0 || !getMaterialById(materialId)) return;
      compact.set(materialId, (compact.get(materialId) || 0) + quantity);
    });
    const normalizedDrops = [...compact.entries()].map(([materialId, quantity]) => ({ materialId, quantity }));
    if (!normalizedDrops.length) return [];

    let committed = null;
    await runDropTransactionWithRetry(() => runTransaction(database(), async (tx) => {
      const ref = doc(database(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const next = normalizeMaterialSystem(snap.data()?.[FIELD] || {});
      normalizedDrops.forEach(({ materialId, quantity }) => {
        next.inventory[materialId] = (Number(next.inventory[materialId]) || 0) + quantity;
      });
      committed = next;
      tx.update(ref, { [FIELD]: next });
    }));

    // A session may change while Firestore retries; never apply the previous
    // account's inventory to a different player's local profile.
    if (authUser()?.uid !== user.uid) return normalizedDrops;
    const data = userData();
    if (data) data[FIELD] = committed;
    window.dispatchEvent(new CustomEvent('material-system-updated', {
      detail: { ...committed, dropSource: source, drops: normalizedDrops }
    }));
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
      detail: { materialDropped: true, dropSource: source }
    }));
    const label = normalizedDrops.map(({ materialId, quantity }) => {
      const item = getMaterialById(materialId);
      return `${item?.name || materialId}（${item?.realm || '未知境界'}）×${quantity}`;
    }).join('、');
    toast(`${source === 'dongtian' ? '洞天機緣' : '問道機緣'}：獲得 ${label}`);
    return normalizedDrops;
  }

  function enqueueRoll(source) {
    const rolledDrops = roll(source);
    const drops = source === 'dongtian' ? expandDongtianDrops(rolledDrops) : rolledDrops;
    if (!drops.length) return;
    grantQueue = grantQueue.then(() => grantDrops(source, drops)).catch((error) => {
      console.warn('[Material drop] reward not committed:', error?.code || error?.message || String(error));
      toast('材料掉落未能寫入，獎勵尚未發放，請稍後再試。');
    });
  }

  function correctQuizIsLocal() {
    const quiz = window.currentActiveQuiz;
    if (!quiz || typeof quiz !== 'object') return null;
    if (rewardedQuizObjects.has(quiz)) return null;
    const feedback = document.getElementById('feedback-section');
    const title = document.getElementById('feedback-title');
    if (!feedback || feedback.classList.contains('hidden') || !title?.classList.contains('text-green-400')) return null;
    return quiz;
  }

  function syncQuizBaseline(stats = userData()?.stats) {
    if (!stats) return;
    lastAnswered = Math.max(0, Number(stats.totalAnswered) || 0);
    lastCorrect = Math.max(0, Number(stats.totalCorrect) || 0);
  }

  function onStatsUpdated(event) {
    const stats = event?.detail?.stats;
    if (!stats) return;
    const answered = Math.max(0, Number(stats.totalAnswered) || 0);
    const correct = Math.max(0, Number(stats.totalCorrect) || 0);
    if (lastAnswered === null || lastCorrect === null) {
      lastAnswered = answered;
      lastCorrect = correct;
      return;
    }
    const answeredDelta = answered - lastAnswered;
    const correctDelta = correct - lastCorrect;
    lastAnswered = answered;
    lastCorrect = correct;
    if (answeredDelta <= 0 || correctDelta <= 0) return;
    const quiz = correctQuizIsLocal();
    if (!quiz) return;
    rewardedQuizObjects.add(quiz);
    enqueueRoll('quiz');
  }

  function scanDongtianResult() {
    document.querySelectorAll('#dongtian-overlay .dt-result').forEach((result) => {
      if (result.dataset.materialDropProcessed === '1') return;
      const reward = result.querySelector('.dt-reward');
      if (!reward || !reward.textContent.includes('首次通關洞天獎勵')) return;
      result.dataset.materialDropProcessed = '1';
      enqueueRoll('dongtian');
    });
  }

  function publishRealmDropState() {
    const score = currentScore();
    window.XIUXIAN_MATERIAL_DROP_STATE = {
      score,
      playerRealm: materialRealmForScore(score),
      rates: Object.fromEntries(MATERIAL_CATALOG.map((material) => [material.id, {
        quizRate: materialDropRateFor(material, score, 'quiz'),
        dongtianRate: materialDropRateFor(material, score, 'dongtian')
      }]))
    };
  }

  function boot() {
    syncQuizBaseline();
    publishRealmDropState();
    window.addEventListener('xiuxian:stats-updated', (event) => {
      onStatsUpdated(event);
      publishRealmDropState();
    });
    window.addEventListener('xiuxian:user-ready', () => { syncQuizBaseline(); publishRealmDropState(); });
    window.addEventListener('material-catalog-updated', publishRealmDropState);
    scanDongtianResult();
    new MutationObserver(scanDongtianResult).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
