const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = join(__dirname, '..');
const apiSource = readFileSync(join(root, 'dongtian-api.js'), 'utf8');
const uiSource = readFileSync(join(root, 'public/cultivation/dongtian.js'), 'utf8');
const serverSource = readFileSync(join(root, 'server.js'), 'utf8');
const mainSource = readFileSync(join(root, 'public/main.js'), 'utf8');
const legacySource = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');

const api = require('../dongtian-api.js').__test;

test('Dongtian API normalizes the requested ordered question format and metadata', () => {
  const normalized = api.normalizeResult({
    name: '星軌算境', level: '國中二年級', difficulty: '中等', subject: '數學',
    knowledgePoints: ['比例', '一次函數'],
    questions: [
      { id: 'x', difficulty: 'easy', q: 'Q1', correct: 'A', wrong: ['B','C','D'], exp: 'E1', subject: '數學' },
      { id: 'y', difficulty: 'medium', q: 'Q2', correct: 'A2', wrong: ['B2','C2','D2'], exp: 'E2', subject: '數學' },
      { id: 'z', difficulty: 'hard', q: 'Q3', correct: 'A3', wrong: ['B3','C3','D3'], exp: 'E3', subject: '數學' }
    ]
  }, '國中一年級');
  assert.equal(normalized.level, '國中二年級');
  assert.equal(normalized.difficulty, 'medium');
  assert.equal(normalized.questions[0].id, 'DT-001');
  assert.equal(normalized.questions[2].id, 'DT-003');
  assert.deepEqual(Object.keys(normalized.questions[0]), ['id','difficulty','q','correct','wrong','exp','subject']);
});

test('Dongtian generation prompt asks one batch to cover as many knowledge points as possible', () => {
  const prompt = api.buildPrompt('notes', '國中三年級', 3);
  assert.match(prompt, /一次分析使用者提供的所有文字與 3 張圖片/);
  assert.match(prompt, /所有可獨立學習／考核的知識點/);
  assert.match(prompt, /questions 陣列順序就是玩家實際遊玩順序/);
  assert.match(prompt, /素材很少可 3–5 題/);
  assert.match(prompt, /DT-001/);
});

test('Dongtian encounter is only for higher-grade matching players and is one-time', () => {
  assert.match(uiSource, /const ENCOUNTER_CHANCE = 0\.20/);
  assert.match(uiSource, /playerOrder > Number\(item\.levelOrder\)/);
  assert.match(uiSource, /subjectMatches\(item\.subject, subjects\)/);
  assert.match(uiSource, /item\.ownerUid !== uid\(\)/);
  assert.match(uiSource, /if \(playSnap\.exists\(\)\) continue/);
  assert.match(uiSource, /encountered: true/);
});

test('Dongtian session keeps a fixed ordered question array until completion or explicit exit', () => {
  assert.match(uiSource, /const q = s\.dongtian\.questions\[s\.index\]/);
  assert.match(uiSource, /s\.index \+= 1; renderRunner\(\)/);
  assert.match(uiSource, /id="dt-exit"/);
  assert.doesNotMatch(uiSource, /generate-dongtian[\s\S]*renderRunner[\s\S]*fetch\('\/api\/generate-quiz'/);
});

test('Dongtian rewards owner once per unique player completion while player reward stays placeholder', () => {
  assert.match(uiSource, /OWNER_CULTIVATION_REWARD = 1/);
  assert.match(uiSource, /OWNER_GOLD_REWARD = 5/);
  assert.match(uiSource, /if \(!alreadyCompleted\)/);
  assert.match(uiSource, /'stats\.totalScore': increment\(OWNER_CULTIVATION_REWARD\)/);
  assert.match(uiSource, /'stats\.gold': increment\(OWNER_GOLD_REWARD\)/);
  assert.match(uiSource, /獎勵內容目前待開放/);
});

test('Dongtian history is saved as one grouped run instead of one document per question', () => {
  assert.match(uiSource, /mode: 'dongtian'/);
  assert.match(uiSource, /dongtianAnswers: s\.answers/);
  assert.match(uiSource, /window\.renderDongtianHistoryLog/);
  const addDocCalls = (uiSource.match(/addDoc\(collection\(db, 'exam_logs'\)/g) || []).length;
  assert.equal(addDocCalls, 1);
});

test('Dongtian scripts are syntactically valid', () => {
  execFileSync(process.execPath, ['--check', join(root, 'dongtian-api.js')]);
  execFileSync(process.execPath, ['--check', join(root, 'public/cultivation/dongtian.js')]);
});

test('Dongtian API supports multimodal Gemini and OpenAI-compatible payloads', () => {
  assert.match(apiSource, /inlineData/);
  assert.match(apiSource, /type: 'image_url'/);
  assert.match(apiSource, /MAX_IMAGES = 8/);
  assert.match(apiSource, /maxOutputTokens: 16384/);
});


test('Dongtian is wired into server, feature loading, and grouped history', () => {
  assert.match(serverSource, /registerDongtianApi\(app\)/);
  assert.match(serverSource, /express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(mainSource, /'\.\/cultivation\/dongtian\.js'/);
  assert.match(legacySource, /log\.mode === 'dongtian'/);
  assert.match(legacySource, /window\.renderDongtianHistoryLog\(log, time\)/);
});


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


test('Dongtian question reports require double AI confirmation before sealing the whole cave', () => {
  assert.match(apiSource, /\/api\/review-dongtian-question/);
  assert.match(apiSource, /buildQuestionReviewVerificationPrompt/);
  assert.match(apiSource, /review\.hasError && review\.confidence >= 0\.75/);
  assert.match(apiSource, /verification\.confirmError && verification\.confidence >= 0\.75/);
  assert.match(uiSource, /id=\"dt-report-question\"/);
  assert.match(uiSource, /REPORT_COLLECTION = 'dongtianReports'/);
  assert.match(uiSource, /status: 'suspended'/);
  assert.match(uiSource, /moderationStatus: 'needs_revision'/);
  assert.match(uiSource, /activeReportId: reportRef\.id/);
  assert.match(uiSource, /writeDongtianHistory\(s, false\)/);
});

test('Suspended Dongtians are excluded from encounters and owners receive a repair action', () => {
  assert.match(uiSource, /where\('status', '==', 'active'\)/);
  assert.match(uiSource, /data-dt-repair/);
  assert.match(uiSource, /已封印 · 待修復/);
  assert.match(uiSource, /if \(dongtian\.status && dongtian\.status !== 'active'\)/);
  assert.match(uiSource, /ensureSessionDongtianActive/);
});

test('Owner repair is prompt-only, preserves question identity, and requires a second AI validation', () => {
  assert.match(apiSource, /\/api\/revise-dongtian-question/);
  assert.match(apiSource, /核心知識點、學習目標、原本要考的概念/);
  assert.match(apiSource, /essencePreserved/);
  assert.match(apiSource, /errorResolved/);
  assert.match(apiSource, /singleCorrect/);
  assert.match(apiSource, /noNewError/);
  assert.match(apiSource, /levelAppropriate/);
  assert.match(apiSource, /confidence >= 0\.8/);
  assert.match(uiSource, /id=\"dt-revision-hint\"/);
  assert.match(uiSource, /只有洞天主人可以修復/);
  assert.match(uiSource, /questions\[questionIndex\] = \{ \.\.\.revised, id: liveQuestion\.id, difficulty: liveQuestion\.difficulty, subject: liveQuestion\.subject \}/);
  assert.match(uiSource, /status: 'active'/);
  assert.match(uiSource, /status: 'resolved'/);
});

test('Standalone revision normalization cannot change id, subject, or difficulty', () => {
  const original = { id: 'DT-007', difficulty: 'hard', q: '原題', correct: '甲', wrong: ['乙','丙','丁'], exp: '原解析', subject: '數學' };
  const revised = api.normalizeStandaloneQuestion({
    id: 'HACK', difficulty: 'easy', subject: '歷史', q: '修正題', correct: '1', wrong: ['2','3','4'], exp: '修正解析'
  }, original);
  assert.equal(revised.id, 'DT-007');
  assert.equal(revised.difficulty, 'hard');
  assert.equal(revised.subject, '數學');
  assert.equal(revised.q, '修正題');
});
