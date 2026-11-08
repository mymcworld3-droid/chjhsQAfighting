const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const drop = read('public/cultivation/material-drop-system.js');
const catalog = read('public/cultivation/material-catalog.js');
const realmUi = read('public/cultivation/material-realm-ui.js');
const main = read('public/main.js');

test('ordinary material drop module is intentionally disabled', () => {
  assert.match(drop,/enabled:false/);
  assert.match(drop,/source:'retired'/);
  assert.match(drop,/quizDrops:false/);
  assert.match(drop,/dongtianDrops:false/);
  assert.doesNotMatch(drop,/runTransaction|getFirestore|onSnapshot|Math\.random/);
});

test('catalog itself also reports zero natural drop probability', () => {
  const start = catalog.indexOf('export function materialDropRateFor');
  const end = catalog.indexOf('export function normalizeMaterialDefinition', start);
  assert.match(catalog.slice(start,end),/return 0/);
});

test('material realm UI may decorate fixed raid materials without creating rewards', () => {
  assert.match(realmUi,/--material-realm-color/);
  assert.match(realmUi,/materialRealmColor/);
  assert.doesNotMatch(realmUi,/runTransaction|getFirestore/);
});

test('legacy Firebase material realm editor is no longer loaded', () => {
  assert.doesNotMatch(main,/\.\/cultivation\/admin-material-realm-editor\.js/);
  assert.doesNotMatch(main,/\.\/cultivation\/material-realm-ui\.js/);
  assert.doesNotMatch(main,/\.\/cultivation\/material-drop-system\.js/);
});

test('Dongtian starts without retired material modules', () => {
  const materialIndex = main.indexOf("'./cultivation/material-system.js'");
  const realmUiIndex = main.indexOf("'./cultivation/material-realm-ui.js'");
  const dropIndex = main.indexOf("'./cultivation/material-drop-system.js'");
  const dongtianIndex = main.indexOf("'./cultivation/dongtian.js'");
  assert.deepEqual([materialIndex,realmUiIndex,dropIndex],[-1,-1,-1]);
  assert.ok(dongtianIndex >= 0);
});
