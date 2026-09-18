const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const css = read('public/xianxia-bright-accents.css');
const index = read('public/index.html');

test('bright accent layer is loaded statically after dark theme/preload styles', () => {
  const dark = index.indexOf('xianxia-blackgold-harmony.css');
  const inlineLayout = index.indexOf('id="content-capacity-layout-style"');
  const bright = index.indexOf('xianxia-bright-accents.css?v=20260918-bright1');
  const debug = index.indexOf('id="debug-top-layer-style"');
  assert.ok(dark >= 0);
  assert.ok(inlineLayout > dark);
  assert.ok(bright > inlineLayout);
  assert.ok(debug > bright);
});

test('global theme is brighter without becoming a light theme', () => {
  assert.match(css, /--xq-paper:#fff5df/);
  assert.match(css, /--xq-muted:#c4b79e/);
  assert.match(css, /body\.xianxia-theme\{[\s\S]*background:#12100c!important/);
  assert.match(css, /\.glass-panel\{[\s\S]*rgba\(48,41,29,.95\)/);
  assert.match(css, /body\.xianxia-theme main\{/);
});

test('major pages receive distinct accent colors and brighter navigation', () => {
  for (const page of ['page-home','page-training','page-store','page-rank','page-settings','page-history','page-social','page-admin','page-quiz','page-battle']) {
    assert.match(css, new RegExp('#' + page + '\\{--page-accent:'));
  }
  assert.match(css, /#bottom-nav>\.glass-capsule/);
  assert.match(css, /#nav-grid button\.active-nav-btn/);
  assert.match(css, /\.xianxia-page-heading/);
});

test('training, store and admin dense areas receive brighter surfaces', () => {
  assert.match(css, /#page-training \.training-subtabs-v3/);
  assert.match(css, /#page-training \.core-minimal-card/);
  assert.match(css, /#page-training \.uib-item/);
  assert.match(css, /#page-training \.refinery-panel/);
  assert.match(css, /#page-store \.store-tab\.active/);
  assert.match(css, /#store-grid>\*/);
  assert.match(css, /#page-admin \.admin-collapse-card/);
  assert.match(css, /#page-admin :is\(\.aam-item,\.amm-item,\.admin-stat-card\)/);
});

test('quiz paper and green/red answer feedback remain visibly distinct', () => {
  assert.match(css, /#quiz-container>\.glass-panel:first-child/);
  assert.match(css, /#options-container>button:not\(\.bg-green-600\):not\(\.bg-red-600\)/);
  assert.match(css, /#options-container>\.bg-green-600/);
  assert.match(css, /#options-container>\.bg-red-600/);
});
