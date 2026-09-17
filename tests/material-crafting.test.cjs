const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const catalog = read('public/cultivation/material-catalog.js');
const sync = read('public/cultivation/material-catalog-sync.js');
const system = read('public/cultivation/material-system.js');
const admin = read('public/cultivation/admin-material-manager.js');
const main = read('public/main.js');

test('material catalog provides editable materials and default recipes for every built-in artifact', () => {
  assert.match(catalog, /export const MATERIAL_CATEGORIES/);
  assert.match(catalog, /export const MATERIAL_CATALOG/);
  assert.match(catalog, /validateMaterialCatalog/);
  assert.match(catalog, /replaceMaterialCatalog/);
  assert.match(catalog, /export const ARTIFACT_RECIPES/);
  assert.match(catalog, /validateArtifactRecipes/);
  for (const id of ['seven-treasure-ruler', 'war-drum', 'enlightenment-lamp', 'mountain-armor', 'void-sword', 'longevity-jade']) {
    assert.match(catalog, new RegExp(`'${id}'\\s*:`));
  }
});

test('material catalog and recipes sync from one global Firestore config document', () => {
  assert.match(sync, /CONFIG_DOC = 'materialCatalogV1'/);
  assert.match(sync, /onSnapshot\(ref/);
  assert.match(sync, /replaceMaterialCatalog\(data\.items, 'firestore'\)/);
  assert.match(sync, /replaceArtifactRecipes\(data\.recipes, 'firestore'\)/);
});

test('artifact crafting is intercepted and atomically consumes gold plus every recipe material', () => {
  assert.match(system, /const FIELD = 'materialSystem'/);
  assert.match(system, /getArtifactRecipe\(artifactId\)/);
  assert.match(system, /have < need/);
  assert.match(system, /delete materials\.inventory\[row\.materialId\]/);
  assert.match(system, /artifactSystem\.inventory\[artifactId\]/);
  assert.match(system, /tx\.update\(ref, \{ \[FIELD\]: materials, artifactSystem, 'stats\.gold': newGold \}\)/);
  assert.match(system, /document\.addEventListener\('click', interceptArtifactCraft, true\)/);
  assert.match(system, /event\.stopImmediatePropagation\(\)/);
});

test('players have a material store and observer-safe idempotent rendering', () => {
  assert.match(system, /煉器材料庫/);
  assert.match(system, /data-material-buy/);
  assert.match(system, /採購價為 0/);
  assert.match(system, /list\.dataset\.renderKey === renderKey/);
  assert.match(system, /note\.dataset\.renderKey !== renderKey/);
  assert.match(system, /MutationObserver/);
});

test('admin can add edit delete materials and configure artifact recipes', () => {
  assert.match(admin, /新增材料/);
  assert.match(admin, /編輯材料/);
  assert.match(admin, /刪除材料/);
  assert.match(admin, /既有材料 ID 不可修改/);
  assert.match(admin, /window\.confirm/);
  assert.match(admin, /仍被 .*配方使用/);
  assert.match(admin, /設定配方/);
  assert.match(admin, /至少需要 1 種材料才能合成法寶/);
  assert.match(admin, /persistMaterials/);
  assert.match(admin, /persistRecipes/);
  assert.match(admin, /userSnap\.data\(\)\?\.isAdmin !== true/);
});

test('material modules load in dependency order and admin panel loads before collapsible wrapper', () => {
  const artifactSync = main.indexOf("'./cultivation/artifact-catalog-sync.js'");
  const materialSync = main.indexOf("'./cultivation/material-catalog-sync.js'");
  const artifactSystem = main.indexOf("'./cultivation/artifact-system.js'");
  const materialSystem = main.indexOf("'./cultivation/material-system.js'");
  const artifactAdmin = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const materialAdmin = main.indexOf("'./cultivation/admin-material-manager.js'");
  const collapse = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(artifactSync >= 0 && materialSync > artifactSync);
  assert.ok(artifactSystem > materialSync && materialSystem > artifactSystem);
  assert.ok(artifactAdmin >= 0 && materialAdmin > artifactAdmin && collapse > materialAdmin);
});
