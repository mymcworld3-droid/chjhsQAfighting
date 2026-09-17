const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const del = read('public/cultivation/admin-artifact-delete.js');
const main = read('public/main.js');

test('artifact delete is admin-only, confirmed, persisted, and refreshes the runtime catalog', () => {
  assert.match(del, /isAdmin\(\)/);
  assert.match(del, /window\.confirm/);
  assert.match(del, /ARTIFACT_CATALOG\s*\.filter\(\(item\) => item\.id !== itemId\)/);
  assert.match(del, /validateArtifactCatalog\(next\)/);
  assert.match(del, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(del, /tx\.set\(configRef/);
  assert.match(del, /replaceArtifactCatalog\(normalized, 'admin-delete'\)/);
});

test('artifact delete protects the final catalog item and keeps legacy inventory dormant', () => {
  assert.match(del, /至少需要保留 1 件法寶/);
  assert.match(del, /休眠資料/);
  assert.doesNotMatch(del, /delete next\.inventory/);
});

test('artifact delete button appears only for existing editor records', () => {
  assert.match(del, /idInput\.readOnly/);
  assert.match(del, /className = 'aam-delete'/);
  assert.match(del, /刪除法寶/);
  assert.match(del, /ARTIFACT_CATALOG\.some\(\(item\) => item\.id === itemId\)/);
});

test('delete enhancer loads after artifact manager and before admin collapsible wrapper', () => {
  const managerIndex = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const deleteIndex = main.indexOf("'./cultivation/admin-artifact-delete.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(managerIndex >= 0 && deleteIndex > managerIndex);
  assert.ok(collapseIndex > deleteIndex);
});
