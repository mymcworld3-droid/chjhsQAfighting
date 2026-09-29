'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(root, 'firestore-c.rules'), 'utf8');
const battle = fs.readFileSync(path.join(root, 'public/cultivation/battle-mode-v2.js'), 'utf8');

test('Firebase C rooms rules keep battle data authenticated and member-scoped', () => {
  assert.match(rules, /match \/rooms\/\{roomId\}/);
  assert.match(rules, /allow get, list: if signedIn\(\)/);
  assert.match(rules, /request\.resource\.data\.host\.uid == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.guest\.uid == request\.auth\.uid/);
  assert.match(rules, /isRoomMember\(\)/);
  assert.match(rules, /sameHostUid\(\)/);
  assert.match(rules, /sameGuestUid\(\)/);
  assert.match(rules, /allow write: if false/);
});

test('Battle v2 surfaces actionable Firestore C failures', () => {
  assert.match(battle, /firebaseBattleErrorMessage/);
  assert.match(battle, /permission-denied/);
  assert.match(battle, /failed-precondition/);
  assert.match(battle, /Firebase C/);
});
