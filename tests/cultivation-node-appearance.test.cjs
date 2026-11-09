'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const page = readFileSync(join(__dirname, '../public/cultivation/cultivation-path-page.js'), 'utf8');
const css = readFileSync(join(__dirname, '../public/styles/cultivation-reboot.css'), 'utf8');

test('cultivation paths always have circular node outlines with icons only inside', () => {
  assert.match(page, /<circle class="ns-orb-track" cx="50" cy="50" r="45"\/>/);
  assert.match(page, /<circle class="ns-orb-progress" cx="50" cy="50" r="45"\/>/);
  assert.match(page, /<span class="ns-orb-surface">\$\{attributeIcons\(node\.bonuses\)\}<\/span>/);
  assert.doesNotMatch(page, /ORB_SHAPES|SHAPES_BY_ICON|data-node-shape/);
  assert.match(css, /\.path-tree-orb \.ns-orb-surface\s*\{[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.path-tree-node\[data-slot="seal"\] \.ns-orb-surface\s*\{[^}]*border-radius:\s*50%/s);
  assert.doesNotMatch(css, /data-node-shape|clip-path:\s*polygon/);
});
