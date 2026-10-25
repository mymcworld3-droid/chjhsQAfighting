import {ensureInventoryGridStyle as ensureStyle} from './inventory-grid-style.js';
import {} from './nascent-growth.js';
import { soulboundItemFrameMarkup } from './soulbound-item-frame.js';
import { ARTIFACT_CATALOG, ARTIFACT_EQUIP_SLOTS, getArtifactById, realmForScore, realmOrderByName } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  getMaterialById,
  materialRealmColor,
  materialRealmOrderByName,
  materialMarketReferencePrice,
  artifactRecipeDepth,
  MAX_ARTIFACT_RECIPE_NESTING,
  RAID_REFINEMENT_KEYS,
  RAID_CRAFT_MATERIAL_IDS
} from './material-catalog.js';

// 統一修煉背包：法寶、材料、消耗道具共用正方形格子；點擊後才顯示詳細資料。
(function () {
  'use strict';

  const ROOT_ID = 'unified-cultivation-bag';
  const MODAL_ID = 'unified-bag-detail-modal';
  const TYPE_ORDER = Object.freeze({ artifact: 0, material: 1, consumable: 2, training: 3 });
  const RAID_KEY_IDS = new Set(Object.values(RAID_REFINEMENT_KEYS));
  const RAID_CRAFT_IDS = new Set(RAID_CRAFT_MATERIAL_IDS);
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
  function fragmentBalance() { return qty(userData()?.forgeFragments); }
  function imageMarkup(imageUrl, fallback, alt = '') {
    const url = String(imageUrl || '').trim();
    if (!url) return escapeHtml(fallback || '◆');
    return `<img class="ui-content-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="ui-content-fallback" hidden>${escapeHtml(fallback || '◆')}</span>`;
  }
  function typeLabel(type) {
    if (type === 'artifact') return '法寶';
    if (type === 'material') return '材料';
    if (type === 'consumable') return '消耗道具';
    return '修煉物品';
  }
  function qualityColor(realm) { return REALM_COLORS[realm] || materialRealmColor(realm) || '#d4d4d8'; }
  function artifactEquipped(id) {
    if(window.QA_WEAPON_SYSTEM_ENABLED)return false;
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
    if(window.QA_WEAPON_SYSTEM_ENABLED)return '';
    return String(userData()?.artifactSystem?.equipped?.[slot] || '');
  }
  const EQUIPMENT_ICONS = Object.freeze({
    本命法寶:'fa-khanda', 護身法寶:'fa-shield-halved', 佩飾法寶:'fa-gem', 輔助法寶:'fa-wand-magic-sparkles'
  });
  function equipmentSlotMarkup(slot) {
    const id = equippedIdForSlot(slot), item = getArtifactById(id);
    const valid = !!item && qty(userData()?.artifactSystem?.inventory?.[id]) > 0 && artifactSlot(item) === slot;
    const icon = EQUIPMENT_ICONS[slot] || 'fa-gem';
    const soulbound = slot === '本命法寶';
    const soulboundClass = soulbound ? ' is-soulbound' : '';
    const label = `<span class="uib-equip-slot-label"><i class="fa-solid ${icon}"></i> ${escapeHtml(slot)}</span>`;
    const crest = soulbound
      ? '<span class="uib-soulbound-crest" aria-hidden="true"><i class="fa-solid fa-dharmachakra"></i></span><span class="uib-soulbound-caption">SOULBOUND · 本命契印</span>'
      : '';
    if (!valid) {
      const canEquipOwned = soulbound && Object.entries(userData()?.artifactSystem?.inventory || {}).some(([artifactId, count]) =>
        qty(count) > 0 && artifactSlot(getArtifactById(artifactId)) === slot);
      const hint = soulbound
        ? (canEquipOwned ? '點擊選擇本命法器' : '尚未持有本命法器')
        : '點擊裝配';
      return `<button type="button" class="uib-equip-slot is-empty${soulboundClass}${equipmentPickSlot === slot ? ' is-picking' : ''}" data-uib-empty-slot="${escapeHtml(slot)}" aria-label="${escapeHtml(slot)}：${escapeHtml(hint)}">${crest}${label}
        <span class="uib-equip-slot-frame${soulbound ? ' is-soulbound-frame' : ''}">${soulbound ? soulboundItemFrameMarkup() + '<i class="fa-solid fa-khanda"></i>' : '<i class="fa-solid fa-plus"></i>'}</span>
        <b class="uib-equip-slot-name">空裝備欄</b><small class="uib-equip-slot-hint">${hint}</small></button>`;
    }
    const color = qualityColor(item.realm);
    return `<button type="button" class="uib-equip-slot is-filled${soulboundClass}" data-uib-equipped-item="artifact:${escapeHtml(id)}" style="--uib-quality:${escapeHtml(color)}">${crest}${label}
      <span class="uib-equip-slot-frame is-artifact${soulbound ? ' is-soulbound-frame' : ''}">${soulbound ? soulboundItemFrameMarkup() : ''}${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</span><b class="uib-equip-slot-name">${escapeHtml(item.name)}</b>
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

    Object.entries(globalThis.QANascentGrowth.prepare(data).inventory).forEach(([id, value]) => {
      const quantity = qty(value);
      if (!quantity) return;
      const item = id === globalThis.QANascentGrowth.ITEM_ID ? globalThis.QANascentGrowth.ITEM : getMaterialById(id);
      if (!item) return;
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
        nascentMaterial: item.nascentMaterial === true,
        raidKey: RAID_KEY_IDS.has(id),
        raidMaterial: RAID_CRAFT_IDS.has(id),
        raw: item
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
    if(window.QA_WEAPON_SYSTEM_ENABLED&&tab==='equipment')return '';
    return tab === 'equipment' || tab === 'bag' ? tab : '';
  }

  function itemMarkup(item) {
    const color = qualityColor(item.realm);
    const soulbound = item.type === 'artifact' && item.raw?.equipSlot === '本命法寶';
    return `<button type="button" class="uib-item${soulbound ? ' is-soulbound' : ''} ${item.nascentMaterial ? 'uib-nascent uib-raid-key' : ''} ${item.raidKey || item.raidMaterial ? 'uib-raid-key' : ''}" data-uib-item="${escapeHtml(item.key)}" style="--uib-quality:${escapeHtml(color)}" aria-label="查看 ${escapeHtml(item.name)} 詳細資料">
      <span class="uib-qty">×${item.quantity}</span>
      ${item.equipped ? '<span class="uib-equipped"><i class="fa-solid fa-circle-check"></i></span>' : ''}
      ${item.nascentMaterial ? '<span class="uib-raid-key-badge uib-nascent-badge">元嬰</span>' : ''}
      ${item.raidKey || item.raidMaterial ? '<span class="uib-raid-key-badge"><i class="fa-solid fa-stamp"></i> 團本</span>' : ''}
      <span class="uib-icon">${soulbound ? soulboundItemFrameMarkup() : ''}${imageMarkup(item.imageUrl, item.icon || '◆', item.name)}</span>
      <span class="uib-name">${escapeHtml(item.name)}</span>
      <span class="uib-bottom"><small>${escapeHtml(item.raidKey ? '團本印記' : item.raidMaterial ? '團本煉器素材' : typeLabel(item.type))}</small><em>${escapeHtml(item.realm || '凡人')}</em></span>
    </button>`;
  }

  function rootMarkup(allItems, view = 'bag') {
    if (view === 'equipment') {
      const ownedArtifacts = allItems.filter((item) => item.type === 'artifact');
      const equippedCandidates = ownedArtifacts.filter((item) => !!artifactSlot(item.raw));
      const equipmentItems = equippedCandidates
        .filter((item) => !equipmentPickSlot || artifactSlot(item.raw) === equipmentPickSlot)
        .sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hant'));
      const noEquipmentHint = equipmentPickSlot === '本命法寶'
        ? '取得本命法器後，即可在此選擇裝配。'
        : ownedArtifacts.length && !equippedCandidates.length
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
        <div class="uib-fragment-balance" aria-label="持有煉器碎片"><span>煉器碎片</span><b data-uib-fragment-balance>${fragmentBalance().toLocaleString('zh-TW')}</b></div>
        <button type="button" class="uib-dismantle-btn" data-inventory-dismantle>物品分解</button>
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
    if (effect?.type === 'equip_streak_damage_percent') return `每連答三題當次增傷 +${pct(effect.value)}`;
    if (effect?.type === 'equip_damage_percent') return `鬥法傷害 +${pct(effect.value)}`;
    if (effect?.type === 'equip_damage_reduction_flat') return `每次受傷固定 -${Number(effect.value) || 0}`;
    if (effect?.type === 'equip_damage_reduction_percent') return `受到傷害 -${pct(effect.value)}`;
    if (effect?.type === 'equip_crit_chance') return `暴擊率 +${pct(effect.value)}`;
    if (effect?.type === 'equip_crit_damage_percent') return `暴擊額外傷害 +${pct(effect.value)}`;
    if (effect?.type === 'equip_combo_damage_percent') return `連擊傷害 +${pct(effect.value)}（基礎 30%）`;
    if (effect?.type === 'equip_combo_chance') return `連擊率 ${pct(effect.value)}`;
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
    const soulbound = item.type === 'artifact' && item.raw?.equipSlot === '本命法寶';
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
      const hasEquip = !window.QA_WEAPON_SYSTEM_ENABLED && artifactHasEquipEffects(rawArtifact);
      const canEquip = artifactCanEquip(rawArtifact);
      const itemPower = Math.max(0, Number(window.calculateArtifactPower?.(rawArtifact)) || 0);
      const equipAction = hasEquip && equipSlot
        ? `<button type="button" class="uib-equip-btn" data-uib-equip="${escapeHtml(item.id)}" ${!equippedHere && !canEquip ? 'disabled' : ''}>${equippedHere ? '<i class="fa-solid fa-box-archive"></i> 卸下' : '<i class="fa-solid fa-shield-halved"></i> 裝備'} · ${escapeHtml(equipSlot)}</button>`
        : '';
      extra = `<div class="uib-detail-section"><span>法寶資訊</span>${item.raw?.weaponForm ? `<p>器型：${escapeHtml(item.raw.weaponForm)}</p>` : ''}${item.raw?.forgeMethod && item.raw.forgeMethod !== '自由發揮' ? `<p>煉器手法：${escapeHtml(item.raw.forgeMethod)}</p>` : ''}<p>二次煉製深度：${item.refinementDepth || 0}/${MAX_ARTIFACT_RECIPE_NESTING}</p>${hasEquip ? `<p>法寶戰力：<b>${itemPower.toLocaleString("zh-TW")}</b>（境界品質及裝備效果）</p>` : ""}${hasEquip ? `<p>裝備欄位：<b>${escapeHtml(equipSlot)}</b></p>${equipSlot === '本命法寶' ? '<p>取得方式：契器台常駐靈石抽取。已持有本命法寶可投入八方煉器陣進行後續精煉。</p>' : ''}` : ''}${replacing ? `<p>裝備後會替換：<b>${escapeHtml(replacing.name)}</b></p>` : ''}</div><div class="uib-detail-section"><span>法寶效果</span>${item.effects.length
        ? `<ul>${item.effects.map((effect) => `<li>${escapeHtml(effectLabel(effect))}</li>`).join('')}</ul>`
        : '<p>目前沒有額外效果資料。</p>'}${equippedHere ? '<p class="uib-equipped-note"><i class="fa-solid fa-circle-check"></i> 目前已裝備，效果正在生效</p>' : ''}${equipAction}</div>`;
      if(window.QA_WEAPON_SYSTEM_ENABLED&&artifactHasEquipEffects(rawArtifact))extra='<div class="uib-detail-section"><span>舊裝備藏品</span><p>原有裝備已改為單一主武器。此物可在尋器頁傳承為兵器匣。</p><button type="button" class="uib-use-btn" data-uib-contract>前往尋器傳承</button></div>';
    } else if (item.type === 'material') {
      extra = item.nascentMaterial ? `<div class="uib-detail-section"><span>元嬰養成</span><p>用途：升級修為、攻擊、生命及金丹屬性分支；化神後亦可提升本命神通。</p><p>不可交易或煉器。可於修煉 → 元嬰／元神使用。</p><p>持有數量：<b>×${item.quantity}</b></p></div>` : item.raidKey || item.raidMaterial
        ? `<div class="uib-detail-section uib-raid-key-detail"><span><i class="fa-solid fa-stamp"></i> ${item.raidKey ? '團本印記' : '團本煉器素材'}</span><p>分類：${item.raidKey ? '煉製階段印記' : '八方煉器陣素材'}</p><p>用途：${item.id === RAID_REFINEMENT_KEYS[2] ? '第二次煉製的必要印記，不佔素材格。' : item.id === RAID_REFINEMENT_KEYS[3] ? '第三次煉製的必要印記，不佔素材格。' : escapeHtml(item.name) + '，可直接放入八方煉器陣。'}</p><p>取得方式：素材只能由對應團本產生，但木／鐵素材可在玩家市集轉手；問道、洞天與系統商店不會產出。</p><p>持有數量：<b>×${item.quantity}</b></p></div>`
        : `<div class="uib-detail-section"><span>材料資訊</span><p>分類：${escapeHtml(item.category)}</p></div>`;
      if(window.QA_WEAPON_SYSTEM_ENABLED&&!item.nascentMaterial&&(item.raidKey||item.raidMaterial))extra='<div class="uib-detail-section"><span>舊鍛造材料</span><p>兵器不再需要配方；此物可在尋器頁傳承為靈石。元嬰養成資源不參與轉換。</p><button type="button" class="uib-use-btn" data-uib-contract>前往尋器傳承</button></div>';
    } else if (item.id === 'revival-pill') {
      extra = `<div class="uib-detail-section"><span>使用效果</span><p>服用後立即增加 ${item.cultivationGain || 100} 修為。</p><button type="button" class="uib-use-btn" data-uib-use="revival-pill">服用一顆</button></div>`;
    }

    modal.innerHTML = `<section class="uib-modal uib-modal-${escapeHtml(item.type)}${soulbound ? ' uib-modal-soulbound' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.name)}" style="--uib-quality:${escapeHtml(color)}">
      <div class="uib-modal-head"><div class="uib-modal-icon">${soulbound ? soulboundItemFrameMarkup() + imageMarkup(item.imageUrl, item.icon || '◆', item.name) : escapeHtml(item.icon || '◆')}</div><div><small>${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.category || '')}</small><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.realm || '凡人')} · 持有 ×${item.quantity}</span></div><button type="button" class="uib-close" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="uib-description">${escapeHtml(item.description || '沒有說明。')}</div>
      ${extra}
      ${item.raw?.equipSlot === '本命法寶' ? '<button type="button" class="uib-use-btn" data-uib-contract>前往尋器</button>' : ''}
    </section>`;

    const close = () => modal.remove();
    modal.querySelector('.uib-close')?.addEventListener('click', close);
    modal.querySelector('[data-uib-contract]')?.addEventListener('click', () => { close(); window.openSoulboundDraw?.(); });
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
      fragments: fragmentBalance(),
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
    if(window.QA_WEAPON_SYSTEM_ENABLED){window.openWeaponForge?.();return;}
    equipmentPickSlot = '';
    render(true);
  };


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
