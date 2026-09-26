const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const del = read('public/cultivation/admin-artifact-delete.js');
const api = read('admin-artifact-delete-api.cjs');
const server = read('server.js');
const main = read('public/main.js');

test('artifact delete uses trusted backend instead of client-wide Firestore access', () => {
  assert.match(del, /fetch\('\/api\/admin\/artifacts\/delete'/);
  assert.match(del, /Authorization: 'Bearer ' \+ idToken/);
  assert.match(del, /requestArtifactDeletion\('preview', itemId\)/);
  assert.match(del, /requestArtifactDeletion\('delete', itemId\)/);
  assert.doesNotMatch(del, /getFirestore|getDocs\(|writeBatch\(|collection\(db, 'users'\)/);
  assert.match(server, /registerAdminArtifactDeleteApi/);
  assert.match(server, /registerAdminArtifactDeleteApi\(app\)/);
});

test('backend verifies A identity and administrator role before scanning players', () => {
  assert.match(api, /verifyIdToken\(token, true\)/);
  assert.match(api, /decoded\.aud !== PROJECT_IDS\.A/);
  assert.match(api, /adminSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(api, /a\.db\.collection\('users'\)\.get\(\)/);
  assert.match(api, /MAX_BATCH_USER_WRITES = 440/);
});

test('artifact deletion removes inventory equipment buffs and dependent recipes', () => {
  assert.match(api, /delete artifactSystem\.inventory\[itemId\]/);
  assert.match(api, /delete artifactSystem\.equipped\[slot\]/);
  assert.match(api, /delete artifactSystem\.buffs\[key\]/);
  assert.match(api, /invalidRecipeIds = new Set\(\[itemId\]\)/);
  assert.match(api, /invalidRecipeIds\.add\(artifactId\)/);
});

test('holders receive per-copy gold compensation and canceled jobs are refunded', () => {
  assert.match(api, /MIN_COMPENSATION_PER_COPY = 100/);
  assert.match(api, /compensatedCopies = heldCopies \+ deletedJobInputs/);
  assert.match(api, /compensationGold = compensatedCopies \* compensationEach/);
  assert.match(api, /jobGoldRefund = Math\.max\(0, Math\.floor\(Number\(job\?\.goldCost\)/);
  assert.match(api, /'stats\.gold': cleanup\.newGold/);
  assert.match(del, /artifact-delete-compensation/);
});

test('server commits catalog recipes and player cleanup in one admin batch', () => {
  assert.match(api, /const batch = a\.db\.batch\(\)/);
  assert.match(api, /batch\.set\(plan\.artifactRef/);
  assert.match(api, /batch\.set\(plan\.materialRef/);
  assert.match(api, /batch\.update\(ref, patch\)/);
  assert.match(api, /await batch\.commit\(\)/);
  assert.match(api, /artifactCatalogSchemaVersion: ARTIFACT_SCHEMA_VERSION/);
  assert.match(api, /artifactRecipeSchemaVersion: RECIPE_SCHEMA_VERSION/);
});

test('artifact delete button appears only for existing editor records', () => {
  assert.match(del, /idInput\.readOnly/);
  assert.match(del, /className = 'aam-delete'/);
  assert.match(del, /徹底刪除法寶/);
  assert.match(del, /ARTIFACT_CATALOG\.some\(item => item\.id === itemId\)/);
});

test('delete enhancer loads after artifact manager and before admin collapsible wrapper', () => {
  const managerIndex = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const deleteIndex = main.indexOf("'./cultivation/admin-artifact-delete.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(managerIndex >= 0 && deleteIndex > managerIndex);
  assert.ok(collapseIndex > deleteIndex);
});
