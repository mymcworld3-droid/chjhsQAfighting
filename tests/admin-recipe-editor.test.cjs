const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const artifactManager = read('public/cultivation/admin-artifact-manager.js');
const materialManager = read('public/cultivation/admin-material-manager.js');
const catalog = read('public/cultivation/material-catalog.js');
const main = read('public/main.js');
const index = read('public/index.html');

test('artifact editor owns recipe editing and saves artifact plus recipe together', () => {
  assert.match(artifactManager, /function recipeEditorMarkup\(item = null\)/);
  assert.match(artifactManager, /data-recipe-material/);
  assert.match(artifactManager, /data-recipe-artifact/);
  assert.match(artifactManager, /function readRecipe\(modal\)/);
  assert.match(artifactManager, /persistCatalog\(next, normalizedRecipes, ownerOverride\)/);
  assert.match(artifactManager, /replaceArtifactRecipes\(normalizedRecipes, 'admin-save'\)/);
  assert.match(artifactManager, /MATERIAL_CONFIG_DOC = 'materialCatalogV1'/);
});

test('recipe editor is collapsible inside the artifact edit modal', () => {
  assert.match(artifactManager, /<details class="aam-recipe-editor"/);
  assert.match(artifactManager, /<summary>/);
  assert.match(artifactManager, /class="fa-solid fa-chevron-down aam-recipe-chevron"/);
  assert.match(artifactManager, /\.aam-recipe-editor\[open\] \.aam-recipe-chevron/);
  assert.match(artifactManager, /\.aam-recipe-list\{[^}]*max-height:42dvh[^}]*overflow-y:auto/);
  assert.doesNotMatch(artifactManager, /<details class="aam-recipe-editor"[^>]* open/);
});

test('integrated recipe editor enforces the eight-slot refinery limit while allowing unset recipes', () => {
  assert.match(artifactManager, /MIN_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(artifactManager, /MAX_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(artifactManager, /total === 1/);
  assert.match(artifactManager, /total > MAX_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(artifactManager, /0 個代表未設定/);
  assert.match(artifactManager, /套娃最多/);
  assert.match(artifactManager, /artifactRecipeDepth\(id, normalizedRecipes\)/);
});

test('material manager no longer exposes a separate artifact recipe list', () => {
  assert.doesNotMatch(index, /id="admin-recipe-list"/);
  assert.match(index, /法寶配方請在法寶編輯裡設定/);
  assert.match(materialManager, /法寶合成配方請直接到「法寶管理 → 編輯」內設定/);
  assert.doesNotMatch(main, /admin-recipe-editor-enhancement\.js/);
});

test('catalog still enforces two-to-eight configured ingredients and two artifact nesting levels', () => {
  assert.match(catalog, /MIN_ARTIFACT_RECIPE_MATERIALS = 2/);
  assert.match(catalog, /MAX_ARTIFACT_RECIPE_MATERIALS = 8/);
  assert.match(catalog, /totalItems < MIN_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(catalog, /totalItems > MAX_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(catalog, /MAX_ARTIFACT_RECIPE_NESTING = 2/);
  assert.match(catalog, /循環套娃/);
});


test('artifact editor persists validated recipes together with artifact changes', () => {
  assert.match(artifactManager, /normalizedRecipes = validateArtifactRecipes\(nextRecipes\)/);
  assert.match(artifactManager, /await persistCatalog\(next, normalizedRecipes, ownerOverride\)/);
});

test('admin can inspect and explicitly reassign a recipe owner, including a public recipe', () => {
  assert.match(artifactManager, /配方擁有人（管理員）/);
  assert.match(artifactManager, /現任：/);
  assert.match(artifactManager, /aam-owner-change/);
  assert.match(artifactManager, /aam-owner-uid/);
  assert.match(artifactManager, /aam-owner-name/);
  assert.match(artifactManager, /const changeOwner = modal\.querySelector\('#aam-owner-change'\)\?\.checked === true/);
  assert.match(artifactManager, /const ownerOverride = changeOwner \? \{ id, uid:nextUid, name:nextName \} : null/);
  assert.match(artifactManager, /persistCatalog\(next, normalizedRecipes, ownerOverride\)/);
  assert.match(artifactManager, /const transferRef = ownerOverride\?\.uid \? doc\(db, 'users', ownerOverride\.uid\) : null/);
  assert.match(artifactManager, /transferRef && !transferSnap\?\.exists\(\)/);
  assert.match(artifactManager, /if \(!owner && ownerOverride\?\.id !== item\.id\) return secured/);
  assert.match(artifactManager, /recipeOwnerUid: ownerOverride\.uid/);
  assert.match(artifactManager, /recipeOwnerUid: owner\.recipeOwnerUid/);
  assert.match(artifactManager, /配方：\$\{escapeHtml\(recipeSummaryText\(item\.id\)\)\} · 擁有人：/);
});

test('admin can publish a saved recipe at a validated price without transferring ownership', () => {
  assert.match(artifactManager, /管理員配方上架/);
  assert.match(artifactManager, /data-aam-list-recipe/);
  assert.match(artifactManager, /function adminListRecipe\(/);
  assert.match(artifactManager, /Number\.isSafeInteger\(price\)/);
  assert.match(artifactManager, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(artifactManager, /recipeSnap\.data\(\)\?\.recipes\?\.\[artifactId\]/);
  assert.match(artifactManager, /tx\.set\(listingRef,/);
  assert.match(artifactManager, /adminManaged:true, type:'recipe', itemId:artifactId/);
  assert.match(artifactManager, /recipeSaleLocked:true/);
  assert.match(artifactManager, /replaceArtifactCatalog\(updatedCatalog, 'admin-recipe-listing'\)/);
  assert.match(artifactManager, /lockedIds\.has\(item\.id\)/);
  assert.match(artifactManager, /recipeSaleLocked: original\?\.recipeSaleLocked === true/);
  assert.match(artifactManager, /請先儲存配方或擁有人變更，再上架/);
});
