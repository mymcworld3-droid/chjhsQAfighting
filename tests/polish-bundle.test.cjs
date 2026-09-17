const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const server = readFileSync(join(root, 'server.js'), 'utf8');
const main = readFileSync(join(root, 'public/main.js'), 'utf8');
const legacy = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');
const identity = readFileSync(join(root, 'public/cultivation/identity-system.js'), 'utf8');
const identityApi = require('../identity-api.js').__test;
const dongtianApi = readFileSync(join(root, 'dongtian-api.js'), 'utf8');
const dongtian = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');
const training = readFileSync(join(root, 'public/cultivation/cultivation-training-v4.js'), 'utf8');
const status = readFileSync(join(root, 'public/cultivation/cultivation-status-panel.js'), 'utf8');

test('saved game displayName overrides Google name and identity module loads early', () => {
  assert.match(legacy, /saved game identity wins over Google profile/);
  assert.match(main, /cultivation\/identity-system\.js/);
  assert.match(identity, /window\.getPlayerDisplayName/);
  assert.match(identity, /《九州》/);
});

test('non-admin cannot claim Kyushu and name changes require AI review', () => {
  assert.match(identity, /!isAdmin\(player\) && \/九州\//);
  assert.match(identity, /\/api\/review-player-name/);
  assert.match(server, /registerIdentityApi\(app\)/);
  assert.equal(identityApi.RESERVED.test('九州劍仙'), true);
});

test('name rendering is idempotent so MutationObserver cannot self-trigger forever', () => {
  assert.match(identity, /userInfo\.dataset\.gameDisplayName !== name/);
  assert.match(identity, /userInfo\.dataset\.gameDisplayName = name/);
  assert.match(identity, /userInfo\.replaceChildren/);
  assert.doesNotMatch(identity, /userInfo\.innerHTML\s*=\s*`<i class="fa-solid fa-user-astronaut"><\/i> \$\{name\}`/);
});

test('name save finishes before optional snapshot propagation and AI review has timeout protection', () => {
  assert.match(identity, /const NAME_REVIEW_TIMEOUT_MS = 12000/);
  assert.match(identity, /new AbortController\(\)/);
  assert.match(identity, /signal: controller\.signal/);
  assert.match(identity, /名稱 AI 審核逾時/);
  assert.match(identity, /queueSnapshotPropagation\(true\)/);
  assert.doesNotMatch(identity, /await propagateNameSnapshots\(true\)/);
  assert.match(identity, /if \(saveBusy\) return/);
});

test('Dongtian generation performs a second independent AI correctness check', () => {
  assert.match(dongtianApi, /buildDongtianDoubleCheckPrompt/);
  assert.match(dongtianApi, /verifyGeneratedDongtian/);
  assert.match(dongtianApi, /confidence >= 0\.8/);
  assert.match(dongtianApi, /第二次 AI 複核未通過/);
});

test('Dongtian encounter asks before entry and shows owner metadata', () => {
  assert.match(dongtian, /function offerDongtianEncounter/);
  assert.match(dongtian, /洞天主人/);
  assert.match(dongtian, /是否現在進入/);
  assert.match(dongtian, /await markEncountered\(found\)/);
  assert.match(dongtian, /alreadyEncountered: true/);
});

test('owner proactive Dongtian editing requires an actual identified error and preserves essence', () => {
  assert.match(dongtian, /data-dt-manage/);
  assert.match(dongtian, /api\/revise-owned-dongtian-question/);
  assert.match(dongtianApi, /AI 無法確認提示詞所指出的是原題的實質錯誤/);
  assert.match(dongtianApi, /buildRevisionValidationPrompt/);
});

test('training always scrolls to top and Golden Core detail is two clean boxes', () => {
  assert.match(training, /trainingPage\.scrollTop = 0/);
  assert.match(training, /training-core-feature/);
  assert.match(training, /training-core-story/);
  assert.match(training, /window\.openGoldenCoreDetails/);
});

test('status Golden Core is keyboard and pointer clickable', () => {
  assert.match(status, /data-status-core-detail/);
  assert.match(status, /window\.openGoldenCoreDetails/);
  assert.match(status, /event\.key === 'Enter'/);
});
