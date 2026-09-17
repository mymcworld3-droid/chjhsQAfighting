import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { MATERIAL_CATALOG, getMaterialById } from './material-catalog.js';

// 問道答對與洞天首次通關材料掉落。
// 掉落率由 gameConfig/materialDropV1 控制；每種材料各自獨立抽取，因此同一次可能獲得多種材料。
(function () {
  'use strict';

  const FIELD = 'materialSystem';
  const CONFIG_COLLECTION = 'gameConfig';
  const CONFIG_DOC = 'materialDropV1';
  const rewardedQuizObjects = new WeakSet();
  let unwatch = null;
  let lastAnswered = null;
  let lastCorrect = null;
  let rules = {};
  let grantQueue = Promise.resolve();

  const BUILTIN_RATES = Object.freeze({
    'spirit-iron': { quizRate: 0.04, dongtianRate: 0.20 },
    'spirit-wood': { quizRate: 0.05, dongtianRate: 0.22 },
    'spirit-crystal': { quizRate: 0.03, dongtianRate: 0.15 },
    'beast-core-shard': { quizRate: 0.02, dongtianRate: 0.10 },
    'talisman-paper': { quizRate: 0.06, dongtianRate: 0.25 }
  });

  function userData() { return window.getCurrentUserData?.() || null; }
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function database() { return getFirestore(getApp()); }
  function clampRate(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }
  function defaultRule(materialId) {
    const builtIn = BUILTIN_RATES[materialId];
    return builtIn ? { ...builtIn } : { quizRate: 0.03, dongtianRate: 0.15 };
  }
  function normalizeRule(raw, materialId) {
    const fallback = defaultRule(materialId);
    return {
      quizRate: clampRate(raw?.quizRate, fallback.quizRate),
      dongtianRate: clampRate(raw?.dongtianRate, fallback.dongtianRate)
    };
  }
  function normalizeRules(raw = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const next = {};
    MATERIAL_CATALOG.forEach((material) => {
      next[material.id] = normalizeRule(source[material.id], material.id);
    });
    return next;
  }
  function publishRules() {
    window.XIUXIAN_MATERIAL_DROP_RULES = JSON.parse(JSON.stringify(rules));
    window.dispatchEvent(new CustomEvent('material-drop-rules-updated', { detail: window.XIUXIAN_MATERIAL_DROP_RULES }));
  }
  function setRules(raw) {
    rules = normalizeRules(raw);
    publishRules();
  }
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
    el.style.cssText = 'position:fixed;left:50%;bottom:178px;z-index:10120;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid rgba(167,139,250,.48);border-radius:999px;background:rgba(10,8,18,.97);color:#eadcff;font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function roll(source) {
    const key = source === 'dongtian' ? 'dongtianRate' : 'quizRate';
    return MATERIAL_CATALOG.flatMap((material) => {
      const rate = clampRate(rules[material.id]?.[key], defaultRule(material.id)[key]);
      return rate > 0 && Math.random() < rate ? [{ materialId: material.id, quantity: 1 }] : [];
    });
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
    await runTransaction(database(), async (tx) => {
      const ref = doc(database(), 'users', user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('玩家資料不存在');
      const next = normalizeMaterialSystem(snap.data()?.[FIELD] || {});
      normalizedDrops.forEach(({ materialId, quantity }) => {
        next.inventory[materialId] = (Number(next.inventory[materialId]) || 0) + quantity;
      });
      committed = next;
      tx.update(ref, { [FIELD]: next });
    });

    const data = userData();
    if (data) data[FIELD] = committed;
    window.dispatchEvent(new CustomEvent('material-system-updated', {
      detail: { ...committed, dropSource: source, drops: normalizedDrops }
    }));
    // material-system.js 已監聽 stats 更新作為重繪訊號；此事件不帶 stats，因此不會再次觸發問道掉落判定。
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
      detail: { materialDropped: true, dropSource: source }
    }));
    const label = normalizedDrops.map(({ materialId, quantity }) => `${getMaterialById(materialId)?.name || materialId} ×${quantity}`).join('、');
    toast(`${source === 'dongtian' ? '洞天機緣' : '問道機緣'}：獲得 ${label}`);
    return normalizedDrops;
  }

  function enqueueRoll(source) {
    const drops = roll(source);
    if (!drops.length) return;
    grantQueue = grantQueue.then(() => grantDrops(source, drops)).catch((error) => {
      console.warn('[Material drop]', error);
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

  function watchConfig() {
    if (unwatch) return;
    try {
      unwatch = onSnapshot(doc(database(), CONFIG_COLLECTION, CONFIG_DOC), (snap) => {
        setRules(snap.exists() ? snap.data()?.rules : {});
      }, (error) => {
        console.warn('[Material drop config]', error);
        setRules({});
      });
    } catch (error) {
      console.warn('[Material drop config]', error);
      setRules({});
    }
  }

  function boot() {
    setRules({});
    syncQuizBaseline();
    watchConfig();
    window.addEventListener('xiuxian:stats-updated', onStatsUpdated);
    window.addEventListener('xiuxian:user-ready', () => { syncQuizBaseline(); watchConfig(); });
    window.addEventListener('material-catalog-updated', () => setRules(rules));
    scanDongtianResult();
    new MutationObserver(scanDongtianResult).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
