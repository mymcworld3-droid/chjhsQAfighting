const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('main startup preserves the stylesheet font before and after DOM readiness', () => {
  const source = readFileSync(join(__dirname, '../public/main.js'), 'utf8')
    .replace(/^import\s+['"][^'"]+['"];$/gm, '')
    .replace(/\bimport\(/g, 'mockImport(');
  const properties = new Map();
  const links = [];
  const listeners = new Map();
  const document = {
    readyState: 'loading',
    documentElement: { style: {
      setProperty: (key, value) => properties.set(key, value),
      getPropertyValue: (key) => properties.get(key) || '',
      removeProperty: (key) => properties.delete(key)
    } },
    head: { appendChild: (link) => links.push(link) },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({}),
    addEventListener: (type, handler) => listeners.set(type, handler)
  };
  const window = {
    addEventListener: (type, handler) => listeners.set(type, handler)
  };
  vm.runInNewContext(source, {
    window, document, console,
    mockImport: () => Promise.resolve({}),
    setTimeout: () => 1,
    clearTimeout: () => {}
  });

  listeners.get('DOMContentLoaded')();
  listeners.get('xiuxian:user-data-ready')();
  assert.equal(properties.get('--xq-serif'), undefined,
    'startup must leave the shared serif font under stylesheet control');
  assert.equal(links.some((link) => /Orbitron/.test(link.href)), false,
    'startup must not load the removed technology font');
  assert.ok(links.some((link) => link.href === 'xianxia-gold.css'),
    'the real theme bootstrap ran');
});
