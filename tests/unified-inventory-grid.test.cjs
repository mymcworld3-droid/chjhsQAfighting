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

test('new backpack modules load after material and artifact systems and admin sorting loads last', () => {
  const artifact = main.indexOf("'./cultivation/artifact-system.js'");
  const material = main.indexOf("'./cultivation/material-system.js'");
  const bagIndex = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  const adminManager = main.indexOf("'./cultivation/admin-material-manager.js'");
  const adminSortIndex = main.indexOf("'./cultivation/admin-realm-sorting.js'");
  assert.ok(artifact >= 0 && material > artifact && bagIndex > material);
  assert.ok(adminManager >= 0 && adminSortIndex > adminManager);
});


test('backpack renders four real equipment cards with inspect, equip and unequip actions', () => {
  assert.match(bag, /ARTIFACT_EQUIP_SLOTS/);
  assert.match(bag, /function equipmentMarkup\(\)/);
  assert.match(bag, /function equipmentSlotMarkup\(slot\)/);
  assert.match(bag, /class="uib-equipment-grid"/);
  assert.match(bag, /data-uib-equipped-item/);
  assert.match(bag, /data-uib-empty-slot/);
  assert.match(bag, /data-uib-equip=/);
  assert.match(bag, /window\.toggleEquipArtifact/);
  for (const slot of ['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶']) {
    assert.match(bag, new RegExp(slot));
  }
  assert.match(bag, /裝備後會替換/);
});

test('equipment cards are responsive and show artifact icons instead of effect text', () => {
  assert.match(bag, /\.uib-equipment-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(bag, /@media\(max-width:700px\)\{\.uib-equipment-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(bag, /uib-equip-slot-frame is-artifact/);
  assert.match(bag, /uib-equip-slot-name/);
  assert.doesNotMatch(bag.slice(bag.indexOf('function equipmentSlotMarkup'),bag.indexOf('function readTrainingLocalItems')), /effects\.map\(effectLabel\)/);
  assert.match(bag, /目前已裝備，效果正在生效/);
});

test('only selected backpack tab renders; empty slots choose compatible artifacts', () => {
  const active = bag.slice(bag.indexOf('  function inventoryView()'),bag.indexOf('  function itemMarkup('));
  assert.doesNotMatch(active, /dataset\.foundationTraining === '1'\) return true/);
  assert.match(active, /querySelector\('\[data-training-tab\]\.active'\)/);
  assert.match(active, /tab === 'equipment' \|\| tab === 'bag'/);
  assert.match(bag, /equipmentPickSlot = button\.dataset\.uibEmptySlot/);
  assert.match(bag, /artifactSlot\(item\.raw\) === equipmentPickSlot/);
  assert.match(bag, /data-uib-cancel-equip/);
  assert.match(bag, /equipmentPickSlot = '';/);
});


test('real equipment tab is present in the static and both stage-specific layouts', () => {
  const index = read('public/index.html');
  const foundation = read('public/cultivation/foundation-training-page.js');
  const golden = read('public/cultivation/cultivation-training-v4.js');
  for (const [name, source] of Object.entries({index, foundation, golden})) {
    assert.match(source, /data-training-tab="equipment"/,name);
    assert.match(source, /fa-shield-halved/,name);
  }
  assert.match(foundation, /xiuxian:equipment-open-request/);
  assert.match(golden, /activeTab === 'equipment'/);
  assert.match(golden, /xiuxian:equipment-open-request/);
  assert.match(bag, /'xiuxian:equipment-open-request'/);
  assert.match(bag, /unified-inventory-grid-runtime-style/);
  assert.match(index, /id="unified-inventory-grid-style"/);
  assert.doesNotMatch(index, /id="unified-inventory-grid-runtime-style"/);
});

test('real markup puts exactly four equipment slots on Equipment tab, none in Backpack', () => {
  const vm = require('node:vm');
  const rootSource = bag.slice(bag.indexOf('  function rootMarkup('),bag.indexOf('  function effectLabel('));
  const slots = ['本命法寶','護身法寶','佩飾法寶','輔助法寶'];
  const ctx = vm.createContext({
    ROOT_ID: 'unified-cultivation-bag', equipmentPickSlot:'', filterType:'all',sortMode:'type-quality',
    escapeHtml:String, equipmentMarkup:() => '<section class="uib-equipment-panel"><div class="uib-equipment-grid">'+slots.map(name=>'<button class="uib-equip-slot">'+name+'</button>').join('')+'</div></section>',
    sortedVisibleItems:()=>[], itemMarkup:()=>'', artifactSlot:()=>'', String
  });
  vm.runInContext(rootSource,ctx);
  const equipment = vm.runInContext("rootMarkup([], 'equipment')",ctx);
  assert.match(equipment,/uib-equipment-panel/);
  assert.equal((equipment.match(/class="uib-equip-slot"/g)||[]).length,4);
  assert.match(equipment,/尚無可裝配的法寶/);
  const backpack = vm.runInContext("rootMarkup([], 'bag')",ctx);
  assert.doesNotMatch(backpack,/uib-equipment-panel|uib-equip-slot/);
  assert.match(backpack,/uib-toolbar/);
});


test('both stages import exactly one shared four-slot preload shell', () => {
  const foundation = read('public/cultivation/foundation-training-page.js');
  const golden = read('public/cultivation/cultivation-training-v4.js');
  const shared = read('public/cultivation/training-shared-shells.js');
  for (const [name, source] of Object.entries({foundation, golden})) {
    assert.match(source,/import \{ equipmentShellMarkup, refineryShellMarkup \} from '\.\/training-shared-shells\.js'/,name);
    assert.match(source,/content\.innerHTML = equipmentShellMarkup\(\)/,name);
    assert.doesNotMatch(source,/function equipmentShellMarkup\(\)/,name);
  }
  assert.match(shared,/export function equipmentShellMarkup\(\)/);
  const block = shared.slice(shared.indexOf('function equipmentShellMarkup()'),shared.indexOf('function refineryShellMarkup()'));
  for (const slot of ['本命法寶','護身法寶','佩飾法寶','輔助法寶']) assert.match(block,new RegExp(slot));
  assert.match(block,/uib-equipment-grid/);
  assert.match(block,/uib-equip-slot is-empty/);
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
  assert.match(main,/const XIUXIAN_FEATURE_BUILD = '20260921-ascendant-realm6'/);
  assert.match(main,/await import\(\`\$\{modulePath\}\?v=\$\{XIUXIAN_FEATURE_BUILD\}\`\)/);
  assert.match(main,/'\.\/cultivation\/foundation-training-page\.js'/);
  assert.match(main,/'\.\/cultivation\/cultivation-training-v4\.js'/);
  assert.match(main,/'\.\/cultivation\/unified-inventory-grid\.js'/);
});

test('selected equipment slot equips compatible owned artifacts directly and explains unsupported items', () => {
  assert.match(bag, /const equippedCandidates = ownedArtifacts\.filter/);
  assert.match(bag, /目前持有的法寶都是消耗型或答題型/);
  assert.match(bag, /目前持有的裝備型法寶屬於其他欄位/);
  assert.match(bag, /點選下方法寶，即可裝配到/);
  assert.match(bag, /if \(!equipmentPickSlot \|\| !item/);
  assert.match(bag, /artifactSlot\(item\.raw\) !== equipmentPickSlot/);
  assert.match(bag, /await window\.toggleEquipArtifact\(item\.id\)/);
  assert.match(bag, /if \(!artifactCanEquip\(item\.raw\)\) \{/);
  assert.match(bag, /openDetails\(key\); \/\/ 其他原因/);
  assert.match(bag, /console\.error\('\[Equipment slot\] equip failed:'/);
});
