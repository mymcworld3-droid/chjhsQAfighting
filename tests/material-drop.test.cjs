const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const drop = read('public/cultivation/material-drop-system.js');
const admin = read('public/cultivation/admin-material-drop-manager.js');
const main = read('public/main.js');

test('quiz material drops only react to a local correct answer and are de-duplicated per quiz object', () => {
  assert.match(drop, /window\.addEventListener\('xiuxian:stats-updated', onStatsUpdated\)/);
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

test('material drops use configurable independent rates and commit inventory transactionally', () => {
  assert.match(drop, /CONFIG_DOC = 'materialDropV1'/);
  assert.match(drop, /onSnapshot\(doc\(database\(\), CONFIG_COLLECTION, CONFIG_DOC\)/);
  assert.match(drop, /Math\.random\(\) < rate/);
  assert.match(drop, /runTransaction\(database\(\), async \(tx\) =>/);
  assert.match(drop, /next\.inventory\[materialId\] = \(Number\(next\.inventory\[materialId\]\) \|\| 0\) \+ quantity/);
  assert.match(drop, /tx\.update\(ref, \{ \[FIELD\]: next \}\)/);
  assert.match(drop, /material-system-updated/);
  assert.match(drop, /materialDropped: true/);
});

test('admin can edit quiz and dongtian drop percentages for every current material', () => {
  assert.match(admin, /材料掉落機率/);
  assert.match(admin, /data-drop-quiz/);
  assert.match(admin, /data-drop-dongtian/);
  assert.match(admin, /問道答對掉落率/);
  assert.match(admin, /洞天首次通關掉落率/);
  assert.match(admin, /rules: next/);
  assert.match(admin, /userSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(admin, /material-drop-rules-updated/);
});

test('material drop modules load after material inventory and admin material manager', () => {
  const materialIndex = main.indexOf("'./cultivation/material-system.js'");
  const dropIndex = main.indexOf("'./cultivation/material-drop-system.js'");
  const dongtianIndex = main.indexOf("'./cultivation/dongtian.js'");
  const adminMaterialIndex = main.indexOf("'./cultivation/admin-material-manager.js'");
  const adminDropIndex = main.indexOf("'./cultivation/admin-material-drop-manager.js'");
  const collapseIndex = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(materialIndex >= 0 && dropIndex > materialIndex);
  assert.ok(dongtianIndex > dropIndex);
  assert.ok(adminMaterialIndex >= 0 && adminDropIndex > adminMaterialIndex);
  assert.ok(collapseIndex > adminDropIndex);
});
