import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 進度規則 v2：築基開多人、金丹 28 開內丹；舊版高境界玩家一次性補償。
(function () {
  'use strict';

  const FOUNDATION_SCORE = 10;
  const LEGACY_HIGH_REALM_SCORE = 150;
  const GOLDEN_CORE_SCORE = 28;
  const MIGRATION_FIELD = 'progressionMigrationV2';
  const MIGRATION_VERSION = 2;
  const PILL_FIELD = 'revivalPills';
  const PILL_GAIN = 100;

  const FALLBACK_REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0 },
    { name: '煉氣', sub: '一層', need: 1 },
    { name: '煉氣', sub: '二層', need: 2 },
    { name: '煉氣', sub: '三層', need: 3 },
    { name: '煉氣', sub: '四層', need: 4 },
    { name: '煉氣', sub: '五層', need: 5 },
    { name: '煉氣', sub: '六層', need: 6 },
    { name: '煉氣', sub: '七層', need: 7 },
    { name: '煉氣', sub: '八層', need: 8 },
    { name: '煉氣', sub: '九層', need: 9 },
    { name: '築基', sub: '初期', need: 10 },
    { name: '築基', sub: '中期', need: 16 },
    { name: '築基', sub: '後期', need: 22 },
    { name: '金丹', sub: '丹成一品', need: 28 },
    { name: '元嬰', sub: '元嬰出竅', need: 68 },
    { name: '化神', sub: '神念通天', need: 128 },
    { name: '煉虛', sub: '虛空悟道', need: 208 },
    { name: '合體', sub: '天地合一', need: 308 },
    { name: '大乘', sub: '大道將成', need: 448 },
    { name: '渡劫', sub: '雷劫問道', need: 628 },
    { name: '半仙', sub: '仙門在望', need: 868 },
    { name: '真仙', sub: '榜上仙位', need: 868 }
  ];

  let migrating = false;
  let migratedUid = null;
  let pillBusy = false;

  function realms() {
    return Array.isArray(window.XIUXIAN_REALMS) && window.XIUXIAN_REALMS.length
      ? window.XIUXIAN_REALMS
      : FALLBACK_REALMS;
  }

  function userData() {
    return window.getCurrentUserData?.() || null;
  }

  function score() {
    return Math.max(0, Number(userData()?.stats?.totalScore) || 0);
  }

  function realmIndexFor(value) {
    let index = 0;
    realms().forEach((realm, i) => {
      if (Number(value) >= Number(realm.need || 0)) index = i;
    });
    return window.limitImmortalRank(index, value, realms());
  }

  function pillCount() {
    return Math.max(0, Number(userData()?.stats?.[PILL_FIELD]) || 0);
  }

  function ensureStyle() {
    if (document.getElementById('progression-v2-style')) return;
    const style = document.createElement('style');
    style.id = 'progression-v2-style';
    style.textContent = `
      .progression-locked{position:relative!important;opacity:.52!important;filter:saturate(.55)}
      .progression-lock-badge{position:absolute;right:8px;top:7px;z-index:8;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#e8c56f;border:1px solid rgba(216,177,93,.35);background:rgba(8,8,8,.92);font-size:8px}
      .progression-modal-backdrop{position:fixed;inset:0;z-index:6900;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.82);backdrop-filter:blur(12px)}
      .progression-modal{width:min(100%,470px);border:1px solid rgba(216,177,93,.4);border-radius:28px;padding:23px;text-align:center;background:linear-gradient(145deg,rgba(27,22,13,.99),rgba(7,7,7,.99));box-shadow:0 35px 100px rgba(0,0,0,.68)}
      .progression-modal-icon{width:62px;height:62px;margin:0 auto 12px;display:grid;place-items:center;border-radius:50%;color:#f1ce78;border:1px solid rgba(230,190,92,.48);background:radial-gradient(circle at 35% 30%,rgba(216,177,93,.24),rgba(14,10,5,.95));font-size:24px}
      .progression-modal h3{margin:0 0 8px;color:#f5ead5;font-size:21px;font-weight:900}.progression-modal p{margin:0;color:#b8aa90;font-size:12px;line-height:1.75}.progression-modal strong{color:#e5c46f}
      .progression-summary{margin:15px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;text-align:left}.progression-summary>div{padding:10px;border-radius:14px;border:1px solid rgba(216,177,93,.13);background:rgba(255,255,255,.025)}.progression-summary span{display:block;color:#887c67;font-size:8px}.progression-summary b{display:block;margin-top:3px;color:#ead9af;font-size:13px}
      .progression-modal button{width:100%;min-height:44px;margin-top:16px;border-radius:15px;color:#fff1c9;border:1px solid #d8b15d;background:linear-gradient(135deg,#a87827,#5c3a0d);font-size:12px;font-weight:900}
      .revival-pill-card{grid-column:span 2;display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px;border-radius:17px;border:1px solid rgba(216,177,93,.25);background:linear-gradient(145deg,rgba(19,16,10,.94),rgba(8,8,8,.96))}
      .revival-pill-orb{width:50px;height:50px;display:grid;place-items:center;border-radius:50%;color:#ffdf86;font-size:20px;border:1px solid rgba(247,205,101,.62);background:radial-gradient(circle at 35% 28%,#f7d873 0 7%,#9c6018 25%,#3b1e08 70%,#130a03 100%);box-shadow:0 0 25px rgba(216,177,93,.25)}
      .revival-pill-copy strong{display:block;color:#f2e5c8;font-size:12px}.revival-pill-copy small{display:block;margin-top:3px;color:#958872;font-size:9px;line-height:1.4}.revival-pill-count{color:#d9b85e!important}.revival-pill-use{min-height:36px;padding:0 11px;border-radius:12px;color:#f7e5b3;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.08);font-size:9px;font-weight:900}.revival-pill-use:disabled{opacity:.45}
      @media(max-width:520px){.revival-pill-card{grid-template-columns:46px minmax(0,1fr)}.revival-pill-orb{width:43px;height:43px}.revival-pill-use{grid-column:1/-1;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function modal({ icon = '◆', title, body, summary = '', button = '知道了' }) {
    ensureStyle();
    document.getElementById('progression-v2-modal')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'progression-v2-modal';
    backdrop.className = 'progression-modal-backdrop';
    backdrop.innerHTML = `<section class="progression-modal" role="dialog" aria-modal="true"><div class="progression-modal-icon">${icon}</div><h3>${title}</h3><p>${body}</p>${summary}<button type="button">${button}</button></section>`;
    backdrop.querySelector('button')?.addEventListener('click', () => backdrop.remove());
    document.body.appendChild(backdrop);
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'xiuxian-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 2400);
  }

  function showLocked(kind = '多人功能') {
    const left = Math.max(0, FOUNDATION_SCORE - score());
    modal({
      icon: '<i class="fa-solid fa-lock"></i>',
      title: `${kind}尚未開啟`,
      body: `修士需先達到 <strong>築基初期（${FOUNDATION_SCORE} 修為）</strong> 才能使用配對、鬥法與仙盟等多人功能。<br>目前尚差 <strong>${left} 修為</strong>。`,
      button: '繼續修煉'
    });
  }

  async function ensureLegacyMigration() {
    if (migrating) return;
    const data = userData();
    let auth;
    try { auth = getAuth(getApp()); } catch (_) { return; }
    const user = auth.currentUser;
    if (!data?.stats || !user) return;
    if (migratedUid === user.uid) return;

    const existing = data[MIGRATION_FIELD];
    if (Number(existing?.version) >= MIGRATION_VERSION) {
      migratedUid = user.uid;
      return;
    }

    migrating = true;
    try {
      const originalScore = Math.max(0, Number(data.stats.totalScore) || 0);
      const eligible = originalScore >= LEGACY_HIGH_REALM_SCORE;
      const now = Date.now();

      if (!eligible) {
        const marker = { version: MIGRATION_VERSION, eligible: false, checkedAt: now };
        await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), { [MIGRATION_FIELD]: marker });
        data[MIGRATION_FIELD] = marker;
        migratedUid = user.uid;
        window.dispatchEvent(new CustomEvent('xiuxian:migration-ready', { detail: marker }));
        return;
      }

      const deducted = Math.max(0, originalScore - FOUNDATION_SCORE);
      const grantedPills = Math.ceil((deducted / 2) / PILL_GAIN);
      const spiritStones = Math.round((deducted / 2) * 2);
      const newGold = Math.max(0, Number(data.stats.gold) || 0) + spiritStones;
      const newPills = pillCount() + grantedPills;
      const marker = {
        version: MIGRATION_VERSION,
        eligible: true,
        originalScore,
        resetScore: FOUNDATION_SCORE,
        deducted,
        revivalPills: grantedPills,
        spiritStones,
        migratedAt: now
      };

      await updateDoc(doc(getFirestore(getApp()), 'users', user.uid), {
        'stats.totalScore': FOUNDATION_SCORE,
        'stats.rankLevel': realmIndexFor(FOUNDATION_SCORE),
        'stats.gold': newGold,
        [`stats.${PILL_FIELD}`]: newPills,
        [MIGRATION_FIELD]: marker
      });

      data.stats.totalScore = FOUNDATION_SCORE;
      data.stats.rankLevel = realmIndexFor(FOUNDATION_SCORE);
      data.stats.gold = newGold;
      data.stats[PILL_FIELD] = newPills;
      data[MIGRATION_FIELD] = marker;
      migratedUid = user.uid;

      const displayScore = document.getElementById('display-score');
      if (displayScore) displayScore.textContent = String(FOUNDATION_SCORE);
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { totalScore: FOUNDATION_SCORE, gold: newGold, migration: true } }));
      window.dispatchEvent(new CustomEvent('xiuxian:migration-ready', { detail: marker }));
      window.refreshCultivationRealmUI?.();

      modal({
        icon: '<i class="fa-solid fa-scroll"></i>',
        title: '舊版更新補償',
        body: '因金丹機制與後期境界重新平衡，舊版已達金丹以上的修士統一回調至築基初期。被扣除修為的一半折算為 <strong>回魂聚靈丹</strong>（每顆 +100 修為，無條件進位），另一半乘 2 折算為靈石。回魂聚靈丹可在 <strong>修煉 → 背包</strong> 使用。',
        summary: `<div class="progression-summary"><div><span>原修為</span><b>${originalScore.toLocaleString()}</b></div><div><span>調整後</span><b>${FOUNDATION_SCORE} · 築基初期</b></div><div><span>回魂聚靈丹</span><b>× ${grantedPills}</b></div><div><span>補償靈石</span><b>+${spiritStones.toLocaleString()}</b></div></div>`
      });
    } catch (error) {
      console.error('Progression migration failed:', error);
    } finally {
      migrating = false;
    }
  }

  async function useRevivalPill() {
    if (pillBusy || pillCount() <= 0) return;
    const data = userData();
    let auth;
    try { auth = getAuth(getApp()); } catch (_) { return; }
    const user = auth.currentUser;
    if (!data?.stats || !user) return;

    pillBusy = true;
    syncInventoryCard();
    const newScore = Math.max(0, Number(data.stats.totalScore) || 0) + PILL_GAIN;
    const newCount = pillCount() - 1;

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
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { totalScore: newScore, revivalPills: newCount } }));
      window.refreshCultivationRealmUI?.();
      toast(`服用回魂聚靈丹，修為 +${PILL_GAIN}`);
    } catch (error) {
      console.error('Use revival pill failed:', error);
      toast('丹藥服用失敗，請稍後再試。');
    } finally {
      pillBusy = false;
      syncInventoryCard(true);
    }
  }

  function syncInventoryCard(force = false) {
    const container = document.getElementById('settings-inventory-grid');
    if (!container) return;
    const count = pillCount();
    const existing = document.getElementById('revival-pill-card');

    if (count <= 0) {
      existing?.remove();
      return;
    }

    const signature = `${count}:${pillBusy ? 1 : 0}`;
    if (!force && existing?.dataset.signature === signature) return;

    ensureStyle();
    const card = existing || document.createElement('div');
    card.id = 'revival-pill-card';
    card.className = 'revival-pill-card';
    card.dataset.signature = signature;
    card.innerHTML = `<div class="revival-pill-orb">丹</div><div class="revival-pill-copy"><strong>回魂聚靈丹 <span class="revival-pill-count">× ${count}</span></strong><small>舊版更新補償 · 服用一顆立即增加 ${PILL_GAIN} 修為。</small></div><button type="button" class="revival-pill-use" ${pillBusy ? 'disabled' : ''}>${pillBusy ? '服用中…' : `服用 +${PILL_GAIN}`}</button>`;
    card.querySelector('.revival-pill-use')?.addEventListener('click', useRevivalPill);
    if (!existing) container.prepend(card);
  }

  function wrapMultiplayer() {
    const current = window.startBattleMatchmaking;
    if (typeof current !== 'function' || current.__foundationGuarded) return;
    const guarded = function (...args) {
      if (score() < FOUNDATION_SCORE) {
        showLocked('鬥法配對');
        return;
      }
      return current.apply(this, args);
    };
    Object.defineProperty(guarded, '__foundationGuarded', { value: true });
    window.startBattleMatchmaking = guarded;
  }

  function markLock(button, locked) {
    if (!button) return;
    button.classList.toggle('progression-locked', locked);
    let badge = button.querySelector(':scope > .progression-lock-badge');
    if (locked && !badge) {
      badge = document.createElement('span');
      badge.className = 'progression-lock-badge';
      badge.innerHTML = '<i class="fa-solid fa-lock"></i>';
      button.appendChild(badge);
    } else if (!locked) {
      badge?.remove();
    }
  }

  function syncMultiplayerLocks() {
    const locked = score() < FOUNDATION_SCORE;
    document.querySelectorAll('button[onclick*="startBattleMatchmaking"]').forEach((button) => markLock(button, locked));
    markLock(document.getElementById('btn-social-nav'), locked);
  }

  function interceptLockedClicks(event) {
    if (score() >= FOUNDATION_SCORE) return;
    const target = event.target?.closest?.('#btn-social-nav,[data-target="page-social"],[id^="btn-acc-"]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    showLocked(target.id?.startsWith('btn-acc-') ? '接受鬥法邀請' : '仙盟');
  }

  function exposeRules() {
    window.XIUXIAN_UNLOCKS = Object.freeze({ multiplayer: FOUNDATION_SCORE, goldenCore: GOLDEN_CORE_SCORE });
    window.getXiuxianRealmIndex = realmIndexFor;
  }

  function sync() {
    exposeRules();
    wrapMultiplayer();
    syncMultiplayerLocks();
    syncInventoryCard();
    ensureLegacyMigration();
  }

  function boot() {
    ensureStyle();
    exposeRules();
    document.addEventListener('click', interceptLockedClicks, true);
    sync();
    setInterval(sync, 500);
    new MutationObserver(() => {
      syncMultiplayerLocks();
      syncInventoryCard();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();