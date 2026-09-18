const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const del = read('public/cultivation/admin-artifact-delete.js');
const main = read('public/main.js');

test('artifact delete is admin-only, confirmed, persisted, and refreshes catalog plus recipes', () => {
  assert.match(del, /isAdmin\(\)/);
  assert.match(del, /window\.confirm/);
  assert.match(del, /ARTIFACT_CATALOG\s*\.filter\(\(item\) => item\.id !== itemId\)/);
  assert.match(del, /validateArtifactCatalog\(next\)/);
  assert.match(del, /validateArtifactRecipes\(raw\)/);
  assert.match(del, /adminSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(del, /batch\.set\(doc\(db, CONFIG_COLLECTION, CONFIG_DOC\)/);
  assert.match(del, /batch\.set\(doc\(db, CONFIG_COLLECTION, MATERIAL_CONFIG_DOC\)/);
  assert.match(del, /replaceArtifactCatalog\(normalized, 'admin-delete'\)/);
  assert.match(del, /replaceArtifactRecipes\(normalizedRecipes, 'admin-delete'\)/);
});

test('artifact delete is destructive: inventory equipment buffs and dependent recipes are removed', () => {
  assert.match(del, /delete artifactSystem\.inventory\[itemId\]/);
  assert.match(del, /delete artifactSystem\.equipped\[slot\]/);
  assert.match(del, /delete artifactSystem\.buffs\[key\]/);
  assert.match(del, /invalidRecipeIds = new Set\(\[itemId\]\)/);
  assert.match(del, /invalidRecipeIds\.add\(artifactId\)/);
  assert.match(del, /連帶取消依賴配方/);
  assert.doesNotMatch(del, /休眠資料/);
});

test('holders receive per-copy gold compensation and canceled jobs are refunded safely', () => {
  assert.match(del, /MIN_COMPENSATION_PER_COPY = 100/);
  assert.match(del, /Math\.max\(0, Math\.floor\(Number\(item\?\.craft\?\.gold\)/);
  assert.match(del, /compensatedCopies = heldCopies \+ deletedJobInputs/);
  assert.match(del, /compensationGold = compensatedCopies \* compensationEach/);
  assert.match(del, /jobGoldRefund = Math\.max\(0, Math\.floor\(Number\(job\?\.goldCost\)/);
  assert.match(del, /'stats\.gold': cleanup\.newGold/);
  assert.match(del, /artifact-delete-compensation/);
});

test('active refinery jobs referencing the deleted artifact are canceled and other ingredients are restored', () => {
  assert.match(del, /function jobReferencesArtifact/);
  assert.match(del, /String\(job\.knownArtifactId \|\| ''\) === itemId/);
  assert.match(del, /materialSystem\.inventory\[materialId\]/);
  assert.match(del, /artifactSystem\.inventory\[sourceId\]/);
  assert.match(del, /patch\[REFINERY_JOB_FIELD\] = null/);
  assert.match(del, /xiuxian:refinery-job-updated/);
});

test('deletion uses one safe batch and aborts before changes when too many player writes are required', () => {
  assert.match(del, /MAX_BATCH_USER_WRITES = 440/);
  assert.match(del, /affected\.length > MAX_BATCH_USER_WRITES/);
  assert.match(del, /未進行任何刪除/);
  assert.match(del, /const batch = writeBatch\(db\)/);
  assert.match(del, /await batch\.commit\(\)/);
});

test('artifact delete button appears only for existing editor records', () => {
  assert.match(del, /idInput\.readOnly/);
  assert.match(del, /className = 'aam-delete'/);
  assert.match(del, /徹底刪除法寶/);
  assert.match(del, /ARTIFACT_CATALOG\.some\(\(item\) => item\.id === itemId\)/);
});

test('delete enhancer loads after artifact manager and before admin collapsible wrapper', () => {
  const managerIndex = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const deleteIndex = main.indexOf("'./cultivation/admin-artifact-delete.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(managerIndex >= 0 && deleteIndex > managerIndex);
  assert.ok(collapseIndex > deleteIndex);
});
