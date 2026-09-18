const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const bag = read('public/cultivation/unified-inventory-grid.js');
const bridge = read('public/cultivation/inventory-legacy-bridge.js');
const adminSort = read('public/cultivation/admin-realm-sorting.js');
const main = read('public/main.js');

test('unified backpack combines artifacts materials and cultivation items', () => {
  assert.match(bag, /artifactSystem\?\.inventory/);
  assert.match(bag, /materialSystem\?\.inventory/);
  assert.match(bag, /getCultivationInventoryItems/);
  assert.match(bag, /readTrainingLocalItems/);
});

test('every backpack item uses a square slot and opens details on click', () => {
  assert.match(bag, /\.uib-item\{[\s\S]*aspect-ratio:1\/1/);
  assert.match(bag, /data-uib-item/);
  assert.match(bag, /openDetails\(/);
  assert.match(bag, /uib-modal-backdrop/);
});

test('backpack supports type filtering and quality realm sorting', () => {
  assert.match(bag, /id="uib-filter-type"/);
  assert.match(bag, /id="uib-sort-mode"/);
  assert.match(bag, /quality-desc/);
  assert.match(bag, /quality-asc/);
  assert.match(bag, /type-quality/);
  assert.match(bag, /realmOrderByName/);
  assert.match(bag, /materialRealmOrderByName/);
});

test('material and artifact realm colors are visible in the backpack', () => {
  assert.match(bag, /materialRealmColor/);
  assert.match(bag, /--uib-quality/);
  assert.match(bag, /item\.realm/);
});

test('legacy long backpack item is hidden when unified backpack is present', () => {
  assert.match(bridge, /:has\(#unified-cultivation-bag\)/);
  assert.match(bridge, /cultivation-inventory-grid/);
  assert.match(bridge, /display:none!important/);
});

test('admin artifact and material lists are ordered by realm', () => {
  assert.match(adminSort, /admin-artifact-list/);
  assert.match(adminSort, /admin-material-list/);
  assert.doesNotMatch(adminSort, /admin-recipe-list/);
  assert.match(adminSort, /realmOrderByName/);
  assert.match(adminSort, /materialRealmOrderByName/);
});

test('new backpack modules load after material and artifact systems and admin sorting loads last', () => {
  const artifact = main.indexOf("'./cultivation/artifact-system.js'");
  const material = main.indexOf("'./cultivation/material-system.js'");
  const bagIndex = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  const bridgeIndex = main.indexOf("'./cultivation/inventory-legacy-bridge.js'");
  const adminManager = main.indexOf("'./cultivation/admin-material-manager.js'");
  const adminSortIndex = main.indexOf("'./cultivation/admin-realm-sorting.js'");
  assert.ok(artifact >= 0 && material > artifact && bagIndex > material && bridgeIndex > bagIndex);
  assert.ok(adminManager >= 0 && adminSortIndex > adminManager);
});
