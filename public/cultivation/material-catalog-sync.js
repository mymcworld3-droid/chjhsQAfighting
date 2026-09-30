// 團本素材目錄為固定本地規則，不再由 Firebase gameConfig 同步。
let resolveMaterialCatalogReady;
export const featureReady = new Promise((resolve) => { resolveMaterialCatalogReady = resolve; });

function markReady() {
  if (window.__materialCatalogStartupReady) return;
  window.__materialCatalogStartupReady = true;
  resolveMaterialCatalogReady({ ok:true, source:'local-fixed-catalog' });
  window.dispatchEvent(new CustomEvent('xiuxian:material-catalog-startup-ready', {
    detail:{ source:'local-fixed-catalog' }
  }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', markReady, { once:true });
} else {
  markReady();
}
