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
  assert.match(artifactManager, /persistCatalog\(next, normalizedRecipes\)/);
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
