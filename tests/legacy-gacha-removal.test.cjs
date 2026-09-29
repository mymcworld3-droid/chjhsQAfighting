const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const index = readFileSync(join(root, 'public/index.html'), 'utf8');
const boot = readFileSync(join(root, 'public/main.js'), 'utf8');
const audit = readFileSync(join(root, 'scripts/capture-layout.cjs'), 'utf8');

test('retired card drawing is absent from markup, boot logic, and visual audit', () => {
  for (const source of [index, boot, audit]) {
    assert.doesNotMatch(source, /page-cards|drawSingleCard|draw11Cards|gacha-overlay/);
  }
  assert.doesNotMatch(boot, /removeLegacyGachaUI|LEGACY_SELECTORS/);
  const nav = index.slice(index.indexOf('<nav id="bottom-nav"'), index.indexOf('<div id="toast-container"'));
  assert.equal((nav.match(/data-target="page-/g) || []).length, 4);
});
