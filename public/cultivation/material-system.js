import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getArtifactById } from './artifact-catalog.js';
import { MATERIAL_CATALOG, getMaterialById, getArtifactRecipe } from './material-catalog.js';

// 玩家材料庫與「金幣 + 材料」法寶合成。
// 材料獨立存於 materialSystem，避免舊 artifactSystem 正規化時誤刪材料資料。
(function () {
  'use strict';

  const FIELD = 'materialSystem';
  const CARD_ID = 'material-store-card';
  let purchaseBusy = '';
  let craftBusy = '';
  let renderQueued = false;

  function userData() { return window.getCurrentUserData?.() || null; }
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function database() { return getFirestore(getApp()); }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function normalizeMaterialSystem(raw = {}) {
    const inventory = {};
    Object.entries(raw?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    return { inventory };
  }
  function materialState() { return normalizeMaterialSystem(userData()?.[FIELD] || {}); }
  function materialQuantity(materialId) { return Math.max(0, Number(materialState().inventory[materialId]) || 0); }
  function toast(message, ok = true) {
    document.getElementById('material-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'material-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:135px;z-index:10100;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid ${ok ? 'rgba(216,177,93,.42)' : 'rgba(248,113,113,.5)'};border-radius:999px;background:rgba(8,8,8,.97);color:${ok ? '#f5dda0' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  function setLocalMaterialState(next) {
    const data = userData();
    if (data) data[FIELD] = normalizeMaterialSystem(next);
    window.dispatchEvent(new CustomEvent('material-system-updated', { detail: normalizeMaterialSystem(next) }));
    scheduleRender();
  }

  function ensureStyle() {
    if (document.getElementById('material-system-style')) return;
    const style = document.createElement('style');
    style.id = 'material-system-style';
    style.textContent = `
      #${CARD_ID}{padding:14px;border:1px solid rgba(216,177,93,.16);border-radius:16px;background:linear-gradient(145deg,rgba(19,16,11,.94),rgba(7,7,7,.97))}
      .material-store-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.material-store-head h3{margin:0;color:#f0dfb6;font-size:12px}.material-store-head p{margin:4px 0 0;color:#827660;font-size:7px;line-height:1.5}.material-store-gold{padding:6px 9px;border-radius:999px;border:1px solid rgba(216,177,93,.15);color:#d9bd73;font-size:8px;white-space:nowrap}
      .material-store-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.material-store-item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.016)}.material-store-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;border:1px solid rgba(216,177,93,.22);background:#171006;color:#efd17c;font-weight:900}.material-store-copy{min-width:0}.material-store-copy b{display:block;color:#eadfc8;font-size:9px}.material-store-copy span{display:block;margin-top:2px;color:#877961;font-size:6px}.material-store-copy small{display:block;margin-top:3px;color:#b59c62;font-size:7px}.material-buy{min-height:32px;padding:0 8px;border-radius:9px;border:1px solid rgba(216,177,93,.23);background:rgba(216,177,93,.06);color:#e4cc8a;font-size:7px;font-weight:900}.material-buy:disabled{opacity:.38;cursor:not-allowed}
      .material-recipe-cost{grid-column:1/-1;padding:5px 7px;border-radius:8px;background:rgba(216,177,93,.035);color:#8f826b;font-size:6px;line-height:1.45;text-align:left}.material-recipe-cost b{color:#cdb16b}.material-recipe-cost .missing{color:#f2a3a3}.material-recipe-cost.no-recipe{color:#f3b0b0;border:1px solid rgba(248,113,113,.12)}
      @media(max-width:700px){.material-store-list{grid-template-columns:1fr}.material-store-head{flex-direction:column}.material-store-gold{align-self:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function mountCard() {
    if (document.getElementById(CARD_ID)) return;
    const page = document.getElementById('page-settings');
    if (!page) return;
    const forge = document.getElementById('artifact-forge-card');
    const analysis = page.querySelector('.dongfu-analysis-card') || page.querySelector('#knowledgeChart')?.closest('.glass-panel');
    const anchor = forge || analysis;
    if (!anchor) return;
    const card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'glass-panel rounded-2xl mb-6 relative overflow-hidden';
    card.innerHTML = '<div class="material-store-head"><div><h3><i class="fa-solid fa-gem"></i> 煉器材料庫</h3><p>先取得材料，再到煉器室以金幣與材料合成法寶。採購價為 0 的材料不可直接購買。</p></div><div class="material-store-gold" id="material-store-gold"></div></div><div id="material-store-list" class="material-store-list"></div>';
    anchor.before(card);
    card.addEventListener('click', (event) => {
      const button = event.target.closest('[data-material-buy]');
      if (button) buyMaterial(button.dataset.materialBuy).catch((error) => toast(error.message || '材料購買失敗', false));
    });
    renderCard();
  }

  function renderCard() {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    const gold = Math.max(0, Number(userData()?.stats?.gold) || 0);
    const goldNode = card.querySelector('#material-store-gold');
    if (goldNode) goldNode.textContent = `金幣 ${gold.toLocaleString()}`;
    const list = card.querySelector('#material-store-list');
    if (!list) return;
    list.innerHTML = MATERIAL_CATALOG.map((item) => {
      const qty = materialQuantity(item.id);
      const price = Math.max(0, Number(item.buyGold) || 0);
      const disabled = price <= 0 || purchaseBusy || gold < price;
      return `<article class="material-store-item"><div class="material-store-icon">${escapeHtml(item.icon || '材')}</div><div class="material-store-copy"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.category || '材料')}</span><small>持有 ×${qty}${price > 0 ? ` · 採購 ${price} 金幣` : ' · 不可直接採購'}</small></div><button type="button" class="material-buy" data-material-buy="${escapeHtml(item.id)}" ${disabled ? 'disabled' : ''}>${purchaseBusy === item.id ? '取得中…' : '取得 ×1'}</button></article>`;
    }).join('');
  }

  async function buyMaterial(materialId) {
    const item = getMaterialById(materialId);
    const user = authUser();
    if (!item || !user || purchaseBusy) return;
    const price = Math.max(0, Math.floor(Number(item.buyGold) || 0));
    if (price <= 0) throw new Error(`${item.name} 目前不可直接購買`);
    purchaseBusy = materialId;
    scheduleRender();
    try {
      let committed = null;
      let newGold = 0;
      await runTransaction(database(), async (tx) => {
        const ref = doc(database(), 'users', user.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('玩家資料不存在');
        const raw = snap.data();
        const gold = Math.max(0, Number(raw.stats?.gold) || 0);
        if (gold < price) throw new Error(`金幣不足，需要 ${price}`);
        const next = normalizeMaterialSystem(raw[FIELD] || {});
        next.inventory[materialId] = (Number(next.inventory[materialId]) || 0) + 1;
        newGold = gold - price;
        committed = next;
        tx.update(ref, { [FIELD]: next, 'stats.gold': newGold });
      });
      const data = userData();
      if (data?.stats) data.stats.gold = newGold;
      setLocalMaterialState(committed);
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { gold: newGold, materialBought: materialId } }));
      toast(`取得材料：${item.name} ×1`);
    } finally {
      purchaseBusy = '';
      scheduleRender();
    }
  }

  function recipeSummary(artifactId) {
    const recipe = getArtifactRecipe(artifactId);
    if (!recipe.length) return { recipe, text: '尚未設定合成材料配方', missing: true };
    let missing = false;
    const parts = recipe.map((row) => {
      const item = getMaterialById(row.materialId);
      const have = materialQuantity(row.materialId);
      const need = Math.max(1, Number(row.quantity) || 1);
      if (have < need) missing = true;
      return { text: `${item?.name || row.materialId} ${have}/${need}`, missing: have < need };
    });
    return { recipe, parts, missing };
  }

  function enhanceForge() {
    document.querySelectorAll('#artifact-forge-card [data-artifact-craft]').forEach((button) => {
      const artifactId = button.dataset.artifactCraft;
      const actions = button.closest('.artifact-actions');
      if (!actions || !artifactId) return;
      const summary = recipeSummary(artifactId);
      let note = actions.querySelector(`.material-recipe-cost[data-artifact-recipe="${CSS.escape(artifactId)}"]`);
      if (!note) {
        note = document.createElement('div');
        note.className = 'material-recipe-cost';
        note.dataset.artifactRecipe = artifactId;
        actions.appendChild(note);
      }
      const renderKey = !summary.recipe.length
        ? 'none'
        : summary.parts.map((part) => `${part.text}:${part.missing ? 1 : 0}`).join('|');
      if (note.dataset.renderKey !== renderKey) {
        note.dataset.renderKey = renderKey;
        if (!summary.recipe.length) {
          note.className = 'material-recipe-cost no-recipe';
          note.textContent = '尚未設定材料配方，暫時不能合成';
        } else {
          note.className = 'material-recipe-cost';
          note.innerHTML = `<b>材料：</b>${summary.parts.map((part) => `<span class="${part.missing ? 'missing' : ''}">${escapeHtml(part.text)}</span>`).join(' · ')}`;
        }
      }
      const shouldDisable = craftBusy === artifactId || summary.missing;
      if (shouldDisable) {
        if (!button.disabled) button.dataset.materialDisabled = '1';
        button.disabled = true;
      } else if (button.dataset.materialDisabled === '1') {
        button.disabled = false;
        delete button.dataset.materialDisabled;
      }
    });
  }

  async function craftWithMaterials(artifactId) {
    const item = getArtifactById(artifactId);
    const user = authUser();
    if (!item || !user || craftBusy) return;
    const recipe = getArtifactRecipe(artifactId);
    if (!recipe.length) throw new Error(`${item.name} 尚未設定材料配方`);
    const cost = Math.max(0, Math.floor(Number(item.craft?.gold) || 0));
    const gain = Math.max(1, Math.floor(Number(item.craft?.yield) || 1));
    craftBusy = artifactId;
    scheduleRender();
    try {
      let committedMaterials = null;
      let committedArtifacts = null;
      let newGold = 0;
      await runTransaction(database(), async (tx) => {
        const ref = doc(database(), 'users', user.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('玩家資料不存在');
        const raw = snap.data();
        const gold = Math.max(0, Number(raw.stats?.gold) || 0);
        if (gold < cost) throw new Error(`金幣不足，打造需要 ${cost}`);

        const materials = normalizeMaterialSystem(raw[FIELD] || {});
        for (const row of recipe) {
          const material = getMaterialById(row.materialId);
          const need = Math.max(1, Math.floor(Number(row.quantity) || 1));
          const have = Math.max(0, Number(materials.inventory[row.materialId]) || 0);
          if (!material) throw new Error(`配方材料已不存在：${row.materialId}`);
          if (have < need) throw new Error(`${material.name} 不足，需要 ${need}，目前 ${have}`);
        }
        for (const row of recipe) {
          const need = Math.max(1, Math.floor(Number(row.quantity) || 1));
          const remain = Math.max(0, Number(materials.inventory[row.materialId]) || 0) - need;
          if (remain > 0) materials.inventory[row.materialId] = remain;
          else delete materials.inventory[row.materialId];
        }

        const artifactSystem = raw.artifactSystem && typeof raw.artifactSystem === 'object' ? { ...raw.artifactSystem } : {};
        artifactSystem.inventory = { ...(artifactSystem.inventory || {}) };
        artifactSystem.inventory[artifactId] = (Number(artifactSystem.inventory[artifactId]) || 0) + gain;
        newGold = gold - cost;
        committedMaterials = materials;
        committedArtifacts = artifactSystem;
        tx.update(ref, { [FIELD]: materials, artifactSystem, 'stats.gold': newGold });
      });

      const data = userData();
      if (data) {
        data[FIELD] = committedMaterials;
        data.artifactSystem = committedArtifacts;
        if (data.stats) data.stats.gold = newGold;
      }
      window.dispatchEvent(new CustomEvent('material-system-updated', { detail: committedMaterials }));
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committedArtifacts }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { gold: newGold, artifactCrafted: artifactId } }));
      toast(`煉器成功：${item.name} ×${gain}`);
    } finally {
      craftBusy = '';
      scheduleRender();
    }
  }

  function interceptArtifactCraft(event) {
    const button = event.target?.closest?.('#artifact-forge-card [data-artifact-craft]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    craftWithMaterials(button.dataset.artifactCraft).catch((error) => toast(error.message || '法寶合成失敗', false));
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      ensureStyle();
      mountCard();
      renderCard();
      enhanceForge();
    });
  }

  function boot() {
    ensureStyle();
    scheduleRender();
    document.addEventListener('click', interceptArtifactCraft, true);
    window.addEventListener('artifact-system-updated', scheduleRender);
    window.addEventListener('artifact-catalog-updated', scheduleRender);
    window.addEventListener('material-catalog-updated', scheduleRender);
    window.addEventListener('artifact-recipes-updated', scheduleRender);
    window.addEventListener('xiuxian:stats-updated', scheduleRender);
    new MutationObserver(() => scheduleRender()).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
