const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const index = read('public/index.html');
const theme = read('public/cultivation/cultivation-theme.js');
const training = read('public/cultivation/cultivation-training-v4.js');
const foundation = read('public/cultivation/foundation-training-page.js');
const guard = read('public/cultivation/golden-core-access-guard.js');
const artifactAdmin = read('public/cultivation/admin-artifact-manager.js');
const materialAdmin = read('public/cultivation/admin-material-manager.js');

test('index contains all visual-critical theme and training styles up front', () => {
  assert.match(index, /href="xianxia-gold\.css"/);
  assert.match(index, /href="xianxia-blackgold-harmony\.css"/);
  assert.match(index, /href="styles\/cultivation-training-compact\.css\?v=20260917-fit1"/);
  assert.match(index, /href="cultivation-training-v3\.css(?:\?v=[^"]+)?"/);
  assert.match(index, /Orbitron:wght@400;500;600;700;800;900/);
  for (const id of [
    'training-fluid-layout-style',
    'content-capacity-layout-style',
    'cultivation-refinery-v2-preload-style',
    'market-fluid-layout-style',
    'golden-core-access-guard-style'
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
});

test('home cultivation panel is present in index before JS hydration', () => {
  assert.match(index, /id="xiuxian-panel"/);
  assert.match(index, /id="xiuxian-avatar-slot"/);
  assert.match(index, /id="home-avatar-container"/);
  assert.match(index, /id="xiuxian-score"/);
  assert.match(theme, /panel\.dataset\.xiuxianBound/);
});

test('training page and all primary tabs are static in index', () => {
  assert.match(index, /id="page-training"[^>]*data-static-layout="1"/);
  assert.match(index, /data-training-tab="core"/);
  assert.match(index, /data-training-tab="refinery"/);
  assert.match(index, /data-training-tab="bag"/);
  assert.match(index, /id="training-tab-content"/);
  assert.match(index, /training-static-core-shell/);
});

test('training modules hydrate and preserve the static page instead of requiring reinsertion', () => {
  assert.match(training, /let page = document\.getElementById\('page-training'\)/);
  assert.match(training, /page\.dataset\.trainingV4Bound/);
  assert.match(foundation, /let page = document\.getElementById\('page-training'\)/);
  assert.match(foundation, /page\.dataset\.foundationTrainingBound/);
  assert.match(guard, /page\?\.dataset\.staticLayout === '1'/);
  assert.match(guard, /page\.classList\.add\('hidden'\)/);
});

test('admin artifact and material containers are static and hydrated in place', () => {
  assert.match(index, /id="admin-artifact-manager"[^>]*data-static-layout="1"/);
  assert.match(index, /id="admin-material-manager"[^>]*data-static-layout="1"/);
  assert.match(artifactAdmin, /let panel = document\.getElementById\(PANEL_ID\)/);
  assert.match(artifactAdmin, /artifactManagerHydrated/);
  assert.match(materialAdmin, /let panel = document\.getElementById\(PANEL_ID\)/);
  assert.match(materialAdmin, /materialManagerHydrated/);
});

test('index cache-busts main after the static-layout migration', () => {
  assert.match(index, /main\.js\?v=20260921-material-realm-price5/);
});
