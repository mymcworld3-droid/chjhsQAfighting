import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 共用修煉背包：回魂聚靈丹是一般消耗道具，不屬於金丹系統。
(function () {
  'use strict';

  const PILL_FIELD = 'revivalPills';
  const PILL_GAIN = 100;
  const ITEM_ID = 'training-revival-pill-item';
  let busy = false;
  let queued = false;

  function userData() {
    return window.getCurrentUserData?.() || null;
  }

  function pillCount() {
    return Math.max(0, Number(userData()?.stats?.[PILL_FIELD]) || 0);
  }

  function realmIndexFor(score) {
    if (typeof window.getXiuxianRealmIndex === 'function') {
      return window.getXiuxianRealmIndex(score);
    }
    return Math.max(0, Number(userData()?.stats?.rankLevel) || 0);
  }

  function ensureStyle() {
    if (document.getElementById('cultivation-inventory-style')) return;
    const style = document.createElement('style');
    style.id = 'cultivation-inventory-style';
    style.textContent = `
      #settings-inventory-grid #revival-pill-card{display:none!important}
      .cultivation-inventory-grid{width:min(100%,620px);margin:0 auto;display:grid;gap:12px}
      .cultivation-item-card{display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:12px;width:100%;padding:14px;border-radius:18px;border:1px solid rgba(216,177,93,.28);background:linear-gradient(145deg,rgba(21,17,10,.96),rgba(7,7,7,.97));box-shadow:0 14px 34px rgba(0,0,0,.3)}
      .cultivation-item-icon{width:54px;height:54px;display:grid;place-items:center;border-radius:16px;color:#f8df99;border:1px solid rgba(240,198,91,.48);background:radial-gradient(circle at 34% 26%,#f3cf67 0 8%,#8c5315 30%,#281306 75%,#0b0602 100%);box-shadow:0 0 22px rgba(216,177,93,.2);font-size:19px;font-weight:900}
      .cultivation-item-copy{min-width:0}.cultivation-item-copy strong{display:block;color:#f2e6ca;font-size:13px}.cultivation-item-copy small{display:block;margin-top:4px;color:#a79980;font-size:10px;line-height:1.5}.cultivation-item-count{color:#dfbd68;margin-left:5px}
      .cultivation-item-use{min-height:38px;padding:0 13px;border-radius:12px;color:#f8e8b8;border:1px solid rgba(216,177,93,.4);background:linear-gradient(135deg,rgba(168,120,39,.26),rgba(66,39,8,.38));font-size:10px;font-weight:900;white-space:nowrap}.cultivation-item-use:hover{border-color:#e0ba61;background:rgba(216,177,93,.15)}.cultivation-item-use:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:520px){.cultivation-item-card{grid-template-columns:50px minmax(0,1fr)}.cultivation-item-icon{width:47px;height:47px}.cultivation-item-use{grid-column:1/-1;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'xiuxian-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.remove(), 2400);
  }

  function bagIsActive() {
    const page = document.getElementById('page-training');
    if (!page) return false;
    const bag = page.querySelector('[data-training-tab="bag"]');
    if (!bag) return false;
    if (page.dataset.foundationTraining === '1') return true;
    return bag.classList.contains('active') || bag.getAttribute('aria-selected') === 'true';
  }

  function itemMarkup(count) {
    return `
      <article id="${ITEM_ID}" class="cultivation-item-card" data-signature="${count}:${busy ? 1 : 0}">
        <div class="cultivation-item-icon" aria-hidden="true">丹</div>
        <div class="cultivation-item-copy">
          <strong>回魂聚靈丹 <span class="cultivation-item-count">× ${count}</span></strong>
          <small>消耗道具 · 每服用一顆，立即增加 ${PILL_GAIN} 修為。</small>
        </div>
        <button type="button" class="cultivation-item-use" ${busy ? 'disabled' : ''}>${busy ? '服用中…' : `服用 +${PILL_GAIN}`}</button>
      </article>
    `;
  }

  function ensureBagGrid(content) {
    let grid = content.querySelector('.training-v3-bag-grid, .cultivation-inventory-grid');
    if (grid) return grid;

    const empty = content.querySelector('.training-v3-empty');
    if (empty) empty.remove();

    grid = document.createElement('section');
    grid.className = 'training-v3-bag-grid cultivation-inventory-grid';
    content.appendChild(grid);
    return grid;
  }

  function restoreEmptyBagIfNeeded(content) {
    const grid = content.querySelector('.cultivation-inventory-grid');
    if (!grid || grid.children.length) return;
    grid.remove();
    if (!content.querySelector('.training-v3-empty')) {
      const empty = document.createElement('section');
      empty.className = 'training-v3-empty';
      empty.innerHTML = '<i class="fa-solid fa-box-open"></i><h3>背包尚空</h3><p>修煉途中取得的消耗道具會收納於此。</p>';
      content.appendChild(empty);
    }
  }

  function render() {
    queued = false;
    ensureStyle();
    const existing = document.getElementById(ITEM_ID);
    const content = document.getElementById('training-tab-content');
    const count = pillCount();

    if (!content || !bagIsActive() || count <= 0) {
      const oldContent = existing?.closest('#training-tab-content');
      existing?.remove();
      if (oldContent) restoreEmptyBagIfNeeded(oldContent);
      return;
    }

    const signature = `${count}:${busy ? 1 : 0}`;
    if (existing?.dataset.signature === signature && existing.closest('#training-tab-content') === content) return;

    const grid = ensureBagGrid(content);
    if (existing) existing.remove();
    grid.insertAdjacentHTML('afterbegin', itemMarkup(count));
    document.querySelector(`#${ITEM_ID} .cultivation-item-use`)?.addEventListener('click', useRevivalPill);
  }

  function scheduleRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  async function useRevivalPill() {
    if (busy || pillCount() <= 0) return;
    const data = userData();
    let user;
    try { user = getAuth(getApp()).currentUser; } catch (_) { return; }
    if (!data?.stats || !user) return;

    busy = true;
    render();

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
      render();
    }
  }

  function rewriteLegacyCompensationCopy() {
    const p = document.querySelector('#progression-v2-modal .progression-modal p');
    if (p && p.innerHTML.includes('洞府 → 法寶庫')) {
      p.innerHTML = p.innerHTML.replace('洞府 → 法寶庫', '修煉 → 背包');
    }
  }

  window.getCultivationInventoryItems = function () {
    const count = pillCount();
    return count > 0 ? [{
      id: 'revival-pill',
      name: '回魂聚靈丹',
      type: 'consumable',
      quantity: count,
      cultivationGain: PILL_GAIN
    }] : [];
  };
  window.useRevivalPillItem = useRevivalPill;

  function boot() {
    ensureStyle();
    scheduleRender();

    window.addEventListener('xiuxian:stats-updated', scheduleRender);
    window.addEventListener('foundation-training-stage-changed', scheduleRender);
    window.addEventListener('golden-core-access-changed', scheduleRender);

    new MutationObserver(() => {
      rewriteLegacyCompensationCopy();
      scheduleRender();
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      rewriteLegacyCompensationCopy();
      scheduleRender();
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
