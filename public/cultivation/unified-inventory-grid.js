import { ARTIFACT_CATALOG, ARTIFACT_EQUIP_SLOTS, getArtifactById, realmForScore, realmOrderByName } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  getMaterialById,
  materialRealmColor,
  materialRealmOrderByName,
  materialMarketReferencePrice,
  artifactRecipeDepth,
  MAX_ARTIFACT_RECIPE_NESTING,
  RAID_REFINEMENT_KEYS
} from './material-catalog.js';

// 統一修煉背包：法寶、材料、消耗道具共用正方形格子；點擊後才顯示詳細資料。
(function () {
  'use strict';

  const ROOT_ID = 'unified-cultivation-bag';
  const MODAL_ID = 'unified-bag-detail-modal';
  const STYLE_ID = 'unified-inventory-grid-runtime-style';
  const TYPE_ORDER = Object.freeze({ artifact: 0, material: 1, consumable: 2, training: 3 });
  const RAID_KEY_IDS = new Set(Object.values(RAID_REFINEMENT_KEYS));
  const REALM_COLORS = Object.freeze({
    凡人: '#a1a1aa', 煉氣: '#86efac', 築基: '#60a5fa', 金丹: '#fbbf24', 元嬰: '#c084fc',
    化神: '#f472b6', 煉虛: '#818cf8', 合體: '#fb923c', 大乘: '#f87171', 渡劫: '#ef4444', 真仙: '#f8fafc'
  });

  let filterType = 'all';
  let sortMode = 'type-quality';
  let equipmentPickSlot = '';
  let queued = false;
  let lastItems = new Map();

  // 唯一背包與裝備視圖；舊長條物品卡已從資料模組移除。

  function userData() { return window.getCurrentUserData?.() || null; }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function qty(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
  function imageMarkup(imageUrl, fallback, alt = '') {
    const url = String(imageUrl || '').trim();
    if (!url) return escapeHtml(fallback || '◆');
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
  }
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
  function artifactHasEquipEffects(item) {
    return (item?.effects || []).some((effect) => String(effect?.type || '').startsWith('equip_'));
  }
  function artifactSlot(item) {
    if (!artifactHasEquipEffects(item)) return '';
    const configured = String(item?.equipSlot || '').trim();
    return ARTIFACT_EQUIP_SLOTS.includes(configured) ? configured : '輔助法寶';
  }
  function artifactCanEquip(item) {
    if (!item || !artifactHasEquipEffects(item)) return false;
    return true;
  }
  function equippedIdForSlot(slot) {
    return String(userData()?.artifactSystem?.equipped?.[slot] || '');
  }
  const EQUIPMENT_ICONS = Object.freeze({
    本命法寶:'fa-khanda', 護身法寶:'fa-shield-halved', 佩飾法寶:'fa-gem', 輔助法寶:'fa-wand-magic-sparkles'
  });
  function equipmentSlotMarkup(slot) {
    const id = equippedIdForSlot(slot), item = getArtifactById(id);
    const valid = !!item && qty(userData()?.artifactSystem?.inventory?.[id]) > 0 && artifactSlot(item) === slot;
    const icon = EQUIPMENT_ICONS[slot] || 'fa-gem';
    const label = `<span class="uib-equip-slot-label"><i class="fa-solid ${icon}"></i> ${escapeHtml(slot)}</span>`;
    if (!valid) return `<button type="button" class="uib-equip-slot is-empty${equipmentPickSlot === slot ? ' is-picking' : ''}" data-uib-empty-slot="${escapeHtml(slot)}">${label}
      <span class="uib-equip-slot-frame"><i class="fa-solid fa-plus"></i></span><b class="uib-equip-slot-name">空裝備欄</b><small class="uib-equip-slot-hint">點擊裝配</small></button>`;
    const color = qualityColor(item.realm);
    return `<button type="button" class="uib-equip-slot is-filled" data-uib-equipped-item="artifact:${escapeHtml(id)}" style="--uib-quality:${escapeHtml(color)}">${label}
      <span class="uib-equip-slot-frame is-artifact">${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</span><b class="uib-equip-slot-name">${escapeHtml(item.name)}</b>
      <small class="uib-equip-slot-hint">${escapeHtml(item.realm)} · 戰力 ${Math.max(0, Number(window.calculateArtifactPower?.(item)) || 0).toLocaleString("zh-TW")}</small></button>`;
  }
  function equipmentMarkup() {
    const equippedCount = ARTIFACT_EQUIP_SLOTS.filter((slot) => {
      const id = equippedIdForSlot(slot), item = getArtifactById(id);
      return !!item && qty(userData()?.artifactSystem?.inventory?.[id]) > 0 && artifactSlot(item) === slot;
    }).length;
    return `<section class="uib-equipment-panel" aria-label="法寶裝配欄">
      <div class="uib-equipment-head"><b><i class="fa-solid fa-shield-halved"></i> 法寶裝配</b><em>${equippedCount} / ${ARTIFACT_EQUIP_SLOTS.length}</em></div>
      <div class="uib-equipment-grid">${ARTIFACT_EQUIP_SLOTS.map(equipmentSlotMarkup).join('')}</div></section>`;
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
        imageUrl: item?.imageUrl || '',
        quantity,
        category: item?.category || '法寶',
        realm: item?.realm || '凡人',
        qualityRank: realmOrderByName(item?.realm || '凡人'),
        description: item?.description || '此法寶已不在目前法寶清單中。',
        effects: Array.isArray(item?.effects) ? item.effects : [],
        refinementDepth: item ? artifactRecipeDepth(id) : 0,
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
        imageUrl: item?.imageUrl || '',
        quantity,
        category: item?.category || '材料',
        realm: item?.realm || '凡人',
        qualityRank: materialRealmOrderByName(item?.realm || '凡人'),
        description: item?.description || '此材料已不在目前材料清單中。',
        buyGold: Math.max(0, Number(item?.buyGold) || 0),
        raidKey: RAID_KEY_IDS.has(id),
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
    const filtered = equipmentPickSlot ? items.filter((item) => item.type === 'artifact' && artifactSlot(item.raw) === equipmentPickSlot) : (filterType === 'all' ? items : items.filter((item) => item.type === filterType));
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
    return tab === 'equipment' || tab === 'bag' ? tab : '';
  }

  function itemMarkup(item) {
    const color = qualityColor(item.realm);
    return `<button type="button" class="uib-item ${item.raidKey ? 'uib-raid-key' : ''}" data-uib-item="${escapeHtml(item.key)}" style="--uib-quality:${escapeHtml(color)}" aria-label="查看 ${escapeHtml(item.name)} 詳細資料">
      <span class="uib-qty">×${item.quantity}</span>
      ${item.equipped ? '<span class="uib-equipped"><i class="fa-solid fa-circle-check"></i></span>' : ''}
      ${item.raidKey ? '<span class="uib-raid-key-badge"><i class="fa-solid fa-stamp"></i> 團本</span>' : ''}
      <span class="uib-icon">${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</span>
      <span class="uib-name">${escapeHtml(item.name)}</span>
      <span class="uib-bottom"><small>${escapeHtml(item.raidKey ? '團本印記' : typeLabel(item.type))}</small><em>${escapeHtml(item.realm || '凡人')}</em></span>
    </button>`;
  }

  function rootMarkup(allItems, view = 'bag') {
    if (view === 'equipment') {
      const ownedArtifacts = allItems.filter((item) => item.type === 'artifact');
      const equippedCandidates = ownedArtifacts.filter((item) => !!artifactSlot(item.raw));
      const equipmentItems = equippedCandidates
        .filter((item) => !equipmentPickSlot || artifactSlot(item.raw) === equipmentPickSlot)
        .sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hant'));
      const noEquipmentHint = ownedArtifacts.length && !equippedCandidates.length
        ? '目前持有的法寶都是消耗型或答題型，不能放入裝配格。請先煉製具有裝備效果的法寶。'
        : equipmentPickSlot && equippedCandidates.length
          ? '目前持有的裝備型法寶屬於其他欄位。請取消選擇後查看可用欄位。'
          : '請先在煉器頁取得具有裝備效果的法寶。';
      return `<section id="${ROOT_ID}" class="uib-root uib-equipment-view">
        ${equipmentMarkup()}
        ${equipmentPickSlot
          ? `<div class="uib-equip-picker"><span>點選下方法寶，即可裝配到「${escapeHtml(equipmentPickSlot)}」</span><button type="button" data-uib-cancel-equip>取消</button></div>`
          : '<div class="uib-equip-picker"><span>先點擊空裝配格，再選擇下方對應法寶；已裝備法寶可點擊卸下。</span></div>'}
        ${equipmentItems.length
          ? `<div class="uib-equipment-available"><span>持有裝備型法寶</span><small>${equipmentPickSlot ? '點一下直接裝配' : '點擊查看詳情及裝備'}</small></div><div class="uib-grid">${equipmentItems.map(itemMarkup).join('')}</div>`
          : `<div class="uib-empty"><i class="fa-solid fa-shield-halved"></i><b>${equipmentPickSlot ? '此欄沒有可裝配的法寶' : '尚無可裝配的法寶'}</b><span>${noEquipmentHint}</span></div>`}
      </section>`;
    }
    const visible = sortedVisibleItems(allItems);
    const counts = {
      artifact: allItems.filter((item) => item.type === 'artifact').length,
      material: allItems.filter((item) => item.type === 'material').length,
      consumable: allItems.filter((item) => item.type === 'consumable' || item.type === 'training').length
    };
    return `<section id="${ROOT_ID}" class="uib-root uib-bag-view">
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
    if (effect?.type === 'equip_damage_percent') return `鬥法傷害 +${pct(effect.value)}`;
    if (effect?.type === 'equip_damage_reduction_flat') return `每次受傷固定 -${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_damage_reduction_percent') return `受到傷害 -${pct(effect.value)}`;
    if (effect?.type === 'equip_crit_chance') return `暴擊率 +${pct(effect.value)}`;
    if (effect?.type === 'equip_crit_damage_percent') return `暴擊額外傷害 +${pct(effect.value)}`;
    if (effect?.type === 'equip_combo_chance') return `連擊率 ${pct(Math.min(0.10, Number(effect.value) || 0))}（上限 10%）`;
    if (effect?.type === 'equip_lifesteal_percent') return `吸血 ${pct(effect.value)}`;
    if (effect?.type === 'equip_reflect_percent') return `反傷 ${pct(effect.value)}`;
    if (effect?.type === 'equip_shield_flat') return `每場鬥法護盾 +${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_true_damage_flat') return `命中追加 ${Number(effect.value) || 0} 真實傷害`;
    if (effect?.type === 'equip_low_hp_damage_percent') return `生命≤30% 時傷害 +${pct(effect.value)}`;
    if (effect?.type === 'equip_low_hp_reduction_percent') return `生命≤30% 時減傷 +${pct(effect.value)}`;
    if (effect?.type === 'equip_first_hit_reduction_percent') return `每場首次受傷減少 ${pct(effect.value)}`;
    if (effect?.type === 'equip_damage_cap_percent') return `單次生命傷害不超過最大生命 ${pct(effect.value)}`;
    if (effect?.type === 'equip_on_correct_shield_flat') return `答對攻擊後護盾 +${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_cheat_death') return '每場一次致命傷保留 1 HP';
    if (effect?.type === 'equip_copy_enemy_artifact') return '每場固定複製敵方一項可複製戰鬥效果';
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
      const rawArtifact = item.raw;
      const equipSlot = artifactSlot(rawArtifact);
      const equippedId = equipSlot ? equippedIdForSlot(equipSlot) : '';
      const equippedHere = equippedId === item.id;
      const replacing = equippedId && !equippedHere ? getArtifactById(equippedId) : null;
      const hasEquip = artifactHasEquipEffects(rawArtifact);
      const canEquip = artifactCanEquip(rawArtifact);
      const itemPower = Math.max(0, Number(window.calculateArtifactPower?.(rawArtifact)) || 0);
      const equipAction = hasEquip && equipSlot
        ? `<button type="button" class="uib-equip-btn" data-uib-equip="${escapeHtml(item.id)}" ${!equippedHere && !canEquip ? 'disabled' : ''}>${equippedHere ? '<i class="fa-solid fa-box-archive"></i> 卸下' : '<i class="fa-solid fa-shield-halved"></i> 裝備'} · ${escapeHtml(equipSlot)}</button>`
        : '';
      extra = `<div class="uib-detail-section"><span>法寶資訊</span>${item.raw?.weaponForm ? `<p>器型：${escapeHtml(item.raw.weaponForm)}</p>` : ''}${item.raw?.forgeMethod && item.raw.forgeMethod !== '自由發揮' ? `<p>煉器手法：${escapeHtml(item.raw.forgeMethod)}</p>` : ''}<p>二次煉製深度：${item.refinementDepth || 0}/${MAX_ARTIFACT_RECIPE_NESTING}</p>${hasEquip ? `<p>法寶戰力：<b>${itemPower.toLocaleString("zh-TW")}</b>（境界品質及裝備效果）</p>` : ""}${hasEquip ? `<p>裝備欄位：<b>${escapeHtml(equipSlot)}</b></p>` : ''}${replacing ? `<p>裝備後會替換：<b>${escapeHtml(replacing.name)}</b></p>` : ''}</div><div class="uib-detail-section"><span>法寶效果</span>${item.effects.length
        ? `<ul>${item.effects.map((effect) => `<li>${escapeHtml(effectLabel(effect))}</li>`).join('')}</ul>`
        : '<p>目前沒有額外效果資料。</p>'}${equippedHere ? '<p class="uib-equipped-note"><i class="fa-solid fa-circle-check"></i> 目前已裝備，效果正在生效</p>' : ''}${equipAction}</div>`;
    } else if (item.type === 'material') {
      extra = item.raidKey
        ? `<div class="uib-detail-section uib-raid-key-detail"><span><i class="fa-solid fa-stamp"></i> 團本煉器印記</span><p>分類：團本印記</p><p>用途：${item.id === RAID_REFINEMENT_KEYS[2] ? '第二次煉製的必要印記。' : '第三次煉製的必要道印。'}</p><p>取得方式：擊敗團本 Boss 後由伺服器結算發放；不可由一般題目、洞天或系統商店取得。</p><p>持有數量：<b>×${item.quantity}</b></p></div>`
        : `<div class="uib-detail-section"><span>材料資訊</span><p>分類：${escapeHtml(item.category)}</p><p>坊市參考單價：${materialMarketReferencePrice(item.realm).toLocaleString()} 金幣 · ${item.buyGold > 0 ? `系統採購價：${item.buyGold} 金幣` : '不可直接向系統採購'}</p></div>`;
    } else if (item.id === 'revival-pill') {
      extra = `<div class="uib-detail-section"><span>使用效果</span><p>服用後立即增加 ${item.cultivationGain || 100} 修為。</p><button type="button" class="uib-use-btn" data-uib-use="revival-pill">服用一顆</button></div>`;
    }

    modal.innerHTML = `<section class="uib-modal uib-modal-${escapeHtml(item.type)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.name)}" style="--uib-quality:${escapeHtml(color)}">
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
    modal.querySelector('[data-uib-equip]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!window.toggleEquipArtifact || button?.disabled) return;
      button.disabled = true;
      try {
        await window.toggleEquipArtifact(button.dataset.uibEquip);
        equipmentPickSlot = '';
        close();
      } catch (error) {
        button.disabled = false;
        console.warn('[Unified bag equip]', error);
      } finally {
        scheduleRender(true);
      }
    });
    document.body.appendChild(modal);
  }

  function bindRoot(root) {
    root.querySelector('#uib-filter-type')?.addEventListener('change', (event) => {
      filterType = event.target.value || 'all';
      equipmentPickSlot = '';
      scheduleRender(true);
    });
    root.querySelector('#uib-sort-mode')?.addEventListener('change', (event) => {
      sortMode = event.target.value || 'type-quality';
      scheduleRender(true);
    });
    root.querySelectorAll('[data-uib-item]').forEach((button) => {
      button.addEventListener('click', async () => {
        const key = button.dataset.uibItem;
        const item = lastItems.get(key);
        if (!equipmentPickSlot || !item || item.type !== 'artifact' || artifactSlot(item.raw) !== equipmentPickSlot) {
          openDetails(key);
          return;
        }
        // 點選裝配格後，再點相符法寶就直接裝配，不必先開詳情、再按第二次。
        if (button.disabled || !window.toggleEquipArtifact) return;
        if (!artifactCanEquip(item.raw)) {
          openDetails(key); // 其他原因（非裝備型或資料不完整）仍可查看。
          return;
        }
        button.disabled = true;
        try {
          await window.toggleEquipArtifact(item.id);
          equipmentPickSlot = '';
        } catch (error) {
          console.error('[Equipment slot] equip failed:', error);
          button.disabled = false;
          // 技術細節只送管理員 Debugger；讓玩家仍能繼續操作。
          openDetails(key);
        } finally {
          scheduleRender(true);
        }
      });
    });
    root.querySelectorAll('[data-uib-equipped-item]').forEach((button) => {
      button.addEventListener('click', () => openDetails(button.dataset.uibEquippedItem));
    });
    root.querySelectorAll('[data-uib-empty-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        equipmentPickSlot = button.dataset.uibEmptySlot || '';
        filterType = 'artifact';
        scheduleRender(true);
      });
    });
    root.querySelector('[data-uib-cancel-equip]')?.addEventListener('click', () => { equipmentPickSlot = ''; scheduleRender(true); });
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
      equipmentPickSlot,
      items: allItems.map((item) => [item.key, item.quantity, item.realm, item.name, item.equipped ? 1 : 0]),
      equipment: ARTIFACT_EQUIP_SLOTS.map((slot) => [slot, equippedIdForSlot(slot)])
    });
    const root = document.getElementById(ROOT_ID);
    if (!force && root?.dataset.signature === signature && root.closest('#training-tab-content') === content) return;

    // 修煉模組每次切分頁都可能重建 content；統一背包在其後接手背包內容。
    content.innerHTML = rootMarkup(allItems, view);
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
    equipmentPickSlot = '';
    render(true);
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;box-sizing:border-box}
      .uib-equipment-view{overflow:auto;min-height:0;overscroll-behavior:contain}
      .uib-equipment-available{display:flex;justify-content:space-between;align-items:center;color:#ddbf79;font-size:12px;font-weight:900}
      .uib-equipment-available small{font-size:10px;color:#978465;font-weight:400}
      .uib-equipment-panel{flex:0 0 auto;width:100%;min-width:0;padding:clamp(12px,1.4vw,20px);border:1px solid rgba(216,177,93,.3);border-radius:18px;background:radial-gradient(ellipse at 50% -40%,rgba(186,137,55,.15),transparent 65%),linear-gradient(145deg,#17130d,#080807)}
      .uib-equipment-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.uib-equipment-head b{color:#ecd9ae;font-size:clamp(12px,1.15vw,17px)}.uib-equipment-head b i{margin-right:7px;color:#c8a15b}.uib-equipment-head em{padding:4px 10px;border:1px solid rgba(216,177,93,.28);border-radius:999px;color:#ebca80;font-size:12px;font-style:normal}
      .uib-equipment-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(7px,1vw,14px)}
      .uib-equip-slot{position:relative;min-width:0;min-height:clamp(137px,17dvh,185px);padding:12px 7px;display:flex;flex-direction:column;align-items:center;gap:8px;border:1px solid rgba(216,177,93,.2);border-radius:16px;background:linear-gradient(145deg,#211a10,#080807);text-align:center;color:#ab9879;transition:border-color .15s,transform .15s;overflow:hidden}
      .uib-equip-slot:before{content:"";position:absolute;inset:5px;border:1px solid rgba(216,177,93,.08);border-radius:11px;pointer-events:none}.uib-equip-slot:hover,.uib-equip-slot:focus-visible{border-color:#dfbd78;transform:translateY(-2px);outline:none}.uib-equip-slot.is-picking{border-color:#f6d58b;box-shadow:0 0 24px rgba(221,178,91,.17)}.uib-equip-slot.is-filled{border-color:color-mix(in srgb,var(--uib-quality) 60%,#47361a);background:radial-gradient(circle at 50% 42%,color-mix(in srgb,var(--uib-quality) 14%,transparent),transparent 65%),#100e0a}
      .uib-equip-slot-label{color:#dfc186;font-size:clamp(10px,1vw,14px);font-weight:900;white-space:nowrap}.uib-equip-slot-label i{margin-right:5px;color:#bc9959}
      .uib-equip-slot-frame{display:grid;place-items:center;flex:1;width:clamp(54px,7.5dvh,82px);min-height:54px;max-height:82px;aspect-ratio:1;border:1px dashed rgba(216,177,93,.3);border-radius:17px;background:#0d0c09;color:#8c7853;font-size:clamp(22px,3vw,35px)}.uib-equip-slot-frame.is-artifact{border-style:solid;border-color:var(--uib-quality);color:var(--uib-quality);background:radial-gradient(circle,color-mix(in srgb,var(--uib-quality) 17%,#0d0c09),#0d0c09);text-shadow:0 0 12px var(--uib-quality)}
      .uib-equip-slot-name,.uib-equip-slot-hint{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.uib-equip-slot-name{color:#eaddc6;font-size:clamp(11px,1vw,15px)}.uib-equip-slot-hint{color:#978567;font-size:clamp(9px,.75vw,11px)}.uib-equip-slot.is-filled .uib-equip-slot-hint{color:var(--uib-quality)}
      .uib-equip-picker{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid rgba(216,177,93,.28);border-radius:11px;padding:9px 12px;color:#ecd6a0;font-size:12px;background:rgba(216,177,93,.07)}.uib-equip-picker button{padding:6px 12px;border:1px solid rgba(216,177,93,.3);border-radius:8px;color:#ecd6a0}
      .uib-toolbar{flex:0 0 auto;display:flex;align-items:end;gap:8px;padding:9px 10px;border:1px solid rgba(216,177,93,.16);border-radius:14px;background:rgba(13,11,8,.84)}
      .uib-summary{display:grid;gap:2px;margin-right:auto}.uib-summary b{color:#f0dfb6;font-size:11px}.uib-summary span{color:#847864;font-size:7px}.uib-toolbar label{display:grid;gap:3px;color:#8e816c;font-size:6px;font-weight:900}.uib-toolbar select{min-width:126px;height:32px;padding:0 28px 0 9px;border:1px solid rgba(216,177,93,.2);border-radius:9px;background:#090807;color:#e2d5ba;font-size:8px;outline:none}
      .uib-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,140px));grid-auto-rows:max-content;align-content:start;justify-content:start;gap:10px;padding:2px 4px 12px 2px;scrollbar-width:thin;scrollbar-color:rgba(216,177,93,.26) transparent}
      .uib-item{position:relative;aspect-ratio:1/1;min-width:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:12px 8px 9px;border:1px solid color-mix(in srgb,var(--uib-quality) 42%,rgba(255,255,255,.08));border-radius:16px;background:radial-gradient(circle at 50% 27%,color-mix(in srgb,var(--uib-quality) 15%,transparent),transparent 46%),linear-gradient(145deg,rgba(22,18,12,.96),rgba(7,7,7,.98));color:#eee2ca;text-align:center;box-shadow:inset 0 0 22px rgba(255,255,255,.015);transition:.15s ease;overflow:hidden}.uib-item:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--uib-quality) 72%,#fff 8%);box-shadow:0 10px 24px rgba(0,0,0,.25)}.uib-item.uib-raid-key{border-color:color-mix(in srgb,var(--uib-quality) 68%,#e7c779);background:radial-gradient(circle at 50% 24%,rgba(231,199,121,.2),transparent 48%),linear-gradient(145deg,#20180d,#080807);box-shadow:inset 0 0 25px rgba(231,199,121,.04)}.uib-raid-key-badge{position:absolute;left:6px;top:6px;padding:2px 5px;border:1px solid rgba(231,199,121,.3);border-radius:999px;background:rgba(35,24,9,.88);color:#e7c779;font-size:5.5px;font-weight:900;letter-spacing:.04em}.uib-raid-key-badge i{margin-right:2px}
      .uib-icon{width:46px;height:46px;display:grid;place-items:center;overflow:hidden;border-radius:13px;border:1px solid color-mix(in srgb,var(--uib-quality) 58%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:15px;font-weight:900;box-shadow:0 0 20px color-mix(in srgb,var(--uib-quality) 12%,transparent)}.uib-icon img,.uib-equip-slot-frame img{width:100%;height:100%;display:block;object-fit:cover}.uib-equip-slot-frame{overflow:hidden}.uib-name{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee2ca;font-size:8px;font-weight:900}.uib-bottom{width:100%;display:flex;justify-content:space-between;gap:5px;align-items:center}.uib-bottom small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#827661;font-size:6px}.uib-bottom em{color:var(--uib-quality);font-size:6px;font-style:normal;white-space:nowrap}.uib-qty{position:absolute;right:7px;top:7px;padding:2px 5px;border-radius:999px;background:rgba(0,0,0,.64);border:1px solid rgba(255,255,255,.08);color:#ead49a;font-size:7px;font-weight:900}.uib-equipped{position:absolute;left:7px;top:7px;color:#f6d77e;font-size:8px}
      /* Materials are round mineral tokens; forged artifacts retain angular framed emblems. */
      .uib-item[data-uib-item^="material:"] .uib-icon,.uib-modal-material .uib-modal-icon{border-radius:50%!important;background:radial-gradient(circle at 31% 25%,color-mix(in srgb,var(--uib-quality) 36%,#fff),color-mix(in srgb,var(--uib-quality) 14%,#16110a) 43%,#0b0b09 100%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.07),0 0 12px color-mix(in srgb,var(--uib-quality) 12%,transparent)}
      .uib-item[data-uib-item^="artifact:"] .uib-icon,.uib-modal-artifact .uib-modal-icon{border-radius:12px;box-shadow:inset 0 0 0 2px rgba(255,235,169,.1),0 0 17px color-mix(in srgb,var(--uib-quality) 16%,transparent)}
      .uib-empty{flex:1;min-height:180px;display:grid;place-items:center;align-content:center;gap:7px;color:#706653;text-align:center}.uib-empty i{font-size:25px}.uib-empty b{color:#a99b80;font-size:10px}.uib-empty span{font-size:7px}
      .uib-raid-key-detail{border-color:rgba(231,199,121,.26);background:rgba(231,199,121,.035)}.uib-raid-key-detail>span{color:#e7c779}.uib-raid-key-detail b{color:#f1d791}
      .uib-modal-backdrop{position:fixed;inset:0;z-index:16050;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.uib-modal{width:min(100%,540px);max-height:88dvh;overflow:auto;padding:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 48%,rgba(255,255,255,.08));border-radius:20px;background:linear-gradient(150deg,#18140e,#080808);box-shadow:0 30px 100px rgba(0,0,0,.72)}.uib-modal-head{display:grid;grid-template-columns:58px minmax(0,1fr) 34px;gap:11px;align-items:center}.uib-modal-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:16px;border:1px solid color-mix(in srgb,var(--uib-quality) 55%,transparent);background:color-mix(in srgb,var(--uib-quality) 11%,#090807);color:var(--uib-quality);font-size:18px;font-weight:900}.uib-modal-head small{display:block;color:#857965;font-size:7px}.uib-modal-head h3{margin:3px 0;color:#f1e4c9;font-size:15px}.uib-modal-head span{color:var(--uib-quality);font-size:8px}.uib-close{width:32px;height:32px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.025);color:#a99d87}.uib-description{margin-top:14px;padding:11px;border-radius:12px;background:rgba(255,255,255,.025);color:#a99b83;font-size:9px;line-height:1.7}.uib-detail-section{margin-top:10px;padding:11px;border:1px solid rgba(216,177,93,.12);border-radius:12px}.uib-detail-section>span{display:block;margin-bottom:7px;color:#d3b86f;font-size:8px;font-weight:900}.uib-detail-section p,.uib-detail-section li{margin:4px 0;color:#9b8e77;font-size:8px;line-height:1.55}.uib-detail-section ul{margin:0;padding-left:17px}.uib-equipped-note{color:#e3c36e!important}.uib-use-btn,.uib-equip-btn{width:100%;min-height:38px;margin-top:9px;border:1px solid rgba(216,177,93,.38);border-radius:11px;background:rgba(216,177,93,.09);color:#f0d99a;font-size:9px;font-weight:900}.uib-use-btn:disabled,.uib-equip-btn:disabled{opacity:.45}.uib-equip-btn:not(:disabled):hover{border-color:#e2c069;background:rgba(216,177,93,.14)}
      @media(max-width:700px){.uib-equipment-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.uib-equip-slot{min-height:136px}.uib-equip-slot-frame{width:58px;min-height:58px}.uib-toolbar{align-items:stretch;flex-wrap:wrap}.uib-summary{width:100%;margin-right:0}.uib-toolbar label{flex:1;min-width:120px}.uib-toolbar select{width:100%;min-width:0}.uib-grid{grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:8px}.uib-item{max-width:140px;justify-self:start}}
      @media(max-width:420px){.uib-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.uib-item{max-width:none;padding:9px 6px}.uib-icon{width:40px;height:40px}.uib-name{font-size:7px}.uib-bottom small,.uib-bottom em{font-size:5.5px}}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyle();
    scheduleRender(true);
    [
      'material-system-updated', 'artifact-system-updated', 'material-catalog-updated', 'artifact-catalog-updated',
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
