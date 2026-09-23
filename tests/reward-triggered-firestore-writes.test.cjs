const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../public');
const ranks = fs.readFileSync(path.join(root, 'cultivation/cultivation-rank-sync.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main-legacy.js'), 'utf8');

test('rank sync writes only on realm change, not every cultivation score change', () => {
  assert.match(ranks, /const previousRank = Number\(data\.stats\.rankLevel\)/);
  assert.ok(ranks.includes('const key = `${user.uid}:${rank}`'));
  assert.ok(ranks.includes('lastPersistedKey === key || previousRank === rank'));
  assert.match(ranks, /await updateDoc\(doc\(getFirestore\(getApp\(\)\), 'users', user\.uid\), \{ 'stats\.rankLevel': rank \}\)/);
});

test('presence stays visible with five-minute window but writes at two-minute cadence', () => {
  assert.match(main, /presenceInterval = setInterval\(updatePresence, 2 \* 60 \* 1000\)/);
  assert.match(main, /document\.visibilityState === 'hidden'/);
  assert.match(main, /const fiveMinutesAgo =/);
});
