'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicFile = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const css = publicFile('styles/xianxia-quiet.css');
const html = publicFile('index.html');

test('portrait-only CSS hides exactly the top brand on market, ranking, and alliance', () => {
  const match = css.match(/@media\s*\(orientation:\s*portrait\)\s*\{([\s\S]*?)\n\}/g) || [];
  const rule = match.find(block => block.includes('> header > h1.xianxia-brand'));
  assert.ok(rule, 'portrait media query for the global brand must exist');
  for (const page of ['#page-store', '#page-rank', '#page-social']) {
    assert.ok(rule.includes(page), page + ' should hide the brand only when active');
  }
  assert.match(rule, /:has\(:is\([^)]*\)\.active-page\)/);
  assert.match(rule, /> header > h1\.xianxia-brand\s*\{\s*display:\s*none\s*!important/);
  assert.match(rule, /> header\s*\{\s*justify-content:\s*flex-end\s*!important/);
  for (const excluded of ['#page-home', '#page-training', '#page-quiz', '#page-settings', '#page-history']) {
    assert.ok(!rule.includes(excluded), excluded + ' must retain its branding');
  }
  assert.ok(!/display:\s*none\s*!important[\s\S]{0,80}> header > div/.test(rule));
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
