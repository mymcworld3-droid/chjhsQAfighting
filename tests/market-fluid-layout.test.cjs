const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/market-fluid-layout.js');
const main = read('public/main.js');

test('market fluid layout is loaded and removes the global page width cap', () => {
  assert.match(main, /\.\/cultivation\/market-fluid-layout\.js/);
  assert.match(layout, /#page-store\{[\s\S]*width:100%!important;[\s\S]*max-width:none!important;/);
  assert.match(layout, /padding-left:clamp\(10px,2vw,30px\)!important/);
});

test('market product grid adapts to desktop tablet and phone widths', () => {
  assert.match(layout, /#store-grid\{[\s\S]*repeat\(auto-fit,minmax\(170px,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:760px\)[\s\S]*repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:520px\)[\s\S]*repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:330px\)[\s\S]*grid-template-columns:1fr!important/);
});

test('market category tabs span the available width', () => {
  assert.match(layout, /#page-store > div:has\(> \.store-tab\)[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(layout, /#page-store \.store-tab\{[\s\S]*width:100%/);
});
