const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pool = require('../public/cultivation/soulbound-pool.js');
const Access = require('../public/cultivation/training-access-rules.js');
const Layouts = require('../public/cultivation/training-scene-layouts.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const main = read('public/main.js');
const legacy = read('public/main-legacy.js');
const artifactSync = read('public/cultivation/artifact-catalog-sync.js');
const materialSync = read('public/cultivation/material-catalog-sync.js');
const preload = read('public/cultivation/startup-resource-preloader.js');

test('startup waits for authoritative artifacts and local fixed materials', () => {
  assert.match(artifactSync, /export const featureReady = new Promise/);
  assert.match(artifactSync, /xiuxian:artifact-catalog-startup-ready/);
  assert.match(materialSync, /export const featureReady = new Promise/);
  assert.match(materialSync, /xiuxian:material-catalog-startup-ready/);
  assert.match(artifactSync, /startup-timeout/);
  assert.match(materialSync, /local-fixed-catalog/);
  assert.doesNotMatch(materialSync, /getFirestore|onSnapshot|setDoc/);
});

test('inventory and refinery resource preloader runs before unified inventory UI', () => {
  const materialSystemPos = main.indexOf("'./cultivation/material-system.js'");
  const preloadPos = main.indexOf("'./cultivation/startup-resource-preloader.js'");
  const inventoryPos = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  assert.ok(materialSystemPos >= 0);
  assert.ok(preloadPos > materialSystemPos);
  assert.ok(inventoryPos > preloadPos);
  assert.match(preload, /export const featureReady = prepareStartupResources\(\)/);
});

test('startup preloader prioritizes owned equipped and recipe resources', () => {
  assert.match(preload, /artifactSystem\?\.inventory/);
  assert.match(preload, /artifactSystem\?\.equipped/);
  assert.match(preload, /materialSystem\?\.inventory/);
  assert.match(preload, /ARTIFACT_RECIPES/);
  assert.match(preload, /recipeMaterialIdsForArtifacts/);
  assert.match(preload, /STARTUP_IMAGE_LIMIT = 28/);
  assert.match(preload, /IMAGE_CONCURRENCY = 4/);
  assert.match(preload, /warmRemainingInBackground/);
});

test('startup gate reports catalog and image warmup progress', () => {
  assert.match(preload, /xiuxian:startup-resource-progress/);
  assert.match(legacy, /xiuxian:startup-resource-progress/);
  assert.match(legacy, /正在整理法寶、材料與煉器配方/);
  assert.match(legacy, /正在預載背包與裝備圖片/);
  assert.match(legacy, /法寶、材料、裝備與煉器資源已就緒/);
});

function imagePlan(player, profile = 'balanced') {
  const materials = Array.from({ length: 40 }, (_, i) => ({
    id: `material-${i}`, realm: '築基', imageUrl: `/material-${i}.webp`
  }));
  const context = {
    ARTIFACT_CATALOG: Pool.ITEMS, MATERIAL_CATALOG: materials, ARTIFACT_RECIPES: {},
    getArtifactById: Pool.get, getMaterialById: id => materials.find(item => item.id === id),
    realmOrderByName: name => ['凡人', '練氣', '築基', '金丹', '元嬰', '化神', '煉虛', '合體', '渡劫', '半仙', '真仙'].indexOf(name),
    materialRealmOrderByName: () => 2,
    trainingRenderProfile: () => profile,
    QATrainingAccessRules: Access, QASoulboundPool: Pool, QATrainingSceneLayouts: Layouts,
    window: { getCurrentUserData: () => player, matchMedia: () => ({ matches: false }) }
  };
  const source = preload.slice(0, preload.indexOf('function warmImage(')).replace(/^import[\s\S]*?;\s*/gm, '');
  return vm.runInNewContext(source + '\ncollectStartupImageUrls();', context);
}

test('low rendering preloads only composite scenery for both orientations, including background queues', () => {
  const plan = imagePlan({ stats: { totalScore: 28 } }, 'safe');
  const urls = [...plan.startup, ...plan.remaining];
  assert.ok(plan.startup.includes('assets/training/cultivation-landscape-clean.webp'));
  assert.ok(plan.remaining.includes('assets/training/cultivation-portrait-clean.webp'));
  assert.equal(urls.some(url => url.startsWith('assets/training/layers/')), false);
  for (const id of ['meditation', 'vault', 'forge', 'secret', 'status']) {
    assert.ok(plan.startup.includes(`assets/training/cutouts/${id}-ai.webp`));
  }
  const high = imagePlan({ stats: { totalScore: 28 } }, 'balanced');
  assert.ok(high.startup.includes(Layouts.landscape.layers[0].image));
  assert.ok(high.remaining.includes(Layouts.portrait.layers[0].image));
});

test('startup image collection waits for the rendering decision before any images are warmed', async () => {
  let resolve, collected = 0;
  const context = {
    trainingRenderReady: new Promise(done => { resolve = done; }),
    dispatchProgress() {}, ARTIFACT_CATALOG: [], MATERIAL_CATALOG: [], ARTIFACT_RECIPES: {}, window: {},
    collectStartupImageUrls() {
      collected++;
      return { startup: [], remaining: [], priority: { ownedArtifactIds: [], ownedMaterialIds: [], equippedArtifactIds: [] } };
    },
    warmRemainingInBackground() {}
  };
  const start = preload.indexOf('async function prepareStartupResources()');
  const end = preload.indexOf('\nexport const featureReady', start);
  vm.runInNewContext(preload.slice(start, end) + '\nthis.ready=prepareStartupResources();', context);
  assert.equal(collected, 0);
  resolve('safe');
  assert.equal((await context.ready).ok, true);
  assert.equal(collected, 1);
});

test('all eight permanent artworks warm before the gate even with many owned material images', () => {
  const player = { stats: { totalScore: 28, rankLevel: 3 }, materialSystem: {
    inventory: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`material-${i}`, 1]))
  } };
  const plan = imagePlan(player);
  for (const item of Pool.candidates(0)) {
    assert.equal(plan.startup.filter(url => url === item.imageUrl).length, 1, item.name);
    assert.equal(plan.remaining.includes(item.imageUrl), false);
  }
  assert.ok(plan.startup.length <= 28);
});

test('permanent unlocks reserve pool artwork after deductions while locked accounts prioritize owned materials', () => {
  const restored = imagePlan({ stats: { totalScore: 0 }, trainingAccess: { version: 1, highestRealmScore: 68 } });
  const locked = imagePlan({ stats: { totalScore: 10, rankLevel: 2 }, materialSystem: {
    inventory: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`material-${i}`, 1]))
  } });
  for (const item of Pool.candidates(0)) {
    assert.ok(restored.startup.includes(item.imageUrl), item.name);
    assert.equal(locked.startup.includes(item.imageUrl), false);
    assert.ok(locked.remaining.includes(item.imageUrl));
  }
});
