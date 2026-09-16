const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('training navigation resets the actual main scroll container before locking the page', () => {
  const main = read('public/main.js');
  const guard = read('public/cultivation/training-scroll-fix.js');

  assert.match(main, /\.\/cultivation\/training-scroll-fix\.js/);
  assert.match(guard, /document\.querySelector\('body > main'\)/);
  assert.match(guard, /main\.scrollTop = 0/);
  assert.match(guard, /main\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.match(guard, /pageId === PAGE_ID/);
  assert.match(guard, /#nav-training, \[data-target="page-training"\]/);
});

test('training page is one non-scrollable viewport without clipping its core controls', () => {
  const css = read('public/styles/cultivation-training-compact.css');

  assert.match(css, /main:has\(#page-training\.active-page\)[\s\S]*overflow-y: hidden !important/);
  assert.match(css, /--training-viewport-height: calc\(100dvh - 11rem/);
  assert.match(css, /\.training-page-v3 \{[\s\S]*height: var\(--training-viewport-height\);[\s\S]*overflow: hidden;/);
  assert.match(css, /\.training-page-v3\.active-page \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /#training-tab-content \{[\s\S]*height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.core-minimal-center \{[\s\S]*grid-template-rows: minmax\(0, 1fr\) auto auto auto auto/);
  assert.match(css, /\.golden-core-stage-v3 \{[\s\S]*height: min\(100%, 220px\)/);
  assert.match(css, /@media \(max-height: 590px\)/);
  assert.match(css, /\.core-wash-btn,[\s\S]*\.core-equip-btn,[\s\S]*\.core-info-btn[\s\S]*height: 30px/);
});
