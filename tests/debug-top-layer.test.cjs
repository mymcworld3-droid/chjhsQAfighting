const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const index = read('public/index.html');
const legacy = read('public/main-legacy.js');
const battle = read('public/cultivation/battle-v3-stability-ui.js');
const inventory = read('public/cultivation/unified-inventory-grid.js');

test('debug button is permanently reserved as the top-most app layer', () => {
  assert.match(index, /id="debug-top-layer-style"/);
  assert.match(index, /#btn-show-debug\{[\s\S]*position:fixed!important;[\s\S]*z-index:2147483647!important;[\s\S]*pointer-events:auto!important/);
  assert.match(index, /#admin-debug-console\{[\s\S]*z-index:2147483646!important/);
});

test('runtime debug initialization reasserts the top layer with important priority', () => {
  const start = legacy.indexOf('window.setupAdminDebug');
  const block = legacy.slice(start, start + 2500);
  assert.ok(start >= 0);
  assert.match(block, /showBtn\.style\.setProperty\('z-index', '2147483647', 'important'\)/);
  assert.match(block, /consoleDiv\.style\.setProperty\('z-index', '2147483646', 'important'\)/);
  assert.match(block, /showBtn\.style\.setProperty\('pointer-events', 'auto', 'important'\)/);
});

test('debug layer remains above known fullscreen and modal layers', () => {
  const battleZ = Number((battle.match(/z-index:(\d+)!important/) || [])[1] || 0);
  const inventoryZ = Number((inventory.match(/\.uib-modal-backdrop\{[^}]*z-index:(\d+)/) || [])[1] || 0);
  assert.ok(battleZ > 0);
  assert.ok(inventoryZ > 0);
  assert.ok(2147483647 > battleZ);
  assert.ok(2147483647 > inventoryZ);
  assert.ok(2147483646 > battleZ);
  assert.ok(2147483646 > inventoryZ);
});

test('old low debug z-index utility classes are removed from static markup', () => {
  const buttonStart = index.indexOf('<button id="btn-show-debug"');
  const buttonEnd = index.indexOf('</button>', buttonStart);
  const consoleStart = index.indexOf('<div id="admin-debug-console"');
  const consoleEnd = index.indexOf('>', consoleStart);
  assert.doesNotMatch(index.slice(buttonStart, buttonEnd), /z-\[9998\]/);
  assert.doesNotMatch(index.slice(consoleStart, consoleEnd), /z-\[9999\]/);
});
