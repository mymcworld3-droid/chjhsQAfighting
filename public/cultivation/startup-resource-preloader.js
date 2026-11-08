import './training-scene-layer-art.js';
import './training-scene-layouts.js';
import './training-access-rules.js';
import './golden-core-art.js';
import { trainingRenderReady, trainingRenderProfile } from './training-render-guard.js';

// 啟動資源預熱：玩家資料已由 main-legacy 載入，本模組只在 startup gate 期間
// 預熱金丹及修煉場景。
const STARTUP_IMAGE_LIMIT = 48;
const STARTUP_TIMEOUT_MS = 5200;
const IMAGE_CONCURRENCY = 4;
const SCENE_ART = Object.freeze({
  landscape: ['assets/scenes/mountains-landscape-ai.webp', 'assets/scenes/loading-landscape-ai.webp'],
  portrait: ['assets/scenes/mountains-portrait-ai.webp', 'assets/scenes/loading-portrait-ai.webp']
});

function userData() {
  try { return window.getCurrentUserData?.() || {}; } catch (_) { return {}; }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dispatchProgress(phase, loaded = 0, total = 0, extra = {}) {
  window.dispatchEvent(new CustomEvent('xiuxian:startup-resource-progress', {
    detail: { phase, loaded, total, ...extra }
  }));
}

function trainingSceneImages(orientation) {
  const layout = globalThis.QATrainingSceneLayouts[orientation];
  return [layout.image,
    ...(trainingRenderProfile() === 'safe' ? [] : layout.layers.map(layer => layer.image)),
    ...globalThis.QATrainingAccessRules.PLACES.map(place => layout.places[place.id])
      .filter(place => !place.painted).map(place => place.sprite.image)];
}

function collectStartupImageUrls() {
  const sceneOrientation = window.matchMedia?.('(orientation: portrait)')?.matches ? 'portrait' : 'landscape';

  const art = globalThis.QAGoldenCoreArt;
  const training = userData().cultivationTraining || {};
  const coreImages = unique([
    ...[training.equippedCore,training.core].filter(Boolean).map(core=>art.source(core.type,core.grade)),
    ...art.all()
  ]);

  const urls = unique([
    ...coreImages,
    ...SCENE_ART[sceneOrientation],
    ...trainingSceneImages(sceneOrientation),
  ]);

  return {
    coreImageCount: coreImages.length,
    startup: urls.slice(0, STARTUP_IMAGE_LIMIT),
    remaining: unique([
      ...SCENE_ART[sceneOrientation === 'portrait' ? 'landscape' : 'portrait'],
      ...trainingSceneImages(sceneOrientation === 'portrait' ? 'landscape' : 'portrait'),
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
  // A low-profile launch must not decode the unused high-profile scenery,
  // including the opposite orientation's background warmup queue.
  await trainingRenderReady;

  const images = collectStartupImageUrls();
  const snapshot = {
    coreImageCount: images.coreImageCount || 0,
    startupImageCount: images.startup.length,
    backgroundImageCount: images.remaining.length
  };

  window.__xiuxianStartupResourceSnapshot = snapshot;

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
