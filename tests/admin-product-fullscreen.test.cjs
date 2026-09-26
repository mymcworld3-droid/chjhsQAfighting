'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const index = read('index.html');
const legacy = read('main-legacy.js');
const main = read('main.js');
const css = read('styles/admin-product-editor.css');

test('admin shop editor has fullscreen form, labels, preview, and existing action hooks', () => {
  const start = index.indexOf('id="admin-product-editor"');
  const end = index.indexOf('id="admin-product-list"', start);
  assert.ok(start > 0 && end > start);
  const editor = index.slice(start, end);
  for (const fragment of [
    'id="admin-form-body"', 'admin-product-editor-body hidden', 'id="admin-edit-id"',
    'id="admin-p-name"', 'id="admin-p-price"', 'id="admin-p-type"', 'id="admin-p-value"',
    'id="admin-asset-selector"', 'id="admin-hint"', 'id="admin-asset-select"',
    'id="admin-asset-preview"', 'id="admin-product-preview-empty"',
    'onclick="resetAdminForm(); openAdminForm()"', 'onclick="closeAdminForm()"',
    'onclick="saveProduct()"', 'onclick="deleteProduct()"'
  ]) assert.ok(editor.includes(fragment), fragment);
  assert.doesNotMatch(editor, /onclick="toggleAdminForm\(\)"/);
  assert.match(index, /styles\/admin-product-editor\.css\?v=20260922-fullscreen1/);
});

test('editor moves outside collapsed admin card and restores on close', () => {
  const source = legacy.slice(legacy.indexOf('let adminProductEditorOrigin = null;'), legacy.indexOf('window.saveProduct = async'));
  assert.ok(source.length > 1500);
  assert.match(source, /adminProductEditorOrigin = \{ parent:editor\.parentNode, next:editor\.nextSibling \}/);
  assert.match(source, /document\.body\.appendChild\(editor\)/);
  assert.match(source, /origin\.parent\.insertBefore\(editor/);
  assert.match(source, /document\.body\.classList\.add\('admin-product-editing'\)/);
  assert.match(source, /document\.body\.classList\.remove\('admin-product-editing'\)/);
  assert.match(source, /document\.getElementById\('admin-product-close'\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /currentUserData\?\.isAdmin/);
  assert.match(source, /updateAdminProductPreview\(\)/);
  assert.doesNotMatch(source, /scrollIntoView\(/);
});

test('shop product edits retain Firestore save and delete behavior', () => {
  const save = legacy.slice(legacy.indexOf('window.saveProduct = async'), legacy.indexOf('window.toggleAdminInputPlaceholder'));
  assert.match(save, /updateDoc\(doc\(db, "products", docId\), productData\)/);
  assert.match(save, /addDoc\(collection\(db, "products"\), productData\)/);
  assert.match(save, /deleteDoc\(doc\(db, "products", docId\)\)/);
  assert.match(save, /Number\.isSafeInteger\(price\)/);
  assert.match(save, /price < 0/);
  assert.match(save, /resetAdminForm\(\)/);
  assert.match(css, /position:fixed!important;inset:0!important;z-index:17000!important/);
  assert.match(css, /height:100dvh!important/);
  assert.match(css, /@media\(max-width:660px\)/);
  assert.match(css, /\.admin-product-editor-actions/);
  assert.equal(css.split('{').length, css.split('}').length);
});

test('browser loads the latest fullscreen editor core after index update', () => {
  assert.match(main, /main-legacy\.js\?v=20260925-helper-thinking1/);
  assert.match(index, /main\.js\?v=20260926-item-images1/);
});
