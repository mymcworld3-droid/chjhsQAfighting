import './nascent-growth.js';
import { realmOrderByName } from './artifact-catalog.js';

// 行囊保留內丹養成資源與消耗道具。
(function () {
  'use strict';

  const ROOT_ID = 'unified-cultivation-bag';
  const MODAL_ID = 'unified-bag-detail-modal';
  const STYLE_ID = 'unified-inventory-grid-runtime-style';
  const TYPE_ORDER = Object.freeze({ material: 0, consumable: 1, training: 2 });
  const REALM_COLORS = Object.freeze({
    凡人: '#a1a1aa', 煉氣: '#86efac', 築基: '#60a5fa', 金丹: '#fbbf24', 元嬰: '#c084fc',
    化神: '#f472b6', 煉虛: '#818cf8', 合體: '#fb923c', 大乘: '#f87171', 渡劫: '#ef4444', 真仙: '#f8fafc'
  });

  let filterType = 'all';
  let sortMode = 'type-quality';
  let queued = false;
  let lastItems = new Map();

  function userData() { return window.getCurrentUserData?.() || null; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function qty(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
  function imageMarkup(imageUrl, fallback, alt = '') {
    const url = String(imageUrl || '').trim();
    if (!url) return escapeHtml(fallback || '◆');
    return `<img class="ui-content-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="ui-content-fallback" hidden>${escapeHtml(fallback || '◆')}</span>`;
  }
  function typeLabel(type) {
    if (type === 'material') return '修煉資源';
    if (type === 'consumable') return '消耗道具';
    return '修煉物品';
  }
  function qualityColor(realm) { return REALM_COLORS[realm] || '#d4d4d8'; }
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

    const growth = globalThis.QANascentGrowth;
    const essence = growth.prepare(data).fragments;
    if (essence) {
      const item = growth.ITEM;
      out.push({ ...item, key: `material:${item.id}`, type: 'material',
        quantity: essence, qualityRank: realmOrderByName(item.realm), nascentMaterial: true });
    }

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
        imageUrl: globalThis.QAItemIcons?.url(item) || '',
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
        imageUrl: globalThis.QAItemIcons?.url(item) || '',
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
    const filtered = filterType === 'all' ? items : items.filter(item => item.type === filterType || (filterType === 'consumable' && item.type === 'training'));
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

  function inventoryView() {
    const page = document.getElementById('page-training');
    const selected = page?.querySelector('[data-training-tab].active');
    const tab = selected?.dataset.trainingTab;
    return tab === 'bag' ? tab : '';
  }

  function itemMarkup(item) {
    const color = qualityColor(item.realm);
    return `<button type="button" class="uib-item ${item.nascentMaterial ? 'uib-nascent uib-raid-key' : ''}"
      data-uib-item="${escapeHtml(item.key)}" style="--uib-quality:${escapeHtml(color)}" aria-label="查看 ${escapeHtml(item.name)} 詳細資料">
      <span class="uib-qty">×${item.quantity}</span>
      ${item.nascentMaterial ? '<span class="uib-raid-key-badge uib-nascent-badge">元嬰</span>' : ''}
      <span class="uib-icon">${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</span>
      <span class="uib-name">${escapeHtml(item.name)}</span>
      <span class="uib-bottom"><small>${escapeHtml(typeLabel(item.type))}</small><em>${escapeHtml(item.realm || '凡人')}</em></span>
    </button>`;
  }

  function rootMarkup(allItems) {
    const visible = sortedVisibleItems(allItems);
    const counts = {
      material: allItems.filter((item) => item.type === 'material').length,
      consumable: allItems.filter((item) => item.type === 'consumable' || item.type === 'training').length
    };
    return `<section id="${ROOT_ID}" class="uib-root uib-bag-view">
      <div class="uib-toolbar">
        <div class="uib-summary"><b>行囊</b><span>${allItems.length} 種物品</span></div>
        <label>種類
          <select id="uib-filter-type">
            <option value="all" ${filterType === 'all' ? 'selected' : ''}>全部</option>
            <option value="material" ${filterType === 'material' ? 'selected' : ''}>修煉資源 (${counts.material})</option>
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
        : `<div class="uib-empty"><i class="fa-solid fa-box-open"></i><b>${allItems.length ? '此分類沒有物品' : '背包尚空'}</b><span>${allItems.length ? '切換種類即可查看其他物品。' : '內丹養成資源與消耗道具會收納在這裡。'}</span></div>`}
    </section>`;
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
    if (item.nascentMaterial) {
      extra = '<div class="uib-detail-section"><span>元嬰養成</span><p>可在修煉室的元嬰／元神分頁提升分支與本命神通。</p></div>';
    } else if (item.id === 'revival-pill') {
      extra = `<div class="uib-detail-section"><span>使用效果</span><p>服用後立即增加 ${item.cultivationGain || 100} 修為。</p><button type="button" class="uib-use-btn" data-uib-use="revival-pill">服用一顆</button></div>`;
    }

    modal.innerHTML = `<section class="uib-modal uib-modal-${escapeHtml(item.type)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.name)}" style="--uib-quality:${escapeHtml(color)}">
      <div class="uib-modal-head"><div class="uib-modal-icon">${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</div><div><small>${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.category || '')}</small><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.realm || '凡人')} · 持有 ×${item.quantity}</span></div><button type="button" class="uib-close" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>
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
    root.querySelectorAll('[data-uib-item]').forEach(button => {
      button.addEventListener('click', () => openDetails(button.dataset.uibItem));
    });
  }

  function render(force = false) {
    queued = false;
    const view = inventoryView();
    if (!view) return;
    const content = document.getElementById('training-tab-content');
    if (!content) return;

    const allItems = collectItems();
    lastItems = new Map(allItems.map((item) => [item.key, item]));
    const signature = JSON.stringify({
      view,
      filterType,
      sortMode,
      items: allItems.map(item => [item.key, item.quantity, item.realm, item.name])
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

  // 分頁可直接要求裝備模組同步渲染，不必只依賴 CustomEvent 時序。
  window.openCultivationEquipment = () => {
    render(true);
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}
      .uib-bag-view{overflow:auto;overscroll-behavior:contain}.uib-bag-view>.uib-toolbar{flex-shrink:0}.uib-bag-view>.uib-grid{flex:1 0 200px;overflow:visible}
      .uib-toolbar{flex:0 0 auto;display:flex;align-items:end;gap:8px;padding:9px 10px;border:1px solid rgba(216,177,93,.16);border-radius:14px;background:rgba(13,11,8,.84)}
      .uib-summary{display:grid;gap:2px;margin-right:auto}.uib-summary b{color:#f0dfb6;font-size:11px}.uib-summary span{color:#847864;font-size:7px}.uib-toolbar label{display:grid;gap:3px;color:#8e816c;font-size:6px;font-weight:900}.uib-toolbar select{min-width:126px;height:32px;padding:0 28px 0 9px;border:1px solid rgba(216,177,93,.2);border-radius:9px;background:#090807;color:#e2d5ba;font-size:8px;outline:none}
      .uib-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,140px));grid-auto-rows:max-content;align-content:start;justify-content:start;gap:10px;padding:2px 4px 12px 2px;scrollbar-width:thin;scrollbar-color:rgba(216,177,93,.26) transparent}
      .uib-item{position:relative;aspect-ratio:1/1;min-width:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 8px 9px;border:1px solid color-mix(in srgb,var(--uib-quality) 42%,rgba(255,255,255,.08));border-radius:16px;background:radial-gradient(circle at 50% 27%,color-mix(in srgb,var(--uib-quality) 15%,transparent),transparent 46%),linear-gradient(145deg,rgba(22,18,12,.96),rgba(7,7,7,.98));color:#eee2ca;text-align:center;box-shadow:inset 0 0 22px rgba(255,255,255,.015);transition:.15s ease;overflow:hidden}.uib-item:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--uib-quality) 72%,#fff 8%);box-shadow:0 10px 24px rgba(0,0,0,.25)}.uib-nascent-badge{background:#563975!important;color:#ecd5ff!important}.uib-item.uib-raid-key{border-color:color-mix(in srgb,var(--uib-quality) 68%,#e7c779);background:radial-gradient(circle at 50% 24%,rgba(231,199,121,.2),transparent 48%),linear-gradient(145deg,#20180d,#080807);box-shadow:inset 0 0 25px rgba(231,199,121,.04)}.uib-raid-key-badge{position:absolute;left:6px;top:6px;padding:2px 5px;border:1px solid rgba(231,199,121,.3);border-radius:999px;background:rgba(35,24,9,.88);color:#e7c779;font-size:5.5px;font-weight:900;letter-spacing:.04em}.uib-raid-key-badge i{margin-right:2px}
      .uib-icon{width:46px;height:46px;display:grid;place-items:center;overflow:hidden;border-radius:13px;border:1px solid color-mix(in srgb,var(--uib-quality) 58%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:15px;font-weight:900;box-shadow:0 0 20px color-mix(in srgb,var(--uib-quality) 12%,transparent)}.uib-icon img,.uib-equip-slot-frame img{width:100%;height:100%;display:block;object-fit:cover}.uib-equip-slot-frame{overflow:hidden}.uib-name{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee2ca;font-size:8px;font-weight:900}.uib-bottom{width:100%;display:flex;justify-content:space-between;gap:5px;align-items:center}.uib-bottom small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#827661;font-size:6px}.uib-bottom em{color:var(--uib-quality);font-size:6px;font-style:normal;white-space:nowrap}.uib-qty{position:absolute;right:7px;top:7px;padding:2px 5px;border-radius:999px;background:rgba(0,0,0,.64);border:1px solid rgba(255,255,255,.08);color:#ead49a;font-size:7px;font-weight:900}.uib-equipped{position:absolute;left:7px;top:7px;color:#f6d77e;font-size:8px}
      .uib-item[data-uib-item^="material:"] .uib-icon,.uib-modal-material .uib-modal-icon{border-radius:50%!important;background:radial-gradient(circle at 31% 25%,color-mix(in srgb,var(--uib-quality) 36%,#fff),color-mix(in srgb,var(--uib-quality) 14%,#16110a) 43%,#0b0b09 100%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.07),0 0 12px color-mix(in srgb,var(--uib-quality) 12%,transparent)}
      .uib-modal-icon img{width:100%;height:100%;object-fit:contain;padding:5%;border-radius:inherit}
      .uib-empty{flex:1;min-height:180px;display:grid;place-items:center;align-content:center;gap:7px;color:#706653;text-align:center}.uib-empty i{font-size:25px}.uib-empty b{color:#a99b80;font-size:10px}.uib-empty span{font-size:7px}
      .uib-modal-backdrop{position:fixed;inset:0;z-index:16050;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.uib-modal{width:min(100%,540px);max-height:88dvh;overflow:auto;padding:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 48%,rgba(255,255,255,.08));border-radius:20px;background:linear-gradient(150deg,#18140e,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.uib-modal-head{display:grid;grid-template-columns:58px minmax(0,1fr) 34px;gap:11px;align-items:center}.uib-modal-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 55%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:18px;font-weight:900}.uib-modal-head small{display:block;color:#857965;font-size:7px}.uib-modal-head h3{margin:3px 0;color:#f1e4c9;font-size:15px}.uib-modal-head span{color:var(--uib-quality);font-size:8px}.uib-close{width:32px;height:32px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.025);color:#a99d87}.uib-description{margin-top:14px;padding:11px;border-radius:12px;background:rgba(255,255,255,.025);color:#a99b83;font-size:9px;line-height:1.7}.uib-detail-section{margin-top:10px;padding:11px;border:1px solid rgba(216,177,93,.12);border-radius:12px}.uib-detail-section>span{display:block;margin-bottom:7px;color:#d3b86f;font-size:8px;font-weight:900}.uib-detail-section p,.uib-detail-section li{margin:4px 0;color:#9b8e77;font-size:8px;line-height:1.55}.uib-detail-section ul{margin:0;padding-left:17px}.uib-equipped-note{color:#e3c36e!important}.uib-use-btn,.uib-equip-btn{width:100%;min-height:38px;margin-top:9px;border:1px solid rgba(216,177,93,.38);border-radius:11px;background:rgba(216,177,93,.09);color:#f0d99a;font-size:9px;font-weight:900}.uib-use-btn:disabled,.uib-equip-btn:disabled{opacity:.45}.uib-equip-btn:not(:disabled):hover{border-color:#e2c069;background:rgba(216,177,93,.14)}
      @media(max-width:700px){.uib-toolbar{align-items:stretch;flex-wrap:wrap}.uib-summary{width:100%;margin-right:0}.uib-toolbar label{flex:1;min-width:120px}.uib-toolbar select{width:100%;min-width:0}.uib-grid{grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:8px}.uib-item{max-width:140px;justify-self:start}}
      @media(max-width:420px){.uib-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.uib-item{max-width:none;padding:9px 6px}.uib-icon{width:40px;height:40px}.uib-name{font-size:7px}.uib-bottom small,.uib-bottom em{font-size:5.5px}}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyle();
    scheduleRender(true);
    [
      'material-system-updated',
      'xiuxian:stats-updated', 'foundation-training-stage-changed', 'golden-core-access-changed',
      'xiuxian:equipment-open-request'
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
