import { ARTIFACT_CATALOG, getArtifactById, realmOrderByName } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  getMaterialById,
  materialRealmColor,
  materialRealmOrderByName
} from './material-catalog.js';

// 統一修煉背包：法寶、材料、消耗道具共用正方形格子；點擊後才顯示詳細資料。
(function () {
  'use strict';

  const ROOT_ID = 'unified-cultivation-bag';
  const MODAL_ID = 'unified-bag-detail-modal';
  const STYLE_ID = 'unified-inventory-grid-style';
  const TYPE_ORDER = Object.freeze({ artifact: 0, material: 1, consumable: 2, training: 3 });
  const REALM_COLORS = Object.freeze({
    凡人: '#a1a1aa', 煉氣: '#86efac', 築基: '#60a5fa', 金丹: '#fbbf24', 元嬰: '#c084fc',
    化神: '#f472b6', 煉虛: '#818cf8', 合體: '#fb923c', 大乘: '#f87171', 渡劫: '#ef4444', 真仙: '#f8fafc'
  });

  let filterType = 'all';
  let sortMode = 'type-quality';
  let queued = false;
  let lastItems = new Map();

  // 告知舊 cultivation-inventory.js 不要再插入長條式道具卡。
  window.__unifiedCultivationBagActive = true;

  function userData() { return window.getCurrentUserData?.() || null; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function qty(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
  function typeLabel(type) {
    if (type === 'artifact') return '法寶';
    if (type === 'material') return '材料';
    if (type === 'consumable') return '消耗道具';
    return '修煉物品';
  }
  function qualityColor(realm) { return REALM_COLORS[realm] || materialRealmColor(realm) || '#d4d4d8'; }
  function artifactEquipped(id) {
    const equipped = userData()?.artifactSystem?.equipped || {};
    return Object.values(equipped).includes(id);
  }

  function readTrainingLocalItems() {
    try {
      const raw = JSON.parse(localStorage.getItem('xiuxian_training_state_v4') || '{}');
      return Array.isArray(raw?.items) ? raw.items : [];
    } catch (_) {
      return [];
    }
  }

  function collectItems() {
    const data = userData() || {};
    const out = [];

    Object.entries(data.artifactSystem?.inventory || {}).forEach(([id, value]) => {
      const quantity = qty(value);
      if (!quantity) return;
      const item = getArtifactById(id);
      out.push({
        key: `artifact:${id}`,
        id,
        type: 'artifact',
        name: item?.name || `未知法寶 ${id}`,
        icon: item?.icon || '◆',
        quantity,
        category: item?.category || '法寶',
        realm: item?.realm || '凡人',
        qualityRank: realmOrderByName(item?.realm || '凡人'),
        description: item?.description || '此法寶已不在目前法寶清單中。',
        effects: Array.isArray(item?.effects) ? item.effects : [],
        equipped: artifactEquipped(id),
        raw: item || null
      });
    });

    Object.entries(data.materialSystem?.inventory || {}).forEach(([id, value]) => {
      const quantity = qty(value);
      if (!quantity) return;
      const item = getMaterialById(id);
      out.push({
        key: `material:${id}`,
        id,
        type: 'material',
        name: item?.name || `未知材料 ${id}`,
        icon: item?.icon || '材',
        quantity,
        category: item?.category || '材料',
        realm: item?.realm || '凡人',
        qualityRank: materialRealmOrderByName(item?.realm || '凡人'),
        description: item?.description || '此材料已不在目前材料清單中。',
        buyGold: Math.max(0, Number(item?.buyGold) || 0),
        raw: item || null
      });
    });

    const consumables = Array.isArray(window.getCultivationInventoryItems?.())
      ? window.getCultivationInventoryItems()
      : [];
    consumables.forEach((item) => {
      const quantity = qty(item?.quantity ?? item?.qty);
      if (!quantity) return;
      out.push({
        key: `consumable:${item.id || item.name}`,
        id: String(item.id || item.name || 'item'),
        type: 'consumable',
        name: item.name || '修煉道具',
        icon: item.icon || (item.id === 'revival-pill' ? '丹' : '物'),
        quantity,
        category: '消耗道具',
        realm: item.realm || '凡人',
        qualityRank: Number(item.qualityRank) || 0,
        description: item.id === 'revival-pill'
          ? `每服用一顆，立即增加 ${Math.max(0, Number(item.cultivationGain) || 100)} 修為。`
          : (item.description || '修煉途中取得的消耗道具。'),
        cultivationGain: Math.max(0, Number(item.cultivationGain) || 0),
        raw: item
      });
    });

    // 保留修煉模組未來可能新增的本地物品，避免統一背包把它們吃掉。
    readTrainingLocalItems().forEach((item, index) => {
      const id = String(item?.id || `training-${index}`);
      if (out.some((existing) => existing.id === id && existing.type !== 'training')) return;
      const quantity = qty(item?.qty ?? item?.quantity ?? 1);
      if (!quantity) return;
      out.push({
        key: `training:${id}`,
        id,
        type: 'training',
        name: item?.name || '修煉物品',
        icon: item?.icon || '◆',
        quantity,
        category: item?.category || '修煉物品',
        realm: item?.realm || '凡人',
        qualityRank: Number(item?.qualityRank) || realmOrderByName(item?.realm || '凡人'),
        description: item?.description || '修煉途中取得的物品。',
        raw: item
      });
    });

    return out;
  }

  function sortedVisibleItems(items) {
    const filtered = filterType === 'all' ? items : items.filter((item) => item.type === filterType);
    const nameSort = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant');
    const typeSort = (a, b) => (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
    const qualityDesc = (a, b) => (b.qualityRank || 0) - (a.qualityRank || 0);
    const qualityAsc = (a, b) => (a.qualityRank || 0) - (b.qualityRank || 0);

    return filtered.slice().sort((a, b) => {
      if (sortMode === 'quality-desc') return qualityDesc(a, b) || typeSort(a, b) || nameSort(a, b);
      if (sortMode === 'quality-asc') return qualityAsc(a, b) || typeSort(a, b) || nameSort(a, b);
      if (sortMode === 'name') return nameSort(a, b);
      return typeSort(a, b) || qualityDesc(a, b) || nameSort(a, b);
    });
  }

  function bagIsActive() {
    const page = document.getElementById('page-training');
    if (!page) return false;
    if (page.dataset.foundationTraining === '1') return true;
    const bag = page.querySelector('[data-training-tab="bag"]');
    return !!bag && (bag.classList.contains('active') || bag.getAttribute('aria-selected') === 'true');
  }

  function itemMarkup(item) {
    const color = qualityColor(item.realm);
    return `<button type="button" class="uib-item" data-uib-item="${escapeHtml(item.key)}" style="--uib-quality:${escapeHtml(color)}" aria-label="查看 ${escapeHtml(item.name)} 詳細資料">
      <span class="uib-qty">×${item.quantity}</span>
      ${item.equipped ? '<span class="uib-equipped"><i class="fa-solid fa-circle-check"></i></span>' : ''}
      <span class="uib-icon" aria-hidden="true">${escapeHtml(item.icon || '◆')}</span>
      <span class="uib-name">${escapeHtml(item.name)}</span>
      <span class="uib-bottom"><small>${escapeHtml(typeLabel(item.type))}</small><em>${escapeHtml(item.realm || '凡人')}</em></span>
    </button>`;
  }

  function rootMarkup(allItems) {
    const visible = sortedVisibleItems(allItems);
    const counts = {
      artifact: allItems.filter((item) => item.type === 'artifact').length,
      material: allItems.filter((item) => item.type === 'material').length,
      consumable: allItems.filter((item) => item.type === 'consumable' || item.type === 'training').length
    };
    return `<section id="${ROOT_ID}" class="uib-root">
      <div class="uib-toolbar">
        <div class="uib-summary"><b>背包</b><span>${allItems.length} 種物品</span></div>
        <label>種類
          <select id="uib-filter-type">
            <option value="all" ${filterType === 'all' ? 'selected' : ''}>全部</option>
            <option value="artifact" ${filterType === 'artifact' ? 'selected' : ''}>法寶 (${counts.artifact})</option>
            <option value="material" ${filterType === 'material' ? 'selected' : ''}>材料 (${counts.material})</option>
            <option value="consumable" ${filterType === 'consumable' ? 'selected' : ''}>消耗道具 (${counts.consumable})</option>
          </select>
        </label>
        <label>排序
          <select id="uib-sort-mode">
            <option value="type-quality" ${sortMode === 'type-quality' ? 'selected' : ''}>種類 → 品質</option>
            <option value="quality-desc" ${sortMode === 'quality-desc' ? 'selected' : ''}>品質高 → 低</option>
            <option value="quality-asc" ${sortMode === 'quality-asc' ? 'selected' : ''}>品質低 → 高</option>
            <option value="name" ${sortMode === 'name' ? 'selected' : ''}>名稱</option>
          </select>
        </label>
      </div>
      ${visible.length
        ? `<div class="uib-grid">${visible.map(itemMarkup).join('')}</div>`
        : `<div class="uib-empty"><i class="fa-solid fa-box-open"></i><b>${allItems.length ? '此分類沒有物品' : '背包尚空'}</b><span>${allItems.length ? '切換種類即可查看其他物品。' : '法寶、材料與修煉道具都會收納在這裡。'}</span></div>`}
    </section>`;
  }

  function effectLabel(effect) {
    const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
    if (effect?.type === 'equip_attack_flat') return `裝備後攻擊 +${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_attack_percent') return `裝備後攻擊 +${pct(effect.value)}`;
    if (effect?.type === 'equip_hp_flat') return `裝備後生命 +${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_hp_percent') return `裝備後生命 +${pct(effect.value)}`;
    if (effect?.type === 'timed_attack_multiplier') return `催動後攻擊 ×${Number(effect.multiplier) || 1}`;
    if (effect?.type === 'timed_cultivation_multiplier') return `催動後修為 ×${Number(effect.multiplier) || 1}`;
    if (effect?.type === 'remove_wrong_option') return '作答前排除 1 個錯誤選項';
    return String(effect?.type || '特殊效果');
  }

  function openDetails(key) {
    const item = lastItems.get(key);
    if (!item) return;
    document.getElementById(MODAL_ID)?.remove();
    const color = qualityColor(item.realm);
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'uib-modal-backdrop';

    let extra = '';
    if (item.type === 'artifact') {
      extra = `<div class="uib-detail-section"><span>法寶效果</span>${item.effects.length
        ? `<ul>${item.effects.map((effect) => `<li>${escapeHtml(effectLabel(effect))}</li>`).join('')}</ul>`
        : '<p>目前沒有額外效果資料。</p>'}${item.equipped ? '<p class="uib-equipped-note"><i class="fa-solid fa-circle-check"></i> 目前已裝備</p>' : ''}</div>`;
    } else if (item.type === 'material') {
      extra = `<div class="uib-detail-section"><span>材料資訊</span><p>分類：${escapeHtml(item.category)}</p><p>${item.buyGold > 0 ? `坊市參考價：${item.buyGold} 金幣` : '此材料不可直接購買'}</p></div>`;
    } else if (item.id === 'revival-pill') {
      extra = `<div class="uib-detail-section"><span>使用效果</span><p>服用後立即增加 ${item.cultivationGain || 100} 修為。</p><button type="button" class="uib-use-btn" data-uib-use="revival-pill">服用一顆</button></div>`;
    }

    modal.innerHTML = `<section class="uib-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.name)}" style="--uib-quality:${escapeHtml(color)}">
      <div class="uib-modal-head"><div class="uib-modal-icon">${escapeHtml(item.icon || '◆')}</div><div><small>${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.category || '')}</small><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.realm || '凡人')} · 持有 ×${item.quantity}</span></div><button type="button" class="uib-close" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="uib-description">${escapeHtml(item.description || '沒有說明。')}</div>
      ${extra}
    </section>`;

    const close = () => modal.remove();
    modal.querySelector('.uib-close')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('[data-uib-use="revival-pill"]')?.addEventListener('click', async () => {
      const button = modal.querySelector('[data-uib-use="revival-pill"]');
      if (!window.useRevivalPillItem || button?.disabled) return;
      button.disabled = true;
      try { await window.useRevivalPillItem(); close(); } finally { scheduleRender(); }
    });
    document.body.appendChild(modal);
  }

  function bindRoot(root) {
    root.querySelector('#uib-filter-type')?.addEventListener('change', (event) => {
      filterType = event.target.value || 'all';
      scheduleRender(true);
    });
    root.querySelector('#uib-sort-mode')?.addEventListener('change', (event) => {
      sortMode = event.target.value || 'type-quality';
      scheduleRender(true);
    });
    root.querySelectorAll('[data-uib-item]').forEach((button) => {
      button.addEventListener('click', () => openDetails(button.dataset.uibItem));
    });
  }

  function render(force = false) {
    queued = false;
    if (!bagIsActive()) return;
    const content = document.getElementById('training-tab-content');
    if (!content) return;

    const allItems = collectItems();
    lastItems = new Map(allItems.map((item) => [item.key, item]));
    const signature = JSON.stringify({
      filterType,
      sortMode,
      items: allItems.map((item) => [item.key, item.quantity, item.realm, item.name, item.equipped ? 1 : 0])
    });
    const root = document.getElementById(ROOT_ID);
    if (!force && root?.dataset.signature === signature && root.closest('#training-tab-content') === content) return;

    // 修煉模組每次切分頁都可能重建 content；統一背包在其後接手背包內容。
    content.innerHTML = rootMarkup(allItems);
    const nextRoot = document.getElementById(ROOT_ID);
    if (nextRoot) {
      nextRoot.dataset.signature = signature;
      bindRoot(nextRoot);
    }
  }

  function scheduleRender(force = false) {
    if (force) queued = false;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => render(force));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}
      .uib-toolbar{flex:0 0 auto;display:flex;align-items:end;gap:8px;padding:9px 10px;border:1px solid rgba(216,177,93,.16);border-radius:14px;background:rgba(13,11,8,.84)}
      .uib-summary{display:grid;gap:2px;margin-right:auto}.uib-summary b{color:#f0dfb6;font-size:11px}.uib-summary span{color:#847864;font-size:7px}.uib-toolbar label{display:grid;gap:3px;color:#8e816c;font-size:6px;font-weight:900}.uib-toolbar select{min-width:126px;height:32px;padding:0 28px 0 9px;border:1px solid rgba(216,177,93,.2);border-radius:9px;background:#090807;color:#e2d5ba;font-size:8px;outline:none}
      .uib-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,140px));grid-auto-rows:max-content;align-content:start;justify-content:start;gap:10px;padding:2px 4px 12px 2px;scrollbar-width:thin;scrollbar-color:rgba(216,177,93,.26) transparent}
      .uib-item{position:relative;aspect-ratio:1/1;min-width:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 8px 9px;border:1px solid color-mix(in srgb,var(--uib-quality) 42%,rgba(255,255,255,.08));border-radius:16px;background:radial-gradient(circle at 50% 27%,color-mix(in srgb,var(--uib-quality) 15%,transparent),transparent 46%),linear-gradient(145deg,rgba(22,18,12,.96),rgba(7,7,7,.98));color:#eee2ca;text-align:center;box-shadow:inset 0 0 22px rgba(255,255,255,.015);transition:.15s ease;overflow:hidden}.uib-item:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--uib-quality) 72%,#fff 8%);box-shadow:0 10px 24px rgba(0,0,0,.25)}
      .uib-icon{width:46px;height:46px;display:grid;place-items:center;border-radius:13px;border:1px solid color-mix(in srgb,var(--uib-quality) 58%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:15px;font-weight:900;box-shadow:0 0 20px color-mix(in srgb,var(--uib-quality) 12%,transparent)}.uib-name{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee2ca;font-size:8px;font-weight:900}.uib-bottom{width:100%;display:flex;justify-content:space-between;gap:5px;align-items:center}.uib-bottom small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#827661;font-size:6px}.uib-bottom em{color:var(--uib-quality);font-size:6px;font-style:normal;white-space:nowrap}.uib-qty{position:absolute;right:7px;top:7px;padding:2px 5px;border-radius:999px;background:rgba(0,0,0,.64);border:1px solid rgba(255,255,255,.08);color:#ead49a;font-size:7px;font-weight:900}.uib-equipped{position:absolute;left:7px;top:7px;color:#f6d77e;font-size:8px}
      .uib-empty{flex:1;min-height:180px;display:grid;place-items:center;align-content:center;gap:7px;color:#706653;text-align:center}.uib-empty i{font-size:25px}.uib-empty b{color:#a99b80;font-size:10px}.uib-empty span{font-size:7px}
      .uib-modal-backdrop{position:fixed;inset:0;z-index:16050;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.uib-modal{width:min(100%,540px);max-height:88dvh;overflow:auto;padding:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 48%,rgba(255,255,255,.08));border-radius:20px;background:linear-gradient(150deg,#18140e,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.uib-modal-head{display:grid;grid-template-columns:58px minmax(0,1fr) 34px;gap:11px;align-items:center}.uib-modal-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 55%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:18px;font-weight:900}.uib-modal-head small{display:block;color:#857965;font-size:7px}.uib-modal-head h3{margin:3px 0;color:#f1e4c9;font-size:15px}.uib-modal-head span{color:var(--uib-quality);font-size:8px}.uib-close{width:32px;height:32px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.025);color:#a99d87}.uib-description{margin-top:14px;padding:11px;border-radius:12px;background:rgba(255,255,255,.025);color:#a99b83;font-size:9px;line-height:1.7}.uib-detail-section{margin-top:10px;padding:11px;border:1px solid rgba(216,177,93,.12);border-radius:12px}.uib-detail-section>span{display:block;margin-bottom:7px;color:#d3b86f;font-size:8px;font-weight:900}.uib-detail-section p,.uib-detail-section li{margin:4px 0;color:#9b8e77;font-size:8px;line-height:1.55}.uib-detail-section ul{margin:0;padding-left:17px}.uib-equipped-note{color:#e3c36e!important}.uib-use-btn{width:100%;min-height:38px;margin-top:9px;border:1px solid rgba(216,177,93,.38);border-radius:11px;background:rgba(216,177,93,.09);color:#f0d99a;font-size:9px;font-weight:900}.uib-use-btn:disabled{opacity:.45}
      @media(max-width:700px){.uib-toolbar{align-items:stretch;flex-wrap:wrap}.uib-summary{width:100%;margin-right:0}.uib-toolbar label{flex:1;min-width:120px}.uib-toolbar select{width:100%;min-width:0}.uib-grid{grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:8px}.uib-item{max-width:140px;justify-self:start}}
      @media(max-width:420px){.uib-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.uib-item{max-width:none;padding:9px 6px}.uib-icon{width:40px;height:40px}.uib-name{font-size:7px}.uib-bottom small,.uib-bottom em{font-size:5.5px}}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyle();
    scheduleRender(true);
    [
      'material-system-updated', 'artifact-system-updated', 'material-catalog-updated', 'artifact-catalog-updated',
      'xiuxian:stats-updated', 'foundation-training-stage-changed', 'golden-core-access-changed'
    ].forEach((name) => window.addEventListener(name, () => scheduleRender(true)));

    document.addEventListener('change', (event) => {
      if (event.target?.matches?.('#uib-filter-type,#uib-sort-mode')) scheduleRender(true);
    });

    const page = document.getElementById('page-training');
    if (page) new MutationObserver(() => scheduleRender()).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'data-foundation-training'] });
    else new MutationObserver(() => {
      if (document.getElementById('page-training')) scheduleRender(true);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
