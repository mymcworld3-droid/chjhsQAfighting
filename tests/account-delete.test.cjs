const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const accountDelete = read('public/account-delete.js');
const main = read('public/main.js');
const catalog = read('public/cultivation/artifact-catalog.js');
const artifactSystem = read('public/cultivation/artifact-system.js');
const bag = read('public/cultivation/unified-inventory-grid.js');

test('account delete control is loaded as a core module and placed directly below logout', () => {
  assert.match(main, /import '\.\/account-delete\.js';/);
  assert.ok(
    main.indexOf("void import('./account-delete.js')") < main.indexOf('const XIUXIAN_FEATURE_MODULES'),
    'account deletion must not depend on optional cultivation feature loading'
  );
  assert.match(accountDelete, /button\[onclick="logout\(\)"\]/);
  assert.match(accountDelete, /insertAdjacentElement\('afterend', button\)/);
  assert.match(accountDelete, /刪除帳號/);
});

test('account deletion is destructive only after two confirmations and a fresh Google reauthentication', () => {
  const confirmations = accountDelete.match(/await confirmDialog\(/g) || [];
  assert.equal(confirmations.length, 2);
  assert.match(accountDelete, /reauthenticateWithPopup\(user, new GoogleAuthProvider\(\)\)/);
  assert.match(accountDelete, /auth\/popup-closed-by-user/);
  assert.match(accountDelete, /auth\/popup-blocked/);
  assert.match(accountDelete, /auth\/requires-recent-login/);
});

test('account deletion cleans canonical and player-owned Firestore data before Firebase Auth', () => {
  for (const collectionName of [
    'dongtians',
    'dongtianIndex',
    'worldImmortals',
    'global_chat',
    'dongtianPlays',
    'dongtianReports'
  ]) {
    assert.match(accountDelete, new RegExp(`'${collectionName}'`));
  }

  assert.match(accountDelete, /collectQueryRefs\(database, 'dongtians', 'ownerUid', uid, warnings\)/);
  assert.match(accountDelete, /collectQueryRefs\(database, 'dongtianReports', 'reporterUid', uid, warnings\)/);
  assert.match(accountDelete, /collectQueryRefs\(database, 'global_chat', 'uid', uid, warnings\)/);
  assert.match(accountDelete, /where\(field, '==', value\)/);
  assert.match(accountDelete, /writeBatch\(database\)/);

  const reauth = accountDelete.indexOf('await reauthenticateWithPopup');
  const userDoc = accountDelete.indexOf("await deleteDoc(doc(database, 'users', user.uid))");
  const authUser = accountDelete.indexOf('await deleteUser(user)');
  assert.ok(reauth >= 0 && userDoc > reauth && authUser > userDoc);
});

test('successful account deletion clears local session state', () => {
  assert.match(accountDelete, /localStorage\.clear\(\)/);
  assert.match(accountDelete, /sessionStorage\.clear\(\)/);
  assert.match(accountDelete, /account-permanently-deleted/);
});

test('four-slot artifact equipment remains complete and persisted', () => {
  assert.match(catalog, /ARTIFACT_EQUIP_SLOTS = Object\.freeze\(\['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶'\]\)/);
  assert.match(artifactSystem, /next\.equipped\[slot\] = itemId/);
  assert.match(artifactSystem, /delete next\.equipped\[slot\]/);
  assert.match(artifactSystem, /window\.getArtifactEquipmentSlots/);
  assert.match(artifactSystem, /window\.getArtifactEquipmentStatus/);
  assert.match(bag, /class="uib-equipment-grid"/);
  assert.match(bag, /data-uib-equipped-item/);
  assert.match(bag, /data-uib-empty-slot/);
  assert.match(bag, /window\.toggleEquipArtifact/);
});
