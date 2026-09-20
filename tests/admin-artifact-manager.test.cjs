const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const catalog = read('public/cultivation/artifact-catalog.js');
const sync = read('public/cultivation/artifact-catalog-sync.js');
const manager = read('public/cultivation/admin-artifact-manager.js');
const collapsible = read('public/cultivation/admin-panel-collapsible.js');
const main = read('public/main.js');

test('admin and all players use the same runtime artifact catalog source', () => {
  assert.match(catalog, /export const ARTIFACT_CATALOG/);
  assert.match(catalog, /ARTIFACT_CATALOG\.splice\(0, ARTIFACT_CATALOG\.length/);
  assert.match(catalog, /export function replaceArtifactCatalog/);
  assert.match(sync, /CONFIG_COLLECTION = 'gameConfig'/);
  assert.match(sync, /CONFIG_DOC = 'artifactCatalogV1'/);
  assert.match(sync, /onSnapshot\(ref/);
  assert.match(sync, /replaceArtifactCatalog\(data\.items, 'firestore'\)/);
  assert.match(manager, /CONFIG_COLLECTION = 'gameConfig'/);
  assert.match(manager, /CONFIG_DOC = 'artifactCatalogV1'/);
  assert.match(manager, /tx\.set\(configRef/);
  assert.match(manager, /replaceArtifactCatalog\(committedCatalog, 'admin-save'\)/);
});

test('artifact editor supports add and edit with strict validation and immutable existing ids', () => {
  assert.match(manager, /新增法寶/);
  assert.match(manager, /編輯法寶/);
  assert.match(manager, /existing|originalId/);
  assert.match(manager, /既有法寶 ID 不可修改/);
  assert.match(manager, /validateArtifactCatalog\(next\)/);
  assert.match(manager, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(catalog, /法寶 ID 重複/);
  assert.match(catalog, /至少需要一個效果/);
  assert.match(catalog, /必須指定裝備欄位/);
});

test('admin editor exposes generic effect fields instead of hard-coding individual artifacts', () => {
  assert.match(manager, /SUPPORTED_ARTIFACT_EFFECTS\.map/);
  assert.match(manager, /data-aam-effect-value/);
  assert.match(manager, /data-aam-effect-multiplier/);
  assert.match(manager, /data-aam-effect-duration/);
  assert.match(manager, /value="quiz"/);
  assert.match(manager, /value="battle"/);
  assert.match(manager, /value="dongtian"/);
  for (const name of ['七寶玲瓏尺', '破軍戰鼓', '悟道玄燈', '鎮嶽玄甲', '太虛劍', '長生玉佩']) {
    assert.doesNotMatch(manager, new RegExp(name));
  }
});

test('artifact editor shows a right-side supported-effect guide with one-click add buttons', () => {
  assert.match(manager, /EFFECT_GUIDE/);
  assert.match(manager, /可用功能/);
  assert.match(manager, /aam-editor-layout/);
  assert.match(manager, /aam-guide/);
  assert.match(manager, /data-aam-add-effect-type/);
  assert.match(manager, /defaultEffect\(type\)/);
  for (const type of ['equip_attack_flat', 'equip_attack_percent', 'equip_hp_flat', 'equip_hp_percent', 'timed_attack_multiplier', 'timed_cultivation_multiplier', 'remove_wrong_option']) {
    assert.match(manager, new RegExp(type));
  }
});

test('artifact category is a dropdown while preserving legacy custom categories', () => {
  assert.match(manager, /ARTIFACT_CATEGORIES = Object\.freeze\(\['消耗法寶', '裝備法寶'\]\)/);
  assert.match(manager, /<select id="aam-category">/);
  assert.doesNotMatch(manager, /<input id="aam-category"/);
  assert.match(manager, /if \(!options\.includes\(value\)\) options\.push\(value\)/);
});

test('all major admin areas can collapse and dynamic admin panels are wrapped too', () => {
  assert.match(collapsible, /數據統計/);
  assert.match(collapsible, /系統管理/);
  assert.match(collapsible, /商城商品/);
  assert.match(collapsible, /法寶管理/);
  assert.match(collapsible, /管理員靈石/);
  assert.match(collapsible, /MutationObserver/);
  assert.match(collapsible, /admin-collapse-body/);
  assert.match(collapsible, /body\.hidden = !!collapsed/);
  assert.match(collapsible, /localStorage\.setItem\(STORAGE_KEY/);
});

test('feature load order syncs catalog before artifact engine and loads admin manager before collapsible wrapper', () => {
  const syncIndex = main.indexOf("'./cultivation/artifact-catalog-sync.js'");
  const engineIndex = main.indexOf("'./cultivation/artifact-system.js'");
  const managerIndex = main.indexOf("'./cultivation/admin-artifact-manager.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(syncIndex >= 0 && engineIndex > syncIndex);
  assert.ok(managerIndex >= 0 && collapseIndex > managerIndex);
});

test('available artifact effects are grouped into collapsible independently scrollable categories', () => {
  assert.match(manager, /const EFFECT_GROUPS = Object\.freeze/);
  for (const title of ['攻擊與傷害', '暴擊・連擊・吸血', '防禦與護體', '條件觸發', '特殊奇術', '限時・修煉・答題']) {
    assert.match(manager, new RegExp(title));
  }
  assert.match(manager, /<details class="aam-guide-group"/);
  assert.match(manager, /<summary>/);
  assert.match(manager, /class="aam-guide-scroll"/);
  assert.match(manager, /\.aam-guide-scroll\{[^}]*overflow-y:auto/);
  assert.match(manager, /overscroll-behavior:contain/);
  assert.match(manager, /scrollbar-gutter:stable/);
  assert.match(manager, /data-aam-add-effect-type/);
  assert.match(manager, /querySelectorAll\('\[data-aam-add-effect-type\]'\)/);
  assert.match(manager, /max-height:42dvh/);
});


test('artifact edit modal includes a collapsible recipe section', () => {
  assert.match(manager, /recipeEditorMarkup\(item\)/);
  assert.match(manager, /<details class="aam-recipe-editor"/);
  assert.match(manager, /data-aam-recipe-count/);
  assert.match(manager, /data-recipe-material/);
  assert.match(manager, /data-recipe-artifact/);
  assert.match(manager, /配方：\$\{escapeHtml\(recipeSummaryText\(item\.id\)\)\}/);
});


test('pending artifact approval does not reference editor-only normalizedRecipes', () => {
  const start = manager.indexOf('async function approveGeneratedArtifact');
  const end = manager.indexOf('async function saveFromModal', start);
  const approval = manager.slice(start, end);
  assert.match(approval, /await persistCatalog\(next\)/);
  assert.doesNotMatch(approval, /normalizedRecipes/);
  assert.match(approval, /reviewStatus: 'approved'/);
});


test('artifact equipment slot is a fixed dropdown shared with the player equipment system', () => {
  assert.match(catalog, /ARTIFACT_EQUIP_SLOTS/);
  assert.match(manager, /ARTIFACT_EQUIP_SLOTS/);
  assert.match(manager, /<select id="aam-slot">/);
  assert.match(manager, /不使用裝備欄位/);
  assert.match(manager, /ARTIFACT_EQUIP_SLOTS\.map/);
  assert.doesNotMatch(manager, /<input id="aam-slot"/);
  for (const slot of ['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶']) assert.match(catalog, new RegExp(slot));
});
