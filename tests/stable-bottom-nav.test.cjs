const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const index = read('public/index.html');
const trainingCss = read('public/cultivation-training-v3.css');
const legacy = read('public/main-legacy.js');

test('bottom navigation has one stable outer width regardless of button count', () => {
  assert.match(index, /id="stable-bottom-nav-style"/);
  assert.match(index, /#bottom-nav \.glass-capsule\{[\s\S]*width:min\(560px,calc\(100vw - 32px\)\)!important/);
  assert.match(index, /max-width:560px!important/);
  assert.match(index, /#bottom-nav #nav-grid\{[\s\S]*grid-auto-flow:column!important/);
  assert.match(index, /grid-auto-columns:minmax\(0,1fr\)!important/);
});

test('bottom navigation markup does not carry old fixed Tailwind column or width classes', () => {
  const navStart = index.indexOf('<nav id="bottom-nav"');
  const navEnd = index.indexOf('<div id="toast-container"', navStart);
  const nav = index.slice(navStart, navEnd);
  assert.doesNotMatch(nav, /max-w-md/);
  assert.doesNotMatch(nav, /grid-cols-5/);
  assert.doesNotMatch(nav, /grid-cols-6/);
});

test('training unlock no longer changes bottom navigation width', () => {
  assert.doesNotMatch(trainingCss, /cultivation-training-unlocked #bottom-nav \.glass-capsule\s*\{[^}]*max-width/);
});

test('admin role no longer changes nav grid column classes', () => {
  const start = legacy.indexOf('function checkAdminRole');
  const block = legacy.slice(start, start + 1800);
  assert.doesNotMatch(block, /grid-cols-5/);
  assert.doesNotMatch(block, /grid-cols-6/);
  assert.match(block, /btn-admin-nav/);
});
