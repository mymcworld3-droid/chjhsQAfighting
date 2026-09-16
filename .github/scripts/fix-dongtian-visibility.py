from pathlib import Path

# 1) Load a Firebase-free Dongtian launcher immediately with the core bundle.
main_path = Path('public/main.js')
main = main_path.read_text()
static_import = "import './cultivation/dongtian-entry.js';\n"
if static_import not in main:
    marker = "import './main-legacy.js';\n"
    if marker not in main:
        raise SystemExit('main legacy import marker missing')
    main = main.replace(marker, marker + static_import, 1)
main_path.write_text(main)

# 2) Force browsers/CDNs to fetch the new main.js rather than a stale cached copy.
index_path = Path('public/index.html')
index = index_path.read_text()
index = index.replace(
    '<script type="module" src="main.js"></script>',
    '<script type="module" src="main.js?v=20260916-dongtian3"></script>',
    1
)
index_path.write_text(index)

# 3) Regression test the visible entry and complete wiring.
test_path = Path('tests/dongtian-visibility.test.cjs')
test_path.write_text(r'''const test = require('node:test');
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
''')
