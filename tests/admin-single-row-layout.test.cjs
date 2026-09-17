const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/admin-single-row-layout.js');
const main = read('public/main.js');

test('artifact and material admin lists render one item per row', () => {
  assert.match(layout, /#admin-artifact-list\.aam-list/);
  assert.match(layout, /#admin-material-list\.amm-list/);
  assert.match(layout, /grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(layout, /#admin-artifact-list > \.aam-item/);
  assert.match(layout, /#admin-material-list > \.amm-item/);
  assert.match(layout, /width:100%!important/);
});

test('single-row override loads after realm sorting and admin managers', () => {
  const artifact = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const material = main.indexOf("'./cultivation/admin-material-manager.js'");
  const sorting = main.indexOf("'./cultivation/admin-realm-sorting.js'");
  const single = main.indexOf("'./cultivation/admin-single-row-layout.js'");
  assert.ok(artifact >= 0 && single > artifact);
  assert.ok(material >= 0 && single > material);
  assert.ok(sorting >= 0 && single > sorting);
});
