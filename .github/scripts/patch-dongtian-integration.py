from pathlib import Path

# server.js: register Dongtian API and allow compressed multi-image payloads.
server_path = Path('server.js')
server = server_path.read_text()
if "const registerDongtianApi = require('./dongtian-api');" not in server:
    server = server.replace("const aiRouter = require('./ai-router');\n", "const aiRouter = require('./ai-router');\nconst registerDongtianApi = require('./dongtian-api');\n", 1)
server = server.replace("app.use(express.json());", "app.use(express.json({ limit: '20mb' }));", 1)
if "registerDongtianApi(app);" not in server:
    marker = "app.use(express.static(path.join(__dirname, 'public')));\n"
    if marker not in server:
        raise SystemExit('server static middleware marker not found')
    server = server.replace(marker, marker + "registerDongtianApi(app);\n", 1)
server_path.write_text(server)

# public/main.js: load Dongtian after Dongfu collapsible layout and before tutorial.
main_path = Path('public/main.js')
main = main_path.read_text()
if "'./cultivation/dongtian.js'" not in main:
    needle = "  './cultivation/dongfu-settings-collapsible.js',\n  './cultivation/newbie-tutorial-v2.js',"
    replacement = "  './cultivation/dongfu-settings-collapsible.js',\n  './cultivation/dongtian.js',\n  './cultivation/newbie-tutorial-v2.js',"
    if needle not in main:
        raise SystemExit('main Dongtian insertion point not found')
    main = main.replace(needle, replacement, 1)
main_path.write_text(main)

# public/main-legacy.js: render one grouped history card per Dongtian run.
legacy_path = Path('public/main-legacy.js')
legacy = legacy_path.read_text()
if "window.renderDongtianHistoryLog(log, time)" not in legacy:
    needle = "            const log = doc.data();\n            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '--';\n            const li = document.createElement('li');"
    replacement = "            const log = doc.data();\n            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '--';\n            if (log.mode === 'dongtian' && typeof window.renderDongtianHistoryLog === 'function') {\n                const groupedDongtianLog = window.renderDongtianHistoryLog(log, time);\n                if (groupedDongtianLog) { ul.appendChild(groupedDongtianLog); return; }\n            }\n            const li = document.createElement('li');"
    if needle not in legacy:
        raise SystemExit('history render insertion point not found')
    legacy = legacy.replace(needle, replacement, 1)
legacy_path.write_text(legacy)

# Extend regression coverage to integration wiring.
test_path = Path('tests/dongtian.test.cjs')
test = test_path.read_text()
if "const serverSource = readFileSync" not in test:
    test = test.replace(
        "const uiSource = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');\n",
        "const uiSource = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');\nconst serverSource = readFileSync(join(root, 'server.js'), 'utf8');\nconst mainSource = readFileSync(join(root, 'public/main.js'), 'utf8');\nconst legacySource = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');\n",
        1
    )
if "Dongtian is wired into server, feature loading, and grouped history" not in test:
    test += r'''

test('Dongtian is wired into server, feature loading, and grouped history', () => {
  assert.match(serverSource, /registerDongtianApi\(app\)/);
  assert.match(serverSource, /express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(mainSource, /'\.\/cultivation\/dongtian\.js'/);
  assert.match(legacySource, /log\.mode === 'dongtian'/);
  assert.match(legacySource, /window\.renderDongtianHistoryLog\(log, time\)/);
});
'''
test_path.write_text(test)
