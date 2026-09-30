const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const catalog = read('public/cultivation/material-catalog.js');
const sync = read('public/cultivation/material-catalog-sync.js');
const system = read('public/cultivation/material-system.js');
const admin = read('public/cultivation/admin-material-manager.js');
const artifactAdmin = read('public/cultivation/admin-artifact-manager.js');
const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const main = read('public/main.js');

test('fixed material catalog contains two forge materials and two refinement seals', () => {
  assert.match(catalog,/RAID_CRAFT_MATERIAL_IDS/);
  assert.match(catalog,/raid-secret-realm-essence/);
  assert.match(catalog,/raid-shen-sword-soul/);
  assert.match(catalog,/2: 'raid-refine-key-ii'/);
  assert.match(catalog,/3: 'raid-refine-key-iii'/);
  assert.match(catalog,/items\.length !== allowed\.size/);
});

test('material catalog startup is local-only and does not connect to Firebase', () => {
  assert.match(sync,/local-fixed-catalog/);
  assert.match(sync,/xiuxian:material-catalog-startup-ready/);
  assert.doesNotMatch(sync,/firebase|Firestore|getFirestore|onSnapshot|setDoc|materialCatalogV1/i);
});

test('material system is read-only on the client and has no purchase or Firebase path', () => {
  assert.match(system,/getXiuxianMaterialInventory/);
  assert.match(system,/getXiuxianMaterialQuantity/);
  assert.match(system,/source:'local-readonly'/);
  assert.doesNotMatch(system,/getFirestore|runTransaction|data-material-buy|buyMaterial|material-store/);
});

test('only essence and sword soul enter the eight-slot forge; refinement seals are reserved', () => {
  assert.match(refinery,/new Set\(Object\.values\(RAID_REFINEMENT_KEYS\)\)/);
  assert.match(refinery,/filter\(\(m\) => !raidKeyIds\.has\(m\.id\)/);
  assert.match(refinery,/第二煉印記/);
  assert.match(refinery,/第三煉印記/);
});

test('admin material catalog is fixed while artifact recipe editor remains available', () => {
  assert.match(admin,/固定四項/);
  assert.match(admin,/固定規則/);
  assert.doesNotMatch(main,/admin-material-realm-editor\.js/);
  assert.match(artifactAdmin,/煉器配方/);
  assert.match(artifactAdmin,/data-recipe-material/);
  assert.match(artifactAdmin,/MIN_ARTIFACT_RECIPE_MATERIALS/);
});

test('material modules load before inventory and refinery', () => {
  const materialSync = main.indexOf("'./cultivation/material-catalog-sync.js'");
  const materialSystem = main.indexOf("'./cultivation/material-system.js'");
  const inventory = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  const refineryPos = main.indexOf("'./cultivation/cultivation-refinery-v2.js'");
  assert.ok(materialSync >= 0 && materialSystem > materialSync && inventory > materialSystem && refineryPos > inventory);
});
