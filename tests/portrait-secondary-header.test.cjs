'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicFile = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const css = publicFile('styles/xianxia-quiet.css');
const html = publicFile('index.html');

test('portrait-only rules hide the entire global header on store, ranking, and alliance', () => {
  const blocks = css.match(/@media\\s*\\(orientation:\\s*portrait\\)\\s*\\{([\\s\\S]*?)\\n\\}/g) || [];
  const block = blocks.find(item => item.includes('> header {') && item.includes('> main {'));
  assert.ok(block, 'portrait-only rule must target both header and main');
  const activeScope = 'body.xianxia-theme:has(:is(#page-store, #page-rank, #page-social).active-page)';
  assert.equal(block.split(activeScope).length - 1, 2, 'same scoped selector must hide header and recover vertical space');
  assert.match(block, /> header\\s*\\{\\s*display:\\s*none\\s*!important/);
  assert.match(block, /> main\\s*\\{\\s*padding-top:\\s*max\\(8px, env\\(safe-area-inset-top, 0px\\)\\)\\s*!important/);
  assert.doesNotMatch(block, /> header > h1\\.xianxia-brand\\s*\\{/);
  for (const excluded of ['#page-home', '#page-training', '#page-quiz', '#page-settings', '#page-history']) {
    assert.ok(!block.includes(excluded), excluded + ' retains the original full header');
  }
});


test('brand remains intact as a return-home button; user controls remain in top header', () => {
  const header = html.match(/<header class="fixed top-0[^]*?<\/header>/);
  assert.ok(header);
  assert.match(header[0], /<h1 class="xianxia-brand">/);
  assert.match(header[0], /id="brand-home"/);
  assert.match(header[0], /青雲問道/);
  assert.match(header[0], /以學入道 · 積微成仙/);
  assert.match(header[0], /id="user-info"/);
  assert.match(header[0], /id="lang-display"/);
  assert.match(html, /styles\/xianxia-quiet\.css\?v=20261016-portrait-secondary-brand1/);
});
