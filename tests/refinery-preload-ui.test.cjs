const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const refinery = read('public/cultivation/cultivation-refinery-v2.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const foundation = read('public/cultivation/foundation-training-page.js');
const trainingCss = read('public/cultivation-training-v3.css');
const main = read('public/main.js');

test('held refinery materials use adaptive square grids inside independent scroll rolls', () => {
  assert.match(refinery, /grid-template-columns:repeat\(auto-fill,minmax\(96px,1fr\)\)/);
  assert.match(refinery, /\.refinery-material\{[^}]*aspect-ratio:1/);
  assert.match(refinery, /\.refinery-mat-qty\{position:absolute/);
  assert.match(refinery, /\.refinery-material-roll-body\{[^}]*overflow:auto/);
  assert.match(refinery, /@media\(max-width:430px\)\{\.refinery-material-list\{gap:7px\}\.refinery-material-roll\{padding:5px\}\.refinery-material-roll-body\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('training page creates refinery tab and a loading shell up front', () => {
  assert.match(training, /data-training-tab="refinery"/);
  assert.match(training, /training-shared-shells\.js/);
  assert.match(read('public/cultivation/training-shared-shells.js'), /正在載入法器、碎片與升級石/);
  assert.match(training, /xiuxian:refinery-open-request/);
});

test('foundation training also preloads the refinery tab and shell', () => {
  assert.match(foundation, /data-training-tab="refinery"/);
  assert.match(foundation, /training-shared-shells\.js/);
  assert.match(read('public/cultivation/training-shared-shells.js'), /法器煉製/);
  assert.match(foundation, /xiuxian:refinery-open-request/);
});

test('preloaded refinery shell has base styling before refinery hydration', () => {
  assert.match(trainingCss, /\.refinery-shell\{/);
  assert.match(trainingCss, /\.refinery-shell-material-grid\{/);
  assert.match(trainingCss, /\.refinery-shell-array \.refinery-slot/);
  assert.match(trainingCss, /grid-template-columns:repeat\(auto-fill,minmax\(96px,1fr\)\)/);
});

test('refinery hydrates an already-active preloaded tab', () => {
  assert.doesNotMatch(refinery, /refineryOpenBound|refineryExitBound|function bindExit\(/);
  assert.match(refinery, /分頁點擊只由築基／金丹頁管理/);
  assert.match(refinery, /xiuxian:refinery-open-request/);
  assert.match(refinery, /if \(tabActive\(page\)\) \{\s*active = true;\s*render\(\);/);
});

test('simple forge loads after inventory and before layout', () => {
  const trainingPos = main.indexOf("'./cultivation/cultivation-training-v4.js'");
  const bagPos = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  const forgePos = main.indexOf("'./cultivation/simple-forge.js'");
  const layoutPos = main.indexOf("'./cultivation/training-fluid-layout.js'");
  assert.ok(trainingPos >= 0 && bagPos > trainingPos && forgePos > bagPos && layoutPos > forgePos);
});

test('preloaded refinery does not promise obsolete material crafting', () => {
  const shell=read('public/cultivation/training-shared-shells.js');
  assert.match(shell, /法器煉製/);
  assert.match(shell, /升級石/);
  assert.doesNotMatch(shell, /加入材料|配方/);
});


test('Foundation refinery click delegates to a single public opener for ordinary players', () => {
  const foundation = read('public/cultivation/foundation-training-page.js');
  assert.match(foundation, /typeof window\.openCultivationRefinery === 'function'/);
  assert.match(foundation, /window\.openCultivationRefinery\(\)/);
  assert.match(refinery, /window\.openCultivationRefinery = \(\) => activate\(\)/);
  assert.doesNotMatch(refinery, /page\.dataset\.foundationTraining !== '1'/);
  assert.match(refinery, /function activate\(page = document\.getElementById\('page-training'\)\)/);
  assert.match(refinery, /八方煉器陣/);
  assert.doesNotMatch(refinery, /<h3>煉器介面載入失敗<\/h3>/);
  assert.match(refinery, /data-refinery-retry/);
  assert.doesNotMatch(refinery, /function activate\(page[^)]*\) \{\s*if \(userData\(\)\?\.isAdmin/);
});
