import { ARTIFACT_CATALOG, realmOrderByName } from './artifact-catalog.js';
import {
  MATERIAL_CATALOG,
  ARTIFACT_RECIPES,
  getMaterialById,
  materialRealmOrderByName
} from './material-catalog.js';
import './training-scene-layer-art.js';
import './training-scene-layouts.js';
import './training-access-rules.js';
import './golden-core-art.js';
import { trainingRenderReady, trainingRenderProfile } from './training-render-guard.js';

// Startup prepares authoritative catalog METADATA, not every catalog image.
// Only the visible orientation's entry art and the player's current cores
// deserve a warm request. All other images are fetched by their owning page.
const STARTUP_IMAGE_LIMIT = 6;
const STARTUP_TIMEOUT_MS = 5200;
const IMAGE_CONCURRENCY = 2;
const SCENE_ART = Object.freeze({
  landscape: ['assets/scenes/mountains-landscape-ai.webp', 'assets/scenes/loading-landscape-ai.webp'],
  portrait: ['assets/scenes/mountains-portrait-ai.webp', 'assets/scenes/loading-portrait-ai.webp']
});

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

  const currentRealmOrder = Math.max(
    0,
    Math.min(10, Math.floor(Number(data?.stats?.rankLevel) || 0))
  );

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

function trainingSceneImages(orientation) {
  if (trainingRenderProfile() === 'safe') return [`assets/training/cultivation-${orientation}-clean.webp`];
  const layout = globalThis.QATrainingSceneLayouts[orientation];
  return [layout.image, ...layout.layers.map(layer => layer.image)];
}

function collectStartupImageUrls() {
  const priority = collectPriorityDefinitions();
  const sceneOrientation = window.matchMedia?.('(orientation: portrait)')?.matches ? 'portrait' : 'landscape';

  const art = globalThis.QAGoldenCoreArt;
  const training = userData().cultivationTraining || {};
  const coreImages = unique(
    [training.equippedCore,training.core].filter(Boolean)
      .map(core=>art?.source?.(core.type,core.grade))
  );
  const urls = unique([...coreImages,...SCENE_ART[sceneOrientation]]);

  return {
    priority,
    coreImageCount:coreImages.length,
    startup:urls.slice(0,STARTUP_IMAGE_LIMIT),
    // Do not warm the opposite orientation, dormant tab art, all golden
    // cores, material catalog, or unavailable weapon HD files in background.
    remaining:[]
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


async function prepareStartupResources() {
  // A low-profile launch must not decode the unused high-profile scenery,
  // including the opposite orientation's background warmup queue.
  await trainingRenderReady;
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
    coreImageCount: images.coreImageCount || 0,
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

  return { ok: true, ...snapshot, imageWarmup: result };
}

export const featureReady = prepareStartupResources();

window.getXiuxianStartupResourceSnapshot = () => ({
  ...(window.__xiuxianStartupResourceSnapshot || {})
});
