const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const css = read('public/styles/interface-cleanup-pages.css');

test('Alliance shell is frameless without removing individual friend card styling', () => {
  assert.match(css, /#page-social > :is\(\.ui-social-heading,\[role="tabpanel"\]\)\s*\{[^}]*background:transparent!important;[^}]*border:0!important;[^}]*border-radius:0!important/);
  assert.match(css, /#page-social #friend-list-container>\*\s*\{[^}]*border:1px solid/);
});

test('Alliance fills the available main area and reserves space for navigation', () => {
  assert.match(css, /#page-social\.active-page:not\(\.hidden\)\s*\{[^}]*height:100%;min-height:0/);
  assert.match(css, /#page-social\.active-page:not\(\.hidden\)\)>main\s*\{[^}]*padding-bottom:calc\(72px \+ env/);
  assert.doesNotMatch(css, /#page-social\s*\{height:calc\(100dvh/);
  assert.match(read('public/index.html'), /interface-cleanup-pages\.css\?v=20261126-alliance-open-v1/);
});
