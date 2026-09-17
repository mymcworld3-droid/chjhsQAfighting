import { MATERIAL_CATALOG, getMaterialById, materialRealmColor } from './material-catalog.js';

// 將材料境界顏色套用到材料庫、煉器、管理員與配方介面。
(function () {
  'use strict';

  const STYLE_ID = 'material-realm-ui-style';
  let queued = false;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [data-material-realm]{--material-realm-color:#d4d4d8}
      [data-material-realm] :is(.material-store-icon,.refinery-mat-icon,.amm-icon){
        color:var(--material-realm-color)!important;
        border-color:color-mix(in srgb,var(--material-realm-color) 48%,transparent)!important;
        box-shadow:0 0 16px color-mix(in srgb,var(--material-realm-color) 14%,transparent),inset 0 0 12px color-mix(in srgb,var(--material-realm-color) 8%,transparent)!important;
      }
      [data-material-realm].refinery-slot{
        border-color:color-mix(in srgb,var(--material-realm-color) 44%,transparent)!important;
        color:var(--material-realm-color)!important;
        box-shadow:inset 0 0 18px color-mix(in srgb,var(--material-realm-color) 8%,transparent)!important;
      }
      .material-realm-badge{
        display:inline-flex;align-items:center;width:max-content;margin-top:3px;padding:2px 6px;border-radius:999px;
        border:1px solid color-mix(in srgb,var(--material-realm-color) 40%,transparent);
        background:color-mix(in srgb,var(--material-realm-color) 10%,transparent);
        color:var(--material-realm-color);font-size:6px;font-weight:900;letter-spacing:.08em;line-height:1.3;
      }
      .amm-recipe-row[data-material-realm]{border-color:color-mix(in srgb,var(--material-realm-color) 24%,rgba(255,255,255,.07))!important}
      .amm-recipe-row[data-material-realm] label{color:color-mix(in srgb,var(--material-realm-color) 68%,#eee1c7)!important}
    `;
    document.head.appendChild(style);
  }

  function applyRealm(node, material) {
    if (!node || !material) return;
    const color = materialRealmColor(material.realm);
    if (node.dataset.materialRealm !== material.realm) node.dataset.materialRealm = material.realm;
    if (node.style.getPropertyValue('--material-realm-color') !== color) node.style.setProperty('--material-realm-color', color);
  }

  function badge(host, material) {
    if (!host || !material) return;
    let badgeNode = host.querySelector(':scope > .material-realm-badge');
    if (!badgeNode) {
      badgeNode = document.createElement('span');
      badgeNode.className = 'material-realm-badge';
      host.appendChild(badgeNode);
    }
    applyRealm(host.closest('[data-material-realm]') || host, material);
    if (badgeNode.textContent !== material.realm) badgeNode.textContent = material.realm;
  }

  function decorateRefineryMaterials() {
    document.querySelectorAll('.refinery-material[data-refinery-material]').forEach((node) => {
      const material = getMaterialById(node.dataset.refineryMaterial);
      if (!material) return;
      applyRealm(node, material);
      badge(node.querySelector('.refinery-mat-copy'), material);
    });
    document.querySelectorAll('.refinery-slot.filled').forEach((node) => {
      const name = node.querySelector('.name')?.textContent?.trim();
      const material = MATERIAL_CATALOG.find((item) => item.name === name);
      if (material) applyRealm(node, material);
    });
  }

  function decorateMaterialStore() {
    document.querySelectorAll('.material-store-item').forEach((node) => {
      const id = node.querySelector('[data-material-buy]')?.dataset.materialBuy;
      const material = getMaterialById(id);
      if (!material) return;
      applyRealm(node, material);
      badge(node.querySelector('.material-store-copy'), material);
    });
  }

  function decorateAdmin() {
    document.querySelectorAll('#admin-material-list .amm-item').forEach((node) => {
      const id = node.querySelector('[data-material-edit]')?.dataset.materialEdit;
      const material = getMaterialById(id);
      if (!material) return;
      applyRealm(node, material);
      badge(node.querySelector('.amm-copy'), material);
    });
    document.querySelectorAll('.amm-recipe-row').forEach((node) => {
      const id = node.querySelector('[data-recipe-material]')?.dataset.recipeMaterial;
      const material = getMaterialById(id);
      if (!material) return;
      applyRealm(node, material);
      badge(node.querySelector('label'), material);
    });
  }

  function decorate() {
    queued = false;
    ensureStyle();
    decorateRefineryMaterials();
    decorateMaterialStore();
    decorateAdmin();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(decorate);
  }

  function boot() {
    ensureStyle();
    schedule();
    window.addEventListener('material-catalog-updated', schedule);
    window.addEventListener('material-system-updated', schedule);
    window.addEventListener('artifact-recipes-updated', schedule);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
