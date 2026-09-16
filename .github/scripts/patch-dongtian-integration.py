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

# public/cultivation/dongtian.js: do not persist raw source text and make subject-family matching robust.
ui_path = Path('public/cultivation/dongtian.js')
ui = ui_path.read_text()
ui = ui.replace(
    "      ...metadata,\n      sourceText: String(sourceText || '').slice(0, 16000),\n      questions: generated.questions",
    "      ...metadata,\n      questions: generated.questions",
    1
)
ui = ui.replace(
    "const snap = await getDocs(query(collection(db, INDEX_COLLECTION), where('ownerUid', '==', uid()), limit(80)));",
    "const snap = await getDocs(query(collection(db, INDEX_COLLECTION), where('ownerUid', '==', uid())));",
    1
)
old_match = """  function subjectMatches(caveSubject, practiceSubjects) {
    if (!caveSubject || caveSubject === '綜合') return true;
    if (practiceSubjects.includes('綜合')) return true;
    return practiceSubjects.includes(caveSubject);
  }
"""
new_match = """  function subjectFamily(subject) {
    const value = String(subject || '').trim();
    if (['自然', '生物理化', '物理', '化學', '生物'].includes(value)) return '自然';
    if (['社會', '歷史地理公民', '歷史', '地理', '公民'].includes(value)) return '社會';
    return value;
  }

  function subjectMatches(caveSubject, practiceSubjects) {
    if (!caveSubject || caveSubject === '綜合') return true;
    if (practiceSubjects.includes('綜合')) return true;
    const caveFamily = subjectFamily(caveSubject);
    return practiceSubjects.some((subject) => subject === caveSubject || subjectFamily(subject) === caveFamily);
  }
"""
if old_match in ui:
    ui = ui.replace(old_match, new_match, 1)
elif "function subjectFamily(subject)" not in ui:
    raise SystemExit('Dongtian subject matching marker not found')
ui_path.write_text(ui)

# Extend regression coverage to integration wiring and privacy/pool behavior.
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
if "Dongtian does not persist raw creator source material" not in test:
    test += r'''

test('Dongtian does not persist raw creator source material and owner library has no artificial cap', () => {
  const saveBlock = uiSource.slice(uiSource.indexOf('async function saveGeneratedDongtian'), uiSource.indexOf('async function loadOwnDongtians'));
  assert.doesNotMatch(saveBlock, /sourceText:/);
  assert.match(uiSource, /where\('ownerUid', '==', uid\(\)\)\)\)/);
  assert.doesNotMatch(uiSource, /where\('ownerUid', '==', uid\(\)\), limit\(80\)/);
});

test('Dongtian subject matching understands grouped school subjects', () => {
  assert.match(uiSource, /function subjectFamily/);
  assert.match(uiSource, /'生物理化'/);
  assert.match(uiSource, /'自然'/);
  assert.match(uiSource, /'歷史地理公民'/);
  assert.match(uiSource, /subjectFamily\(subject\) === caveFamily/);
});
'''
test_path.write_text(test)
