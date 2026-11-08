const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const bag = read('public/cultivation/unified-inventory-grid.js');
const adminSort = read('public/cultivation/admin-realm-sorting.js');
const main = read('public/main.js');



test('every backpack item uses a square slot and opens details on click', () => {
  assert.match(bag, /\.uib-item\{[\s\S]*aspect-ratio:1\/1/);
  assert.match(bag, /data-uib-item/);
  assert.match(bag, /openDetails\(/);
  assert.match(bag, /uib-modal-backdrop/);
});

test('obsolete renderer and CSS bridge are removed', () => {
  const inventory = read('public/cultivation/cultivation-inventory.js');
  const index = read('public/index.html');
  assert.doesNotMatch(inventory,/function ensureBagGrid|function itemMarkup|new MutationObserver|setInterval/);
  assert.doesNotMatch(main,/inventory-legacy-bridge\\.js/);
  assert.doesNotMatch(index,/id="inventory-legacy-bridge-style"/);
});

test('admin artifact and material lists are ordered by realm', () => {
  assert.match(adminSort, /admin-artifact-list/);
  assert.match(adminSort, /admin-material-list/);
  assert.doesNotMatch(adminSort, /admin-recipe-list/);
  assert.match(adminSort, /realmOrderByName/);
  assert.match(adminSort, /materialRealmOrderByName/);
});

test('old plain-text training backpack cards are removed from both stage shells', () => {
  const foundation = read('public/cultivation/foundation-training-page.js');
  const golden = read('public/cultivation/cultivation-training-v4.js');
  const foundationBag = foundation.slice(foundation.indexOf('function bagMarkup()'),foundation.indexOf('function equipmentShellMarkup()'));
  const goldenBag = golden.slice(golden.indexOf('function bagTabMarkup()'),golden.indexOf('function renderTrainingPage()'));
  assert.doesNotMatch(foundationBag,/修煉背包|修煉途中取得的特殊物品/);
  assert.doesNotMatch(goldenBag,/training-v3-bag-item|items\.map/);
  assert.match(foundationBag,/uib-bag-loading/);
  assert.match(goldenBag,/uib-bag-loading/);
});

test('all runtime feature modules share one build query without changing dependency-list paths', () => {
  assert.match(main,/const XIUXIAN_FEATURE_BUILD = '20261108-cultivation-reboot1'/);
  assert.match(main,/await import\(\`\$\{modulePath\}\?v=\$\{XIUXIAN_FEATURE_BUILD\}\`\)/);
  assert.match(main,/'\.\/cultivation\/foundation-training-page\.js'/);
  assert.match(main,/'\.\/cultivation\/cultivation-training-v4\.js'/);
  assert.match(main,/'\.\/cultivation\/unified-inventory-grid\.js'/);
});

test('the active satchel offers resource and consumable filters, sorting and pill use', () => {
  assert.match(bag, /value="material"/);
  assert.match(bag, /value="consumable"/);
  assert.match(bag, /value="quality-desc"/);
  assert.match(bag, /data-uib-use="revival-pill"/);
  assert.match(bag, /window.useRevivalPillItem/);
  assert.doesNotMatch(bag, /value="artifact"|raid-refine-key|forgeFragments|toggleEquipArtifact/);
});

test('only the existing satchel tab renders this inventory', () => {
  const active = bag.slice(bag.indexOf('  function inventoryView()'),bag.indexOf('  function itemMarkup('));
  assert.ok(active.includes("querySelector('[data-training-tab].active')"));
  assert.match(active, /tab === 'bag'/);
  for (const file of ['public/index.html', 'public/cultivation/foundation-training-page.js',
    'public/cultivation/cultivation-training-v4.js']) {
    assert.match(read(file), /data-training-tab="bag"/);
    assert.doesNotMatch(read(file), /data-training-tab="refinery"/);
  }
});
