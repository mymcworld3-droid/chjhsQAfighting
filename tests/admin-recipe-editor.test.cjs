const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const manager = read('public/cultivation/admin-material-manager.js');
const enhancement = read('public/cultivation/admin-recipe-editor-enhancement.js');
const catalog = read('public/cultivation/material-catalog.js');
const main = read('public/main.js');

test('admin material manager exposes per-artifact recipe editing and persists recipes', () => {
  assert.match(manager, /data-recipe-edit/);
  assert.match(manager, /function openRecipeEditor\(artifact\)/);
  assert.match(manager, /data-recipe-material/);
  assert.match(manager, /data-recipe-artifact/);
  assert.match(manager, /async function saveRecipe\(modal, artifact\)/);
  assert.match(manager, /persistRecipes\(next\)/);
  assert.match(manager, /replaceArtifactRecipes\(normalized, 'admin-save'\)/);
});

test('admin recipe editor mirrors the eight-slot refinery limit in the UI', () => {
  assert.match(enhancement, /SLOT_LIMIT = 8/);
  assert.match(enhancement, /已使用|煉器陣素材格/);
  assert.match(enhancement, /total > SLOT_LIMIT/);
  assert.match(enhancement, /save\.disabled = invalid/);
  assert.match(enhancement, /最多 8 個/);
  assert.match(enhancement, /不看 8 格排列/);
  assert.match(enhancement, /套娃最多 2 層/);
});

test('catalog enforces eight total ingredients and two artifact nesting levels', () => {
  assert.match(catalog, /totalItems > MAX_ARTIFACT_RECIPE_MATERIALS/);
  assert.match(catalog, /MAX_ARTIFACT_RECIPE_NESTING = 2/);
  assert.match(catalog, /recipeDepthFor/);
  assert.match(catalog, /循環套娃/);
  assert.match(catalog, /超過煉器陣/);
});

test('recipe editor enhancement loads after the base admin material manager', () => {
  const managerIndex = main.indexOf("'./cultivation/admin-material-manager.js'");
  const enhancementIndex = main.indexOf("'./cultivation/admin-recipe-editor-enhancement.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(managerIndex >= 0);
  assert.ok(enhancementIndex > managerIndex);
  assert.ok(collapseIndex > enhancementIndex);
});
