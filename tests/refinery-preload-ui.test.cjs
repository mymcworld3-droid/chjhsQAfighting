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

test('the Golden Core page exposes no refinery tab or open request', () => {
  assert.doesNotMatch(training, /data-training-tab="refinery"|refinery-open-request/);
});

test('Foundation training opens the satchel without a refinery tab', () => {
  assert.match(foundation, /data-training-tab="bag"/);
  assert.doesNotMatch(foundation, /data-training-tab="refinery"|refineryShellMarkup/);
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

test('startup loads the original training layout without mounting simple forge', () => {
  assert.match(main, /training-fluid-layout\.js/);
  assert.doesNotMatch(main, /simple-forge\.js/);
});

test('preloaded refinery does not promise obsolete material crafting', () => {
  const shell=read('public/cultivation/training-shared-shells.js');
  assert.match(shell, /法器煉製/);
  assert.match(shell, /升級石/);
  assert.doesNotMatch(shell, /加入材料|配方/);
});


test('Foundation satchel delegates to the single inventory renderer', () => {
  assert.match(foundation, /window\.openCultivationEquipment\?\.\(\)/);
  assert.doesNotMatch(foundation, /openCultivationRefinery/);
});
