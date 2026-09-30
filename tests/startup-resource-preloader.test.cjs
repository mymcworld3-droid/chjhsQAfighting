const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
