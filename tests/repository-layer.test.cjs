const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

test('repository map centralizes A / BD / C domain ownership', () => {
  const client = read('public/cultivation/data/project-repository.js');
  const server = read('server-repositories.cjs');
  for (const source of [client, server]) {
    assert.match(source, /player:\s*'A'/);
    assert.match(source, /market:\s*'A'/);
    assert.match(source, /dongtian:\s*'BD'/);
    assert.match(source, /battle:\s*'C'/);
    assert.match(source, /raid:\s*'C'/);
  }
});

test('repository bootstrap does not initialize secondary Firebase apps by itself', () => {
  const index = read('public/cultivation/data/index.js');
  assert.doesNotMatch(index, /ensureSecondaryFirebaseAuth\(/);
  assert.doesNotMatch(index, /initializeApp\(/);
});

test('raid client goes through server-authoritative repository transport', () => {
  const room = read('public/cultivation/raid-room.js');
  const mode = read('public/cultivation/raid-mode.js');
  const repository = read('public/cultivation/data/raid-repository.js');
  assert.match(room, /raidRepository\.request/);
  assert.doesNotMatch(room, /getFirestore|ensureSecondaryFirebaseAuth/);
  assert.match(mode, /playerRepository\.sendRaidInvitations/);
  assert.match(mode, /rewardRepository\.claimRaid/);
  assert.match(repository, /transport:\s*'server-authoritative'/);
  assert.match(repository, /authenticatedMainFetch/);
});

test('server raid APIs resolve databases through domain repositories', () => {
  const roomApi = read('raid-room-api.cjs');
  const rewardApi = read('raid-reward-api.cjs');
  assert.match(roomApi, /playerRepository\.resolve\(\)/);
  assert.match(roomApi, /raidRepository\.resolve\(\)/);
  assert.match(rewardApi, /playerRepository\.resolve\(\)/);
  assert.match(rewardApi, /raidRepository\.resolve\(\)/);
  assert.doesNotMatch(roomApi, /adminProject\('A'\)|adminProject\('C'\)/);
  assert.doesNotMatch(rewardApi, /adminProject\('A'\)|adminProject\('C'\)/);
});

test('raid reward uses reusable receipt transaction primitive', () => {
  const rewardApi = read('raid-reward-api.cjs');
  const receipt = read('reward-receipt.cjs');
  assert.match(rewardApi, /runRewardReceipt/);
  assert.match(receipt, /db\.runTransaction/);
  assert.match(receipt, /if \(snap\.exists\)/);
  assert.match(receipt, /tx\.create\(receiptRef, receipt\)/);
});
