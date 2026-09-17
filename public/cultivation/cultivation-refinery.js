import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { ARTIFACT_CATALOG, getArtifactById } from './artifact-catalog.js';
import { MATERIAL_CATALOG, ARTIFACT_RECIPES, getMaterialById, getArtifactRecipe } from './material-catalog.js';

// 修煉頁煉器：左側材料庫，右側 8 個單一材料槽。
// 配方比對只看各材料數量，不看格子順序；投入材料必須與某一法寶配方完全相同。
(function () {
  'use strict';

  const SLOT_COUNT = 8;
  const TAB_VALUE = 'refinery';
  const MATERIAL_FIELD = 'materialSystem';
  const ARTIFACT_FIELD = 'artifactSystem';
  const selectedSlots = Array(SLOT_COUNT).fill(null);
  let busy = false;
  let active = false;
  let renderQueued = false;

  function userData() { return window.getCurrentUserData?.() || null; }
  function authUser() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  function database() { return getFirestore(getApp()); }
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function toast(message, ok = true) {
    document.getElementById('cultivation-refinery-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'cultivation-refinery-toast';
    el.textContent = message;
    el.style.cssText = `position:fixed;left:50%;bottom:135px;z-index:10200;max-width:calc(100vw - 28px);transform:translateX(-50%);padding:10px 15px;border:1px solid ${ok ? 'rgba(216,177,93,.48)' : 'rgba(248,113,113,.5)'};border-radius:999px;background:rgba(8,8,8,.97);color:${ok ? '#f5dda0' : '#fecaca'};font-size:10px;font-weight:900;box-shadow:0 16px 48px rgba(0,0,0,.55)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function normalizeMaterials(raw = {}) {
    const inventory = {};
    Object.entries(raw?.inventory || {}).forEach(([id, value]) => {
      const qty = Math.max(0, Math.floor(Number(value) || 0));
      if (qty > 0) inventory[id] = qty;
    });
    return { inventory };
  }

  function materialInventory() {
    return normalizeMaterials(userData()?.[MATERIAL_FIELD] || {}).inventory;
  }

  function ownedQuantity(materialId) {
    return Math.max(0, Number(materialInventory()[materialId]) || 0);
  }

  function selectedCounts() {
    const counts = {};
    selectedSlots.forEach((materialId) => {
      if (!materialId) return;
      counts[materialId] = (counts[materialId] || 0) + 1;
    });
    return counts;
  }

  function countKey(counts) {
    return Object.entries(counts || {})
      .filter(([, qty]) => Number(qty) > 0)
      .map(([id, qty]) => [String(id), Math.floor(Number(qty) || 0)])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, qty]) => `${id}:${qty}`)
      .join('|');
  }

  function recipeCounts(recipe) {
    const counts = {};
    (recipe || []).forEach((row) => {
      const materialId = String(row?.materialId || '').trim();
      const quantity = Math.max(0, Math.floor(Number(row?.quantity) || 0));
      if (materialId && quantity > 0) counts[materialId] = (counts[materialId] || 0) + quantity;
    });
    return counts;
  }

  function recipeTotal(recipe) {
    return (recipe || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.quantity) || 0)), 0);
  }

  function matchingArtifacts() {
    const key = countKey(selectedCounts());
    if (!key) return [];
    return ARTIFACT_CATALOG.filter((artifact) => {
      const recipe = getArtifactRecipe(artifact.id);
      return recipe.length && recipeTotal(recipe) <= SLOT_COUNT && countKey(recipeCounts(recipe)) === key;
    });
  }

  function ensureStyle() {
    if (document.getElementById('cultivation-refinery-style')) return;
    const style = document.createElement('style');
    style.id = 'cultivation-refinery-style';
    style.textContent = `
      #page-settings #artifact-forge-card,#page-settings #material-store-card{display:none!important}
      .cultivation-refinery{width:min(100%,980px);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
      .refinery-panel{min-width:0;padding:14px;border:1px solid rgba(216,177,93,.2);border-radius:18px;background:linear-gradient(145deg,rgba(21,17,10,.96),rgba(7,7,7,.97));box-shadow:0 16px 42px rgba(0,0,0,.3)}
      .refinery-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.refinery-panel-head h3{margin:0;color:#f1e1bc;font-size:13px}.refinery-panel-head p{margin:4px 0 0;color:#8d816c;font-size:8px;line-height:1.55}.refinery-count{padding:5px 8px;border:1px solid rgba(216,177,93,.15);border-radius:999px;color:#cdb46f;font-size:7px;white-space:nowrap}
      .refinery-material-list{display:grid;gap:7px;max-height:430px;overflow:auto;padding-right:3px}.refinery-material{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:9px;align-items:center;width:100%;padding:9px;border:1px solid rgba(255,255,255,.065);border-radius:12px;background:rgba(255,255,255,.018);text-align:left}.refinery-material:not(:disabled):hover{border-color:rgba(216,177,93,.36);background:rgba(216,177,93,.055)}.refinery-material:disabled{opacity:.4;cursor:not-allowed}.refinery-material-icon{width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(216,177,93,.25);border-radius:11px;background:#171006;color:#efd17c;font-size:12px;font-weight:900}.refinery-material-copy strong{display:block;color:#ede1c8;font-size:10px}.refinery-material-copy small{display:block;margin-top:3px;color:#81745f;font-size:7px;line-height:1.4}.refinery-material-qty{color:#d5b96e;font-size:8px;font-weight:900;white-space:nowrap}
      .refinery-empty-materials{padding:22px 12px;text-align:center;color:#82745f;font-size:9px;border:1px dashed rgba(216,177,93,.13);border-radius:13px}
      .refinery-slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}.refinery-slot{aspect-ratio:1;min-height:72px;display:grid;place-items:center;padding:6px;border:1px solid rgba(216,177,93,.18);border-radius:13px;background:radial-gradient(circle at 50% 35%,rgba(216,177,93,.07),rgba(255,255,255,.012));color:#6f6657;position:relative}.refinery-slot.filled{border-color:rgba(216,177,93,.42);color:#efd17c;background:radial-gradient(circle at 50% 35%,rgba(216,177,93,.14),rgba(38,24,6,.18))}.refinery-slot-icon{font-size:17px;font-weight:900}.refinery-slot-name{margin-top:3px;color:#d9c89f;font-size:6px;line-height:1.25;text-align:center}.refinery-slot-index{position:absolute;top:5px;left:6px;color:#675c4d;font-size:6px}.refinery-slot-remove{position:absolute;top:4px;right:5px;color:#a98566;font-size:7px}
      .refinery-selection-summary{min-height:35px;padding:8px 9px;border-radius:11px;background:rgba(216,177,93,.035);color:#93846d;font-size:8px;line-height:1.6}.refinery-selection-summary strong{color:#d5bb79}.refinery-match{margin-top:8px;padding:9px;border:1px solid rgba(216,177,93,.13);border-radius:11px;color:#93846d;font-size:8px;line-height:1.55}.refinery-match.ready{border-color:rgba(134,239,172,.2);color:#b9d6b4}.refinery-match.error{border-color:rgba(248,113,113,.18);color:#d7a0a0}.refinery-match b{color:#ead79f}.refinery-actions{display:flex;gap:8px;margin-top:10px}.refinery-clear,.refinery-craft{min-height:42px;border-radius:12px;font-size:9px;font-weight:900}.refinery-clear{width:34%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.025);color:#9f9585}.refinery-craft{flex:1;border:1px solid rgba(216,177,93,.42);background:linear-gradient(135deg,#8f651e,#4b2f09);color:#fff0bd}.refinery-craft:disabled,.refinery-clear:disabled{opacity:.4;cursor:not-allowed}
      .refinery-footnote{margin-top:8px;color:#6f6556;font-size:7px;line-height:1.55}.refinery-footnote b{color:#aa9360}
      @media(max-width:760px){.cultivation-refinery{grid-template-columns:1fr}.refinery-material-list{max-height:300px}.refinery-slots{grid-template-columns:repeat(4,minmax(58px,1fr))}.refinery-slot{min-height:62px}}
      @media(max-width:430px){.refinery-slots{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.refinery-slot{min-height:55px;border-radius:10px}.refinery-material{grid-template-columns:38px minmax(0,1fr) auto}.refinery-material-icon{width:36px;height:36px}}
    `;
    document.head.appendChild(style);
  }

  function foundationBagMarkup() {
    return '<section class="training-v3-empty foundation-training-bag"><i class="fa-solid fa-box-open"></i><h3>修煉背包</h3><p>修煉途中取得的特殊物品會收納於此。</p></section>';
  }

  function activateRefinery(page) {
    active = true;
    page.querySelectorAll('[data-training-tab]').forEach((tab) => {
      const selected = tab.dataset.trainingTab === TAB_VALUE;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    renderRefinery();
  }

  function bindNativeExit(page, button) {
    if (button.dataset.refineryExitBound === '1') return;
    button.dataset.refineryExitBound = '1';
    button.addEventListener('click', () => {
      active = false;
      if (page.dataset.foundationTraining === '1' && button.dataset.trainingTab === 'bag') {
        page.querySelectorAll('[data-training-tab]').forEach((tab) => {
          const selected = tab === button;
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        const content = page.querySelector('#training-tab-content');
        if (content) content.innerHTML = foundationBagMarkup();
        window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { refineryTabClosed: true } }));
      }
    });
  }

  function ensureRefineryTab() {
    const page = document.getElementById('page-training');
    const tabs = page?.querySelector('.training-subtabs-v3');
    const bag = tabs?.querySelector('[data-training-tab="bag"]');
    if (!page || !tabs || !bag) return;

    let refinery = tabs.querySelector(`[data-training-tab="${TAB_VALUE}"]`);
    if (!refinery) {
      refinery = document.createElement('button');
      refinery.type = 'button';
      refinery.className = 'training-subtab-v3';
      refinery.dataset.trainingTab = TAB_VALUE;
      refinery.setAttribute('aria-selected', 'false');
      refinery.innerHTML = '<i class="fa-solid fa-hammer"></i><span>煉器</span>';
      bag.before(refinery);
      refinery.addEventListener('click', () => activateRefinery(page));
    }

    tabs.querySelectorAll('[data-training-tab]').forEach((button) => {
      if (button.dataset.trainingTab !== TAB_VALUE) bindNativeExit(page, button);
    });

    if (active && refinery.closest('#page-training') === page) renderRefinery();
  }

  function selectedSummary() {
    const counts = selectedCounts();
    const parts = Object.entries(counts).map(([id, quantity]) => `${getMaterialById(id)?.name || id} ×${quantity}`);
    return parts.length ? parts.join(' · ') : '尚未投入材料';
  }

  function matchDescription(matches) {
    const total = selectedSlots.filter(Boolean).length;
    if (!total) return { cls: '', html: '放入材料後，系統會依「各材料數量」自動辨識法寶配方。' };
    if (matches.length === 1) {
      const item = matches[0];
      return { cls: 'ready', html: `<b>配方吻合：</b>${escapeHtml(item.icon || '◆')} ${escapeHtml(item.name)} · 將煉製 ×${Math.max(1, Math.floor(Number(item.craft?.yield) || 1))}` };
    }
    if (matches.length > 1) return { cls: 'error', html: '目前材料數量同時符合多個法寶配方，請管理員調整成唯一配方後再煉製。' };
    return { cls: 'error', html: '目前 8 格中的材料數量沒有符合任何法寶配方。格子順序不影響判定。' };
  }

  function refineryMarkup() {
    const inventory = materialInventory();
    const counts = selectedCounts();
    const materials = MATERIAL_CATALOG.filter((material) => Math.max(0, Number(inventory[material.id]) || 0) > 0);
    const matches = matchingArtifacts();
    const match = matchDescription(matches);
    const usedSlots = selectedSlots.filter(Boolean).length;

    const materialMarkup = materials.length ? materials.map((material) => {
      const owned = Math.max(0, Number(inventory[material.id]) || 0);
      const placed = Math.max(0, Number(counts[material.id]) || 0);
      const remaining = Math.max(0, owned - placed);
      const disabled = remaining <= 0 || usedSlots >= SLOT_COUNT || busy;
      return `<button type="button" class="refinery-material" data-refinery-material="${escapeHtml(material.id)}" ${disabled ? 'disabled' : ''}><span class="refinery-material-icon">${escapeHtml(material.icon || '材')}</span><span class="refinery-material-copy"><strong>${escapeHtml(material.name)}</strong><small>${escapeHtml(material.category || '材料')} · 已放入 ${placed}</small></span><span class="refinery-material-qty">可用 ${remaining}/${owned}</span></button>`;
    }).join('') : '<div class="refinery-empty-materials"><i class="fa-solid fa-box-open"></i><br><br>目前沒有可投入的煉器材料。<br>可透過問道與洞天取得材料。</div>';

    const slotsMarkup = selectedSlots.map((materialId, index) => {
      const material = materialId ? getMaterialById(materialId) : null;
      return material
        ? `<button type="button" class="refinery-slot filled" data-refinery-slot="${index}" title="點擊取回材料"><span class="refinery-slot-index">${index + 1}</span><span class="refinery-slot-remove">×</span><span><span class="refinery-slot-icon">${escapeHtml(material.icon || '材')}</span><span class="refinery-slot-name">${escapeHtml(material.name)}</span></span></button>`
        : `<button type="button" class="refinery-slot" data-refinery-slot="${index}" disabled><span class="refinery-slot-index">${index + 1}</span><span class="refinery-slot-icon">＋</span></button>`;
    }).join('');

    return `<section class="cultivation-refinery" data-refinery-signature="${escapeHtml(countKey(counts))}"><article class="refinery-panel"><div class="refinery-panel-head"><div><h3><i class="fa-solid fa-gem"></i> 持有材料</h3><p>點擊材料即可放入右側第一個空的煉器格。</p></div><span class="refinery-count">${materials.length} 種材料</span></div><div class="refinery-material-list">${materialMarkup}</div></article><article class="refinery-panel"><div class="refinery-panel-head"><div><h3><i class="fa-solid fa-fire-burner"></i> 八方煉器陣</h3><p>共 8 格，每格只能放 1 個材料。點已放入的格子可取回。</p></div><span class="refinery-count">${usedSlots}/${SLOT_COUNT}</span></div><div class="refinery-slots">${slotsMarkup}</div><div class="refinery-selection-summary"><strong>投入：</strong>${escapeHtml(selectedSummary())}</div><div class="refinery-match ${match.cls}">${match.html}</div><div class="refinery-actions"><button type="button" class="refinery-clear" data-refinery-clear ${!usedSlots || busy ? 'disabled' : ''}>清空</button><button type="button" class="refinery-craft" data-refinery-craft ${matches.length !== 1 || busy ? 'disabled' : ''}>${busy ? '煉製中…' : '<i class="fa-solid fa-fire"></i> 煉器'}</button></div><div class="refinery-footnote"><b>配方規則：</b>只比較每種材料的數量；排列位置完全不影響結果。投入的材料必須與配方完全一致，多一個或少一個都不成立。</div></article></section>`;
  }

  function renderRefinery() {
    if (!active) return;
    const page = document.getElementById('page-training');
    const content = page?.querySelector('#training-tab-content');
    const tab = page?.querySelector(`[data-training-tab="${TAB_VALUE}"]`);
    if (!page || !content || !tab) { active = false; return; }
    if (!tab.classList.contains('active')) return;
    content.innerHTML = refineryMarkup();
    content.querySelectorAll('[data-refinery-material]').forEach((button) => {
      button.addEventListener('click', () => addMaterial(button.dataset.refineryMaterial));
    });
    content.querySelectorAll('.refinery-slot.filled[data-refinery-slot]').forEach((button) => {
      button.addEventListener('click', () => removeSlot(Number(button.dataset.refinerySlot)));
    });
    content.querySelector('[data-refinery-clear]')?.addEventListener('click', clearSlots);
    content.querySelector('[data-refinery-craft]')?.addEventListener('click', craftSelectedRecipe);
  }

  function addMaterial(materialId) {
    if (busy) return;
    const firstEmpty = selectedSlots.findIndex((value) => !value);
    if (firstEmpty < 0) { toast('八個煉器格都已放滿。', false); return; }
    const owned = ownedQuantity(materialId);
    const placed = Math.max(0, Number(selectedCounts()[materialId]) || 0);
    if (placed >= owned) { toast('此材料沒有更多可投入的數量。', false); return; }
    selectedSlots[firstEmpty] = materialId;
    renderRefinery();
  }

  function removeSlot(index) {
    if (busy || index < 0 || index >= SLOT_COUNT) return;
    selectedSlots[index] = null;
    renderRefinery();
  }

  function clearSlots() {
    if (busy) return;
    selectedSlots.fill(null);
    renderRefinery();
  }

  async function craftSelectedRecipe() {
    if (busy) return;
    const matches = matchingArtifacts();
    if (matches.length !== 1) { toast('目前材料數量沒有對應到唯一法寶配方。', false); return; }
    const artifact = matches[0];
    const recipe = getArtifactRecipe(artifact.id);
    const expectedKey = countKey(recipeCounts(recipe));
    const selectedKey = countKey(selectedCounts());
    if (!expectedKey || expectedKey !== selectedKey) { toast('材料配方已改變，請重新放入材料。', false); return; }
    const user = authUser();
    if (!user) { toast('尚未登入。', false); return; }

    busy = true;
    renderRefinery();
    try {
      let committedMaterials = null;
      let committedArtifacts = null;
      await runTransaction(database(), async (tx) => {
        const ref = doc(database(), 'users', user.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('玩家資料不存在');
        const raw = snap.data();
        const materials = normalizeMaterials(raw[MATERIAL_FIELD] || {});
        const needed = recipeCounts(recipe);

        for (const [materialId, quantity] of Object.entries(needed)) {
          const have = Math.max(0, Number(materials.inventory[materialId]) || 0);
          if (have < quantity) throw new Error(`${getMaterialById(materialId)?.name || materialId} 數量不足`);
        }
        for (const [materialId, quantity] of Object.entries(needed)) {
          const remain = Math.max(0, Number(materials.inventory[materialId]) || 0) - quantity;
          if (remain > 0) materials.inventory[materialId] = remain;
          else delete materials.inventory[materialId];
        }

        const artifactSystem = raw[ARTIFACT_FIELD] && typeof raw[ARTIFACT_FIELD] === 'object'
          ? { ...raw[ARTIFACT_FIELD] }
          : {};
        artifactSystem.inventory = { ...(artifactSystem.inventory || {}) };
        const gain = Math.max(1, Math.floor(Number(artifact.craft?.yield) || 1));
        artifactSystem.inventory[artifact.id] = (Number(artifactSystem.inventory[artifact.id]) || 0) + gain;

        committedMaterials = materials;
        committedArtifacts = artifactSystem;
        tx.update(ref, { [MATERIAL_FIELD]: materials, [ARTIFACT_FIELD]: artifactSystem });
      });

      const data = userData();
      if (data) {
        data[MATERIAL_FIELD] = committedMaterials;
        data[ARTIFACT_FIELD] = committedArtifacts;
      }
      selectedSlots.fill(null);
      window.dispatchEvent(new CustomEvent('material-system-updated', { detail: committedMaterials }));
      window.dispatchEvent(new CustomEvent('artifact-system-updated', { detail: committedArtifacts }));
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', { detail: { artifactCrafted: artifact.id, refineryCrafted: true } }));
      toast(`煉器成功：${artifact.name} ×${Math.max(1, Math.floor(Number(artifact.craft?.yield) || 1))}`);
    } catch (error) {
      console.error('[Cultivation refinery]', error);
      toast(error.message || '煉器失敗，請稍後再試。', false);
    } finally {
      busy = false;
      renderRefinery();
    }
  }

  function reconcileSlotsWithInventory() {
    const inventory = materialInventory();
    const seen = {};
    let changed = false;
    selectedSlots.forEach((materialId, index) => {
      if (!materialId) return;
      seen[materialId] = (seen[materialId] || 0) + 1;
      if (!getMaterialById(materialId) || seen[materialId] > (Number(inventory[materialId]) || 0)) {
        selectedSlots[index] = null;
        changed = true;
      }
    });
    return changed;
  }

  function scheduleSync() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      ensureStyle();
      ensureRefineryTab();
      if (reconcileSlotsWithInventory() && active) renderRefinery();
      else if (active) renderRefinery();
    });
  }

  function boot() {
    ensureStyle();
    scheduleSync();
    window.addEventListener('foundation-training-stage-changed', scheduleSync);
    window.addEventListener('golden-core-access-changed', scheduleSync);
    window.addEventListener('material-system-updated', scheduleSync);
    window.addEventListener('material-catalog-updated', scheduleSync);
    window.addEventListener('artifact-catalog-updated', scheduleSync);
    window.addEventListener('artifact-recipes-updated', scheduleSync);
    window.addEventListener('xiuxian:user-ready', scheduleSync);
    new MutationObserver(() => scheduleSync()).observe(document.body, { childList: true, subtree: true });
  }

  window.getCultivationRefinerySelection = () => [...selectedSlots];
  window.getCultivationRefineryMatch = () => matchingArtifacts().map((item) => item.id);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
