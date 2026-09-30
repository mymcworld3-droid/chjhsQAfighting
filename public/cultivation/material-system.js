import { MATERIAL_CATALOG, getMaterialById } from './material-catalog.js';

// 素材本身不再由前端直接連 Firebase。
// 此模組只提供本地查詢／顯示；實際產出由團本伺服器結算，交易由市集流程處理。
(function () {
  'use strict';

  function userData() {
    try { return window.getCurrentUserData?.() || {}; } catch (_) { return {}; }
  }
  function qty(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
  function inventory() {
    const source = userData()?.materialSystem?.inventory || {};
    const out = {};
    for (const item of MATERIAL_CATALOG) {
      const count = qty(source[item.id]);
      if (count > 0) out[item.id] = count;
    }
    return out;
  }
  function materialQuantity(materialId) {
    return qty(inventory()[String(materialId || '')]);
  }
  function snapshot() {
    return {
      inventory: inventory(),
      items: MATERIAL_CATALOG.map((item) => ({
        ...item,
        quantity: materialQuantity(item.id)
      }))
    };
  }

  window.getXiuxianMaterialInventory = inventory;
  window.getXiuxianMaterialQuantity = materialQuantity;
  window.getXiuxianMaterialSnapshot = snapshot;
  window.getXiuxianMaterialDefinition = getMaterialById;
  window.dispatchEvent(new CustomEvent('material-system-updated', {
    detail:{ ...snapshot(), source:'local-readonly' }
  }));
})();
