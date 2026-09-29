import { ARTIFACT_CATALOG, getArtifactById, realmOrderByName } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  ARTIFACT_RECIPES,
  getMaterialById,
  materialRealmOrderByName
} from './material-catalog.js';

// 啟動資源預熱：玩家資料已由 main-legacy 載入，本模組只在 startup gate 期間
// 整理法寶／材料／配方與常用圖片，避免第一次打開背包、裝備或煉器才等待。
const STARTUP_IMAGE_LIMIT = 28;
const STARTUP_TIMEOUT_MS = 5200;
const IMAGE_CONCURRENCY = 4;

function userData() {
  try { return window.getCurrentUserData?.() || {}; } catch (_) { return {}; }
}

function qty(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dispatchProgress(phase, loaded = 0, total = 0, extra = {}) {
  window.dispatchEvent(new CustomEvent('xiuxian:startup-resource-progress', {
    detail: { phase, loaded, total, ...extra }
  }));
}

function recipeMaterialIdsForArtifacts(ids) {
  const result = [];
  ids.forEach((artifactId) => {
    const recipe = ARTIFACT_RECIPES?.[artifactId];
    const rows = Array.isArray(recipe)
      ? recipe
      : (Array.isArray(recipe?.materials) ? recipe.materials : []);
    rows.forEach((row) => {
      const id = String(row?.id || row?.materialId || '').trim();
      if (id) result.push(id);
    });
  });
  return unique(result);
}

function collectPriorityDefinitions() {
  const data = userData();
  const artifactInventory = data?.artifactSystem?.inventory || {};
  const materialInventory = data?.materialSystem?.inventory || {};
  const equipped = data?.artifactSystem?.equipped || {};

  const ownedArtifactIds = Object.entries(artifactInventory)
    .filter(([, count]) => qty(count) > 0)
    .map(([id]) => id);
  const equippedArtifactIds = Object.values(equipped).map(String).filter(Boolean);
  const ownedMaterialIds = Object.entries(materialInventory)
    .filter(([, count]) => qty(count) > 0)
    .map(([id]) => id);

  const score = Math.max(0, Number(data?.stats?.totalScore) || 0);
  const currentRealmOrder = (() => {
    let order = 0;
    for (const item of ARTIFACT_CATALOG) {
      const candidate = realmOrderByName(item?.realm || '凡人');
      if (candidate <= 10 && Number(item?.craft?.gold || 0) >= 0 && candidate <= 10) {
        if (candidate <= 10) order = Math.max(order, Math.min(candidate, Number(data?.stats?.rankLevel) || candidate));
      }
    }
    return Math.max(0, Number(data?.stats?.rankLevel) || order || (score > 0 ? 1 : 0));
  })();

  const nearbyArtifacts = ARTIFACT_CATALOG
    .filter((item) => realmOrderByName(item?.realm || '凡人') <= currentRealmOrder + 1)
    .map((item) => item.id);
  const nearbyMaterials = MATERIAL_CATALOG
    .filter((item) => materialRealmOrderByName(item?.realm || '凡人') <= currentRealmOrder + 1)
    .map((item) => item.id);

  const recipeMaterialIds = recipeMaterialIdsForArtifacts(unique([
    ...equippedArtifactIds,
    ...ownedArtifactIds,
    ...nearbyArtifacts.slice(0, 12)
  ]));

  const artifactIds = unique([
    ...equippedArtifactIds,
    ...ownedArtifactIds,
    ...nearbyArtifacts
  ]);
  const materialIds = unique([
    ...ownedMaterialIds,
    ...recipeMaterialIds,
    ...nearbyMaterials
  ]);

  return {
    artifactIds,
    materialIds,
    equippedArtifactIds,
    ownedArtifactIds,
    ownedMaterialIds,
    recipeMaterialIds
  };
}

function definitionImageUrls(defs) {
  return unique(defs.map((item) => String(item?.imageUrl || '').trim()));
}

function collectStartupImageUrls() {
  const priority = collectPriorityDefinitions();

  const equippedArtifacts = priority.equippedArtifactIds.map(getArtifactById).filter(Boolean);
  const ownedArtifacts = priority.ownedArtifactIds.map(getArtifactById).filter(Boolean);
  const ownedMaterials = priority.ownedMaterialIds.map(getMaterialById).filter(Boolean);
  const recipeMaterials = priority.recipeMaterialIds.map(getMaterialById).filter(Boolean);
  const nearbyArtifacts = priority.artifactIds.map(getArtifactById).filter(Boolean);
  const nearbyMaterials = priority.materialIds.map(getMaterialById).filter(Boolean);

  const urls = unique([
    ...definitionImageUrls(equippedArtifacts),
    ...definitionImageUrls(ownedArtifacts),
    ...definitionImageUrls(ownedMaterials),
    ...definitionImageUrls(recipeMaterials),
    ...definitionImageUrls(nearbyArtifacts),
    ...definitionImageUrls(nearbyMaterials)
  ]);

  return {
    priority,
    startup: urls.slice(0, STARTUP_IMAGE_LIMIT),
    remaining: unique([
      ...definitionImageUrls(ARTIFACT_CATALOG),
      ...definitionImageUrls(MATERIAL_CATALOG)
    ]).filter((url) => !urls.slice(0, STARTUP_IMAGE_LIMIT).includes(url))
  };
}

function warmImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ src, ok });
    };
    const timer = setTimeout(() => finish(false), 3800);
    image.decoding = 'async';
    image.loading = 'eager';
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
    if (image.complete && image.naturalWidth > 0) finish(true);
  });
}

async function warmQueue(urls, phase = 'images') {
  const queue = urls.slice();
  const total = queue.length;
  let loaded = 0;
  let failed = 0;
  dispatchProgress(phase, loaded, total);

  const workers = Array.from({ length: Math.min(IMAGE_CONCURRENCY, Math.max(1, total)) }, async () => {
    while (queue.length) {
      const src = queue.shift();
      const result = await warmImage(src);
      loaded += 1;
      if (!result.ok) failed += 1;
      dispatchProgress(phase, loaded, total, { failed });
    }
  });

  await Promise.all(workers);
  return { total, loaded, failed };
}

function warmRemainingInBackground(urls) {
  if (!urls.length) return;
  const run = async () => {
    const queue = urls.slice();
    while (queue.length) {
      const batch = queue.splice(0, 3);
      await Promise.all(batch.map(warmImage));
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
    window.__xiuxianCatalogImagesBackgroundReady = true;
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => void run(), { timeout: 2500 });
  } else {
    setTimeout(() => void run(), 900);
  }
}

async function prepareStartupResources() {
  dispatchProgress('catalogs', 0, 1);

  // Catalog sync modules are loaded before this module. At this point their
  // featureReady promises have already resolved, so these arrays are the
  // authoritative startup snapshot (or their safe defaults after timeout).
  const images = collectStartupImageUrls();
  const snapshot = {
    artifactCount: ARTIFACT_CATALOG.length,
    materialCount: MATERIAL_CATALOG.length,
    recipeCount: Object.keys(ARTIFACT_RECIPES || {}).length,
    ownedArtifactCount: images.priority.ownedArtifactIds.length,
    ownedMaterialCount: images.priority.ownedMaterialIds.length,
    equippedArtifactCount: images.priority.equippedArtifactIds.length,
    startupImageCount: images.startup.length,
    backgroundImageCount: images.remaining.length
  };

  window.__xiuxianStartupResourceSnapshot = snapshot;
  dispatchProgress('catalogs', 1, 1, snapshot);

  let result = { total: 0, loaded: 0, failed: 0 };
  if (images.startup.length) {
    result = await Promise.race([
      warmQueue(images.startup, 'images'),
      new Promise((resolve) => setTimeout(() => resolve({
        total: images.startup.length,
        loaded: 0,
        failed: 0,
        timedOut: true
      }), STARTUP_TIMEOUT_MS))
    ]);
  }

  window.__xiuxianStartupResourcesReady = true;
  window.__xiuxianStartupResourceSnapshot = { ...snapshot, imageWarmup: result };
  dispatchProgress('ready', result.loaded || 0, result.total || 0, { ...snapshot, ...result });

  // Non-critical catalog artwork keeps warming after the startup gate closes.
  warmRemainingInBackground(images.remaining);

  return { ok: true, ...snapshot, imageWarmup: result };
}

export const featureReady = prepareStartupResources();

window.getXiuxianStartupResourceSnapshot = () => ({
  ...(window.__xiuxianStartupResourceSnapshot || {})
});
