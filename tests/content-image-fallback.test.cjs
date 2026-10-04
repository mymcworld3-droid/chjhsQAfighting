const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', 'cultivation', name), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
}[c]));

test('bag item images recover to escaped text when their source fails', () => {
  const source = read('unified-inventory-grid.js');
  const helper = source.slice(source.indexOf('  function imageMarkup('), source.indexOf('  function typeLabel('));
  const context = vm.createContext({ escapeHtml: esc });
  vm.runInContext(helper, context);
  const html = context.imageMarkup('assets/missing.png', '<unsafe>', '物品');
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(!html.includes('<unsafe>'));
  const image = { hidden: false, nextElementSibling: { hidden: true } };
  new Function(html.match(/onerror="([^"]+)"/)[1]).call(image);
  assert.equal(image.hidden, true);
  assert.equal(image.nextElementSibling.hidden, false);
  assert.equal(context.imageMarkup('', '◆'), '◆');
});

test('five-immortal avatars retain a fallback and escape image attributes', () => {
  const source = read('five-immortals.js');
  const helper = source.slice(source.indexOf('  function avatarHtml('), source.indexOf('  async function connect()'));
  const context = vm.createContext({ escapeHtml: esc });
  vm.runInContext(helper, context);
  const html = context.avatarHtml({ avatar: 'assets/missing.png" onload="bad', frame: 'assets/frame.png" onload="bad' });
  assert.ok(!html.includes(' onload="bad'));
  assert.ok(html.includes('&quot;'));
  const image = { hidden: false, nextElementSibling: { hidden: true } };
  new Function(html.match(/onerror="([^"]+)"/)[1]).call(image);
  assert.equal(image.hidden, true);
  assert.equal(image.nextElementSibling.hidden, false);
  assert.ok(context.avatarHtml({}).includes('fa-user'));
});
