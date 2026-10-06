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

test('battle room traffic is isolated to C and rewards cross the server bridge to A', () => {
  const mode=read('public/cultivation/battle-mode-v2.js'), repository=read('public/cultivation/data/battle-repository.js'), reward=read('public/cultivation/data/reward-repository.js'), api=read('battle-reward-api.cjs');
  assert.match(mode,/battleRepository\.connect\(\)/);assert.match(mode,/rewardRepository\.claimBattle/);
  assert.doesNotMatch(mode,/getFirestore\(getApp\(\)\)|getAuth\(getApp\(\)\)/);
  assert.match(repository,/getProjectServices\('C'\)/);assert.match(api,/playerRepository\.resolve\(\)/);assert.match(api,/battleRepository\.resolve\(\)/);assert.match(api,/runRewardReceipt/);assert.match(reward,/\/api\/battle\/reward/);
});
test('Dongtian content uses BD while plays, history and player rewards remain in A', () => {
  const mode=read('public/cultivation/dongtian.js'), repository=read('public/cultivation/data/dongtian-repository.js'), player=read('public/cultivation/data/player-repository.js'), reward=read('public/cultivation/data/reward-repository.js'), api=read('dongtian-settlement-api.cjs');
  assert.match(mode,/dongtianRepository\.connect\(\)/);assert.match(mode,/const progressDb = progress\.db/);assert.match(mode,/collection\(progressDb, PLAY_COLLECTION\)/);assert.match(mode,/playerRepository\.addExamLog/);assert.match(mode,/rewardRepository\.claimDongtian/);
  assert.doesNotMatch(mode,/getFirestore\(getApp\(\)\)|getAuth\(getApp\(\)\)/);
  assert.match(repository,/progressRole:'A'/);assert.match(repository,/getProjectServices\('BD'\)/);assert.match(repository,/getProjectServices\('A'/);assert.match(repository,/authenticatedMainFetch/);assert.match(repository,/\/api\/dongtian\/list-index/);assert.match(player,/collection\(db,'exam_logs'\)/);assert.match(reward,/\/api\/dongtian\/settle/);assert.match(api,/PLAY_COLLECTION='dongtianPlays'/);
});
