const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('training navigation resets the actual main scroll container', () => {
  const main = read('public/main.js');
  const guard = read('public/cultivation/training-scroll-fix.js');

  assert.match(main, /\.\/cultivation\/training-scroll-fix\.js/);
  assert.match(guard, /document\.querySelector\('body > main'\)/);
  assert.match(guard, /main\.scrollTop = 0/);
  assert.match(guard, /main\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.match(guard, /pageId === PAGE_ID/);
  assert.match(guard, /#nav-training, \[data-target="page-training"\]/);
});

test('compact training layout never traps or clips overflow', () => {
  const css = read('public/styles/cultivation-training-compact.css');

  assert.match(css, /main:has\(#page-training\.active-page\)[\s\S]*overflow-y: auto !important/);
  assert.doesNotMatch(css, /main:has\(#page-training\.active-page\)[\s\S]{0,180}overflow-y: hidden !important/);
  assert.match(css, /\.training-page-v3 \{[\s\S]*height: auto;[\s\S]*overflow: visible;/);
  assert.match(css, /#training-tab-content \{[\s\S]*height: auto;[\s\S]*overflow: visible;/);
  assert.match(css, /\.core-minimal-card \{[\s\S]*height: auto;[\s\S]*overflow: visible;/);
});
