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
const server = read('server.js');
const api = read('admin-account-api.cjs');

test('admin account module has valid JavaScript syntax and is registered before collapsible panels', () => {
  const file = path.join(__dirname, '..', 'public/cultivation/admin-account-manager.js');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const accounts = main.indexOf("'./cultivation/admin-account-manager.js'");
  const collapse = main.indexOf("'./cultivation/admin-panel-collapsible.js'");
  assert.ok(accounts > 0 && collapse > accounts);
});

test('directory uses authenticated backend API instead of browser Firestore collection reads', () => {
  assert.match(manager, /fetch\('\/api\/admin\/accounts'/);
  assert.match(manager, /Authorization: 'Bearer ' \+ idToken/);
  assert.match(manager, /requestAdminAccounts\('list'\)/);
  assert.match(manager, /requestAdminAccounts\('detail', \{ uid \}\)/);
  assert.doesNotMatch(manager, /getFirestore|getDocs\(|getDoc\(|onSnapshot\(/);
  assert.match(server, /registerAdminAccountApi/);
  assert.match(server, /registerAdminAccountApi\(app\)/);
  assert.match(api, /verifyIdToken\(token, true\)/);
  assert.match(api, /adminSnap\.data\(\)\?\.isAdmin !== true/);
  assert.match(api, /a\.db\.collection\('users'\)\.get\(\)/);
});

test('account directory searches and paginates summaries and reads details on selection', () => {
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
  assert.match(api, /SENSITIVE_KEY/);
  assert.match(api, /\[已遮蔽\]/);
});
