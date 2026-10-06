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


test('guest join defers prefetch lease until after membership is established', () => {
  const start = rules.indexOf('function isValidGuestJoin()');
  const end = rules.indexOf('match /rooms/{roomId}', start);
  assert.ok(start >= 0 && end > start);
  const joinRules = rules.slice(start, end);
  for (const field of ['prefetchedQuestion','prefetchedRound','prefetchOwnerUid','prefetchClaimedAtMs']) {
    assert.doesNotMatch(joinRules, new RegExp("'" + field + "'"));
  }
  const startPatch = battle.indexOf('function guestJoinPatch(room, myData)');
  const endPatch = battle.indexOf('async function claimWaitingRoom', startPatch);
  const patch = battle.slice(startPatch, endPatch);
  assert.doesNotMatch(patch, /prefetchedQuestion|prefetchedRound|prefetchOwnerUid|prefetchClaimedAtMs/);
  assert.match(battle, /prefetchRoundQuestion\(room, 1\)/);
});
