const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/content-capacity-layout.js');
const main = read('public/main.js');

test('training content measures the real space above bottom navigation', () => {
  assert.match(layout, /NAV_ID = 'bottom-nav'/);
  assert.match(layout, /function updateTrainingFillHeight\(\)/);
  assert.match(layout, /nav\.getBoundingClientRect\(\)/);
  assert.match(layout, /page\.getBoundingClientRect\(\)/);
  assert.match(layout, /--training-fill-height/);
  assert.match(layout, /--training-content-height/);
  assert.match(layout, /navTop - pageRect\.top - safeGap/);
  assert.match(layout, /navTop - contentTop - safeGap/);
  assert.match(layout, /visualViewport\?\.height/);
});

test('training content is not clipped and golden core can use the available height', () => {
  assert.match(layout, /#page-training #training-tab-content/);
  assert.match(layout, /overflow:visible!important/);
  assert.match(layout, /min-height:var\(--training-content-height/);
  assert.match(layout, /golden-core-stage-v3/);
  assert.match(layout, /height:clamp\(240px,44dvh,430px\)!important/);
});

test('refinery fills available content height and shifts the material divider down 96px', () => {
  assert.match(layout, /#page-training \.cultivation-refinery/);
  assert.match(layout, /min-height:var\(--training-content-height/);
  assert.match(layout, /#page-training \.refinery-material-list/);
  assert.match(layout, /grid-template-rows:minmax\(0,calc\(50% \+ 64px\)\) minmax\(0,calc\(50% - 96px\)\)!important/);
  assert.match(layout, /overflow:hidden!important/);
  assert.match(layout, /refinery-material-roll-body/);
  assert.match(layout, /overflow:auto!important/);
  assert.match(layout, /overscroll-behavior:contain!important/);
});

test('bag and inventory can contain many items safely', () => {
  assert.match(layout, /training-v3-bag-grid/);
  assert.match(layout, /cultivation-inventory-grid/);
  assert.match(layout, /max-height:var\(--training-content-height/);
  assert.match(layout, /scrollbar-gutter:stable/);
});

test('admin long sections are full width, scrollable and responsive', () => {
  assert.match(layout, /#page-admin/);
  assert.match(layout, /admin-collapse-body/);
  assert.match(layout, /max-height:min\(72dvh,760px\)/);
  assert.match(layout, /\.amm-list,\.aam-list/);
  assert.match(layout, /repeat\(auto-fit,minmax\(320px,1fr\)\)/);
  assert.match(layout, /@media\(max-width:640px\)/);
});

test('capacity layout loads after the existing training and market layout layers', () => {
  const training = main.indexOf("'./cultivation/training-fluid-layout.js'");
  const market = main.indexOf("'./cultivation/market-fluid-layout.js'");
  const capacity = main.indexOf("'./cultivation/content-capacity-layout.js'");
  assert.ok(training >= 0 && capacity > training);
  assert.ok(market >= 0 && capacity > market);
});
