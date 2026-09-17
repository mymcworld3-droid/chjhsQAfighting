const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const drop = read('public/cultivation/material-drop-system.js');
const catalog = read('public/cultivation/material-catalog.js');
const realmUi = read('public/cultivation/material-realm-ui.js');
const realmEditor = read('public/cultivation/admin-material-realm-editor.js');
const main = read('public/main.js');

test('quiz material drops only react to a local correct answer and are de-duplicated per quiz object', () => {
  assert.match(drop, /xiuxian:stats-updated/);
  assert.match(drop, /totalAnswered/);
  assert.match(drop, /totalCorrect/);
  assert.match(drop, /text-green-400/);
  assert.match(drop, /rewardedQuizObjects = new WeakSet\(\)/);
  assert.match(drop, /rewardedQuizObjects\.has\(quiz\)/);
  assert.match(drop, /rewardedQuizObjects\.add\(quiz\)/);
  assert.match(drop, /enqueueRoll\('quiz'\)/);
});

test('dongtian material drops trigger only on the first-completion result and mark the result processed', () => {
  assert.match(drop, /#dongtian-overlay \.dt-result/);
  assert.match(drop, /首次通關洞天獎勵/);
  assert.match(drop, /materialDropProcessed === '1'/);
  assert.match(drop, /result\.dataset\.materialDropProcessed = '1'/);
  assert.match(drop, /enqueueRoll\('dongtian'\)/);
});

test('dongtian successful material rewards expand to a total of 3 through 10 items', () => {
  assert.match(drop, /DONGTIAN_MIN_MATERIALS = 3/);
  assert.match(drop, /DONGTIAN_MAX_MATERIALS = 10/);
  assert.match(drop, /function expandDongtianDrops\(drops\)/);
  assert.match(drop, /DONGTIAN_MIN_MATERIALS \+ Math\.floor\(Math\.random\(\) \* \(DONGTIAN_MAX_MATERIALS - DONGTIAN_MIN_MATERIALS \+ 1\)\)/);
  assert.match(drop, /source === 'dongtian' \? expandDongtianDrops\(rolledDrops\) : rolledDrops/);
});

test('materials have realms, colors, and realm-driven automatic drop rates', () => {
  assert.match(catalog, /export const MATERIAL_REALMS/);
  assert.match(catalog, /realm: '煉氣'/);
  assert.match(catalog, /realm: '築基'/);
  assert.match(catalog, /realm: '金丹'/);
  assert.match(catalog, /MATERIAL_REALM_COLORS/);
  assert.match(catalog, /export function materialDropRateFor/);
  assert.match(catalog, /playerRealm\.order < materialRealm\.order\) return 0/);
  assert.match(catalog, /const multiplier = 1 \+ Math\.min\(gap, 5\) \* 0\.30/);
  assert.match(drop, /materialDropRateFor\(material, score, source\)/);
  assert.match(drop, /Math\.random\(\) < rate/);
  assert.doesNotMatch(drop, /materialDropV1/);
  assert.doesNotMatch(drop, /onSnapshot/);
});

test('material rewards still commit inventory transactionally', () => {
  assert.match(drop, /runTransaction\(database\(\), async \(tx\) =>/);
  assert.match(drop, /next\.inventory\[materialId\] = \(Number\(next\.inventory\[materialId\]\) \|\| 0\) \+ quantity/);
  assert.match(drop, /tx\.update\(ref, \{ \[FIELD\]: next \}\)/);
  assert.match(drop, /material-system-updated/);
  assert.match(drop, /materialDropped: true/);
});

test('material realm color UI decorates inventory, refinery and admin material interfaces', () => {
  assert.match(realmUi, /--material-realm-color/);
  assert.match(realmUi, /\.refinery-material\[data-refinery-material\]/);
  assert.match(realmUi, /\.material-store-item/);
  assert.match(realmUi, /#admin-material-list \.amm-item/);
  assert.match(realmUi, /material-realm-badge/);
  assert.match(realmUi, /materialRealmColor/);
});

test('admin material editor can edit realm while the manual drop-rate panel is removed', () => {
  assert.match(realmEditor, /材料境界/);
  assert.match(realmEditor, /MATERIAL_REALMS/);
  assert.match(realmEditor, /realm: modal\.querySelector\('#amre-realm'\)\.value/);
  assert.match(realmEditor, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(main, /\.\/cultivation\/admin-material-realm-editor\.js/);
  assert.match(main, /\.\/cultivation\/material-realm-ui\.js/);
  assert.doesNotMatch(main, /admin-material-drop-manager/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public/cultivation/admin-material-drop-manager.js')), false);
});

test('material realm modules load in the correct order', () => {
  const materialIndex = main.indexOf("'./cultivation/material-system.js'");
  const realmUiIndex = main.indexOf("'./cultivation/material-realm-ui.js'");
  const dropIndex = main.indexOf("'./cultivation/material-drop-system.js'");
  const dongtianIndex = main.indexOf("'./cultivation/dongtian.js'");
  const adminMaterialIndex = main.indexOf("'./cultivation/admin-material-manager.js'");
  const realmEditorIndex = main.indexOf("'./cultivation/admin-material-realm-editor.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(materialIndex >= 0 && realmUiIndex > materialIndex);
  assert.ok(dropIndex > realmUiIndex);
  assert.ok(dongtianIndex > dropIndex);
  assert.ok(adminMaterialIndex >= 0 && realmEditorIndex > adminMaterialIndex);
  assert.ok(collapseIndex > realmEditorIndex);
});
