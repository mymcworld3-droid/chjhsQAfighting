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

test('Dongtian API normalizes at least ten ordered single-choice questions and metadata', () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({
    id: 'x' + i,
    difficulty: i < 3 ? 'easy' : (i < 7 ? 'medium' : 'hard'),
    q: 'Q' + (i + 1),
    correct: 'A' + i,
    wrong: ['B' + i, 'C' + i, 'D' + i],
    exp: 'E' + (i + 1),
    subject: '數學'
  }));
  const normalized = api.normalizeResult({
    name: '星軌算境', level: '國中二年級', difficulty: '中等', subject: '數學',
    knowledgePoints: ['比例', '一次函數'], questions
  }, '國中一年級');
  assert.equal(normalized.level, '國中二年級');
  assert.equal(normalized.difficulty, 'medium');
  assert.equal(normalized.questions.length, 10);
  assert.equal(normalized.questions[0].id, 'DT-001');
  assert.equal(normalized.questions[9].id, 'DT-010');
  assert.deepEqual(Object.keys(normalized.questions[0]), ['id','difficulty','q','correct','wrong','exp','subject']);
});

test('Dongtian first plans question count and fixed single-choice structure with a ten-question minimum', () => {
  const prompt = api.buildPlanningPrompt('notes', '國中三年級', 3);
  assert.match(prompt, /只做「題量與題目結構規劃」/);
  assert.match(prompt, /至少 10 題/);
  assert.match(prompt, /10、15、20、25、30/);
  assert.match(prompt, /四選一單選題/);
  assert.match(prompt, /禁止複選題、多選題、複數正解/);
  assert.equal(api.normalizePlannedQuestionCount(3), 10);
  assert.equal(api.normalizePlannedQuestionCount(12), 15);
  assert.equal(api.normalizePlannedQuestionCount(30), 30);
});

test('Dongtian generates exactly five questions per batch and carries all previous questions into the next prompt', () => {
  const plan = api.normalizeDongtianPlan({
    name:'星軌算境', level:'國中三年級', difficulty:'medium', subject:'數學',
    knowledgePoints:['比例','函數'], questionCount:10,
    questionBlueprints:Array.from({length:10},(_,i)=>({focus:'重點'+i,skill:'理解',difficulty:'medium',subject:'數學'}))
  }, '國中三年級');
  const previous = Array.from({length:5},(_,i)=>({
    id:'DT-00'+(i+1), difficulty:'medium', q:'已生成題目'+(i+1),
    correct:'A'+i, wrong:['B'+i,'C'+i,'D'+i], exp:'解析'+i, subject:'數學'
  }));
  const prompt = api.buildQuestionBatchPrompt('notes','國中三年級',0,plan,previous,5,5);
  assert.match(prompt, /第 6～10 題，共恰好 5 題/);
  assert.match(prompt, /每次固定生成 5 題/);
  assert.match(prompt, /先前已生成的全部題目/);
  assert.match(prompt, /已生成題目1/);
  assert.match(prompt, /已生成題目5/);
  assert.match(prompt, /不可複選/);
});

test('Dongtian batch normalization rejects multi-select and requires one correct plus three unique wrong choices', () => {
  const plan = api.normalizeDongtianPlan({ questionCount:10, subject:'數學' }, '國中一年級');
  const raw = { questions: Array.from({length:5},(_,i)=>({
    q:'新題'+i, correct:'A'+i, wrong:['B'+i,'C'+i,'D'+i], exp:'E'+i, subject:'數學'
  })) };
  const normalized = api.normalizeQuestionBatch(raw, plan, [], 0, 5);
  assert.equal(normalized.length, 5);
  assert.equal(typeof normalized[0].correct, 'string');
  assert.equal(normalized[0].wrong.length, 3);
  assert.throws(() => api.normalizeQuestionBatch({
    questions: Array.from({length:5},(_,i)=>({
      q:'複選'+i, correct:['A','B'], wrong:['C','D','E'], exp:'E'
    }))
  }, plan, [], 0, 5));
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

test('Dongtian first completion always grants the player 1000 gold while owner reward remains once per unique player', () => {
  assert.match(uiSource, /FIRST_COMPLETION_GOLD_REWARD = 1000/);
  assert.match(uiSource, /if \(!alreadyCompleted\)/);
  assert.match(uiSource, /'stats\.gold': increment\(FIRST_COMPLETION_GOLD_REWARD\)/);
  assert.match(uiSource, /source: 'dongtian-first-completion'/);
  assert.match(uiSource, /固定獲得 \+\$\{FIRST_COMPLETION_GOLD_REWARD\.toLocaleString\(\)\} 靈石/);
  assert.match(uiSource, /OWNER_CULTIVATION_REWARD = 1/);
  assert.match(uiSource, /OWNER_GOLD_REWARD = 5/);
  assert.match(uiSource, /'stats\.totalScore': increment\(OWNER_CULTIVATION_REWARD\)/);
  assert.match(uiSource, /'stats\.gold': increment\(OWNER_GOLD_REWARD\)/);
  assert.doesNotMatch(uiSource, /獎勵內容目前待開放/);
  assert.match(uiSource, /玩家首次完整通關固定 \+\$\{FIRST_COMPLETION_GOLD_REWARD\.toLocaleString\(\)\} 靈石/);
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


test('Question report only appears after answering, so it cannot reveal the answer early', () => {
  const runner = uiSource.slice(uiSource.indexOf('function renderRunner'), uiSource.indexOf('function answerDongtian'));
  const answer = uiSource.slice(uiSource.indexOf('function answerDongtian'), uiSource.indexOf('function removeModerationModal'));
  assert.doesNotMatch(runner, /dt-report-question/);
  assert.match(answer, /dt-report-question/);
  assert.match(answer, /document\.getElementById\('dt-report-question'\)\.onclick = openQuestionReport/);
});

test('Completion reward transaction rechecks active status to prevent seal/reward races', () => {
  const completion = uiSource.slice(uiSource.indexOf('async function completeProgress'), uiSource.indexOf('async function writeDongtianHistory'));
  assert.match(completion, /const \[playSnap, indexSnap\] = await Promise\.all/);
  assert.match(completion, /indexSnap\.data\(\)\?\.status !== 'active'/);
  assert.match(completion, /洞天已封印，本次不進行通關結算/);
});


test('Dongtian API endpoint performs planning before batched generation and audits prior-question context', () => {
  assert.match(apiSource, /const planningRun = await generateMultimodalJSON\(buildPlanningPrompt/);
  assert.match(apiSource, /startIndex < plan\.questionCount; startIndex \+= QUESTION_BATCH_SIZE/);
  assert.match(apiSource, /buildQuestionBatchPrompt\([\s\S]*generatedQuestions/);
  assert.match(apiSource, /generatedQuestions\.push\(\.\.\.batch\)/);
  assert.match(apiSource, /priorQuestionCountInPrompt: startIndex/);
  assert.match(apiSource, /QUESTION_BATCH_SIZE = 5/);
});

test('Dongtian creation UI describes planning first and five-question batch generation', () => {
  assert.match(uiSource, /先判斷需要的題數與固定單選結構，再每 5 題一批生成/);
  assert.match(uiSource, /先規劃題數，再每 5 題分批生成/);
});


test('Dongtian question amount presets constrain planning to low medium or high ranges', () => {
  assert.deepEqual(api.allowedQuestionCounts('low'), [10]);
  assert.deepEqual(api.allowedQuestionCounts('medium'), [15,20]);
  assert.deepEqual(api.allowedQuestionCounts('high'), [25,30]);
  assert.equal(api.normalizePlannedQuestionCount(13, 'low'), 10);
  assert.equal(api.normalizePlannedQuestionCount(13, 'medium'), 15);
  assert.equal(api.normalizePlannedQuestionCount(18, 'medium'), 20);
  assert.equal(api.normalizePlannedQuestionCount(24, 'high'), 25);
  assert.equal(api.normalizePlannedQuestionCount(29, 'high'), 30);
  assert.equal(api.normalizeQuestionAmount('unknown'), 'medium');

  const lowPrompt = api.buildPlanningPrompt('notes','國中一年級',0,'low');
  const mediumPrompt = api.buildPlanningPrompt('notes','國中一年級',0,'medium');
  const highPrompt = api.buildPlanningPrompt('notes','國中一年級',0,'high');
  assert.match(lowPrompt, /題量偏好是「少量」/);
  assert.match(lowPrompt, /只能從 10 中選擇/);
  assert.match(mediumPrompt, /只能從 15、20 中選擇/);
  assert.match(highPrompt, /只能從 25、30 中選擇/);
});

test('Dongtian creator UI offers low medium high question amounts and sends the choice to the API', () => {
  assert.match(uiSource, /name="dt-question-amount" value="low"/);
  assert.match(uiSource, /name="dt-question-amount" value="medium" checked/);
  assert.match(uiSource, /name="dt-question-amount" value="high"/);
  assert.match(uiSource, /少 <small>10 題<\/small>/);
  assert.match(uiSource, /中 <small>15～20 題<\/small>/);
  assert.match(uiSource, /多 <small>25～30 題<\/small>/);
  assert.match(uiSource, /questionAmount = document\.querySelector/);
  assert.match(uiSource, /JSON\.stringify\(\{ text, images, creatorLevel: level, questionAmount \}\)/);
});

test('Dongtian runner and question card fill the viewport instead of staying in a narrow centered column', () => {
  assert.match(uiSource, /\.dt-overlay\{[^}]*width:100vw;height:100dvh/);
  assert.match(uiSource, /\.dt-runner\{width:100vw;height:100dvh;max-width:none/);
  assert.match(uiSource, /grid-template-rows:auto auto auto minmax\(0,1fr\)/);
  assert.match(uiSource, /\.dt-question\{[^}]*height:100%[^}]*display:flex[^}]*overflow:auto/);
  assert.match(uiSource, /\.dt-options\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(uiSource, /@media\(max-width:700px\)[\s\S]*\.dt-options\{grid-template-columns:1fr/);
});
