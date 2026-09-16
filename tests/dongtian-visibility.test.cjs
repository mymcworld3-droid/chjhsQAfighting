const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'public/main.js'), 'utf8');
const index = readFileSync(join(root, 'public/index.html'), 'utf8');
const entry = readFileSync(join(root, 'public/cultivation/dongtian-entry.js'), 'utf8');
const dongtian = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');
const server = readFileSync(join(root, 'server.js'), 'utf8');

test('Dongtian always has a visible Firebase-free launcher in Dongfu', () => {
  assert.match(main, /import '\.\/cultivation\/dongtian-entry\.js';/);
  assert.match(entry, /id = ENTRY_ID/);
  assert.match(entry, /開啟洞天/);
  assert.match(entry, /開闢與遊歷洞天/);
  assert.match(entry, /dongtian-launcher-card/);
  assert.match(entry, /import\('\.\/dongtian\.js\?v=20260916-2'\)/);
});

test('main bundle is cache-busted so a stale client cannot hide Dongtian', () => {
  assert.match(index, /<script type="module" src="main\.js\?v=20260916-dongtian3"><\/script>/);
});

test('full Dongtian implementation and API remain wired behind the launcher', () => {
  assert.match(main, /'\.\/cultivation\/dongtian\.js'/);
  assert.match(dongtian, /window\.openDongtianPanel/);
  assert.match(dongtian, /\/api\/generate-dongtian/);
  assert.match(dongtian, /dongtianPlays/);
  assert.match(dongtian, /dongtianAnswers/);
  assert.match(server, /registerDongtianApi\(app\)/);
});
