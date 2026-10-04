const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const layout = read('public/cultivation/market-fluid-layout.js');
const main = read('public/main.js');
const formats = read('public/styles/content-format.css');

test('market fluid layout is loaded and removes the global page width cap', () => {
  assert.match(main, /\.\/cultivation\/market-fluid-layout\.js/);
  assert.match(layout, /#page-store\{[\s\S]*width:100%!important;[\s\S]*max-width:none!important;/);
  assert.match(layout, /padding-left:clamp\(10px,2vw,30px\)!important/);
});

test('market product grid adapts to desktop tablet and phone widths', () => {
  assert.match(layout, /#store-grid\{[\s\S]*repeat\(auto-fit,minmax\(170px,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:760px\)[\s\S]*repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:520px\)[\s\S]*repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(layout, /@media \(max-width:330px\)[\s\S]*grid-template-columns:1fr!important/);
});

test('market category tabs span the available width', () => {
  assert.match(layout, /#page-store > div:has\(> \.store-tab\)[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(layout, /#page-store \.store-tab\{[\s\S]*width:100%/);
});

test('market avatar frame previews stay compact without changing equipped frames elsewhere', () => {
  assert.match(formats, /\.ui-avatar-frame,\.ui-product-frame/);
  assert.match(formats, /height: 118% !important/);
  assert.match(formats, /\.avatar-preview \.avatar-img[\s\S]*object-fit: contain/);
  assert.doesNotMatch(layout, /object-fit:/);
});

test('failed avatar previews show their fallback without an inline JavaScript error', () => {
  const source = read('public/main-legacy.js');
  const helper = source.slice(source.indexOf('function renderVisual('), source.indexOf('function getAvatarHtml('));
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  const html = context.renderVisual('avatar', 'assets/missing-avatar.png');
  const handler = html.match(/onerror="([^"]+)"/)[1];
  const image = { style: {}, nextElementSibling: { style: { display: 'none' } } };
  new Function(handler).call(image);
  assert.equal(image.style.display, 'none');
  assert.equal(image.nextElementSibling.style.display, 'block');
});
