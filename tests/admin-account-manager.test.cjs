const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const manager = read('public/cultivation/admin-account-manager.js');
const main = read('public/main.js');

test('admin account module has valid JavaScript syntax and is registered before collapsible panels', () => {
  const file = path.join(__dirname, '..', 'public/cultivation/admin-account-manager.js');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const accounts = main.indexOf("'./cultivation/admin-account-manager.js'");
  const collapse = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(accounts > 0 && collapse > accounts);
});

test('directory reads canonical registered game accounts only with a fresh admin check', () => {
  assert.match(manager, /getDocs\(collection\(database\(\), 'users'\)\)/);
  assert.match(manager, /getDoc\(doc\(database\(\), 'users', uid\)\)/);
  assert.match(manager, /snapshot\.data\(\)\.isAdmin !== true/);
  assert.match(manager, /currentUser\(\)\?\.uid !== uid/);
  assert.match(manager, /window\.loadAdminData = wrapped/);
  assert.match(manager, /onAuthStateChanged/);
});

test('account directory searches and paginates, but only reads player details on selection', () => {
  assert.match(manager, /PAGE_SIZE = 20/);
  assert.match(manager, /entry\.data\.email/);
  assert.match(manager, /entry\.data\.friendCode/);
  assert.match(manager, /button\.dataset\.uid = uid/);
  assert.match(manager, /showDetail\(button\.dataset\.uid\)/);
  for (const slot of ['本命法寶', '護身法寶', '佩飾法寶', '輔助法寶']) {
    assert.ok(manager.includes(slot));
  }
  assert.match(manager, /describeInventory\(data\.materialSystem\?\.inventory\)/);
  assert.match(manager, /fmtDate\(data\.createdAt\)/);
  assert.match(manager, /textContent = dataText/);
  assert.doesNotMatch(manager, /updateDoc\(|setDoc\(|deleteDoc\(/);
});
