const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'public');
const guard = fs.readFileSync(path.join(root, 'visual-viewport-guard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles', 'visual-viewport-guard.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('global visual viewport guard loads before the main app', () => {
  assert.match(index, /styles\/visual-viewport-guard\.css\?v=20260927-vv2/);
  assert.match(index, /visual-viewport-guard\.js\?v=20260927-vv2/);
  assert.ok(index.indexOf('visual-viewport-guard.js?v=20260927-vv2') <
    index.indexOf('main.js?v=20260927-vv-raid9'));
});

test('guard tracks Safari visual viewport geometry and browser chrome', () => {
  assert.match(guard, /window\.visualViewport/);
  assert.match(guard, /vv\?\.height/);
  assert.match(guard, /vv\?\.offsetTop/);
  assert.match(guard, /layoutHeight - \(top \+ height\)/);
  assert.match(guard, /--app-vv-height/);
  assert.match(guard, /--app-vv-bottom/);
  assert.match(guard, /visualViewport\?\.addEventListener\?\.\('resize'/);
  assert.match(guard, /visualViewport\?\.addEventListener\?\.\('scroll'/);
});

test('fullscreen gameplay roots use the actual visible viewport', () => {
  for (const selector of [
    '#dongtian-overlay.dt-overlay',
    '#page-battle.battle-v2-page',
    '#scope-studio',
    '.dm-overlay',
    '#admin-product-editor.admin-product-editor-fullscreen',
    '#xiuxian-story-layer',
    '#newbie-tutorial-layer',
    '#golden-core-tutorial-layer',
    '#battle-tutorial-layer.bt-final-mode'
  ]) assert.ok(css.includes(selector), selector);
  assert.match(css, /height:var\(--app-vv-height\)!important/);
  assert.match(css, /top:var\(--app-vv-top\)!important/);
});

test('bottom navigation, tutorial cards and modals clear browser chrome', () => {
  assert.match(css, /body\.xianxia-theme #bottom-nav/);
  assert.match(css, /var\(--app-vv-bottom\)/);
  assert.match(css, /\.newbie-tutorial-card/);
  assert.match(css, /\.golden-core-tutorial-card/);
  assert.match(css, /#qi-five-dongtian-tutorial-layer \.qfd-card/);
  assert.match(css, /#custom-confirm-modal:not\(\.hidden\)/);
  assert.match(css, /\.training-v3-modal-backdrop/);
  assert.match(css, /#five-immortal-challenge\.fi-backdrop/);
});


test('raid question delegates sizing to the corrected raid parent', () => {
  assert.doesNotMatch(css, /#raid-question\.raid-question-view/);
});
