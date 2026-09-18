const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/training-fluid-layout.js');
const main = read('public/main.js');

test('training page uses the full available width instead of the old fixed cap', () => {
  assert.match(layout, /#page-training\.training-page-v3[\s\S]*width:100%!important/);
  assert.match(layout, /#page-training\.training-page-v3[\s\S]*max-width:none!important/);
  assert.match(layout, /main:has\(#page-training\.active-page\)[\s\S]*max-width:none!important/);
  assert.match(layout, /training-subtabs-v3[\s\S]*grid-template-columns:repeat\(auto-fit,minmax\(92px,1fr\)\)/);
});

test('inventory and refinery adapt across desktop tablet and mobile widths', () => {
  assert.match(layout, /training-v3-bag-grid[\s\S]*repeat\(auto-fit,minmax\(250px,1fr\)\)/);
  assert.match(layout, /cultivation-refinery[\s\S]*grid-template-columns:minmax\(280px,\.9fr\) minmax\(390px,1\.1fr\)/);
  assert.match(layout, /@media \(max-width:900px\)[\s\S]*cultivation-refinery[\s\S]*grid-template-columns:1fr!important/);
  assert.match(layout, /@media \(max-width:640px\)[\s\S]*training-v3-bag-grid[\s\S]*grid-template-columns:1fr!important/);
  assert.match(layout, /refinery-material-list[\s\S]*grid-template-rows:minmax\(0,calc\(50% \+ 64px\)\) minmax\(0,calc\(50% - 64px\)\)!important/);
  assert.match(layout, /refinery-material-list[\s\S]*overflow:hidden!important/);
  assert.match(layout, /refinery-material-roll-body[\s\S]*overflow:auto!important/);
});

test('fluid training layout loads after refinery so it can control final geometry', () => {
  const refinery = main.indexOf("'./cultivation/cultivation-refinery-v2.js'");
  const fluid = main.indexOf("'./cultivation/training-fluid-layout.js'");
  assert.ok(refinery >= 0);
  assert.ok(fluid > refinery);
});
