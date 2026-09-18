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

test('training page creates refinery tab and a complete stable shell up front', () => {
  assert.match(training, /data-training-tab="refinery"/);
  assert.match(training, /function refineryShellMarkup\(\)/);
  assert.match(training, /refinery-shell-material-grid/);
  assert.match(training, /refinery-slots refinery-shell-array/);
  assert.match(training, /refinery-array-center/);
  assert.match(training, /refinery-shell-summary/);
  assert.match(training, /refinery-shell-match/);
  assert.match(training, /refinery-shell-actions/);
  assert.match(training, /xiuxian:refinery-open-request/);
});

test('foundation training also preloads the refinery tab and shell', () => {
  assert.match(foundation, /data-training-tab="refinery"/);
  assert.match(foundation, /function refineryShellMarkup\(\)/);
  assert.match(foundation, /refinery-shell-material-grid/);
  assert.match(foundation, /xiuxian:refinery-open-request/);
});

test('preloaded refinery shell has base styling before refinery hydration', () => {
  assert.match(trainingCss, /\.refinery-shell\{/);
  assert.match(trainingCss, /\.refinery-shell-material-grid\{/);
  assert.match(trainingCss, /\.refinery-shell-array \.refinery-slot/);
  assert.match(trainingCss, /grid-template-columns:repeat\(auto-fill,minmax\(96px,1fr\)\)/);
});

test('refinery hydrates an already-active preloaded tab', () => {
  assert.match(refinery, /refineryOpenBound/);
  assert.match(refinery, /xiuxian:refinery-open-request/);
  assert.match(refinery, /if \(tabActive\(page\)\) \{\s*active = true;\s*render\(\);/);
});

test('stable shell is created early while hydrated modules keep safe dependency order', () => {
  const trainingPos = main.indexOf("'./cultivation/cultivation-training-v4.js'");
  const materialPos = main.indexOf("'./cultivation/material-system.js'");
  const bagPos = main.indexOf("'./cultivation/unified-inventory-grid.js'");
  const refineryPos = main.indexOf("'./cultivation/cultivation-refinery-v2.js'");
  const layoutPos = main.indexOf("'./cultivation/training-fluid-layout.js'");
  const battlePos = main.indexOf("'./cultivation/battle-v3-stability-ui.js'");
  assert.ok(trainingPos >= 0 && materialPos > trainingPos);
  assert.ok(bagPos > materialPos && refineryPos > bagPos);
  assert.ok(layoutPos > refineryPos && battlePos > layoutPos);
});

test('preloaded refinery shell uses the same whole-card 50/50 split', () => {
  for (const source of [training, foundation]) {
    assert.match(source, /refinery-panel refinery-material-panel/);
    assert.match(source, /持有煉器素材 · 一般素材/);
    assert.match(source, /二次煉製/);
  }
  assert.match(trainingCss, /refinery-panel\.refinery-material-panel\{[^}]*padding:0/);
  assert.match(trainingCss, /refinery-material-list\{[^}]*grid-template-rows:repeat\(2,minmax\(0,1fr\)\)[^}]*gap:0/);
});
