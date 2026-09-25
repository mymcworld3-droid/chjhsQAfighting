const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = join(__dirname, '..');
const cacheSource = readFileSync(join(root, 'public/solo-question-cache.js'), 'utf8');
const legacy = readFileSync(join(root, 'public/main-legacy.js'), 'utf8');
const main = readFileSync(join(root, 'public/main.js'), 'utf8');
const index = readFileSync(join(root, 'public/index.html'), 'utf8');
const xianxia = readFileSync(join(root, 'public/xianxia.css'), 'utf8');
const server = readFileSync(join(root, 'server.js'), 'utf8');
const scope = (path = '數學/代數', level = '國中一年級') =>
  JSON.stringify({ mode: 'focused', path, level });
const makeQuiz = (q) => ({
  data: { q, opts: ['正解', '錯誤'], ans: 0, exp: '解析' },
  rank: '練氣', badge: '🎯 數學 | 代數'
});

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    dump() { return new Map(data); }
  };
}
function cacheAPI() {
  const context = { JSON, Number, Array, String, Object };
  vm.createContext(context);
  vm.runInContext(cacheSource.replaceAll('export const ', 'const ')
    .replaceAll('export function ', 'function ')
    + '\n;globalThis.__cache = { createSoloQuestionCache, SOLO_QUESTION_CACHE_KEY };', context);
  return context.__cache;
}

test('browser cache module and bootstrap pass module syntax checks', () => {
  for (const name of ['solo-question-cache.js', 'main-legacy.js', 'main.js']) {
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
      input: readFileSync(join(root, 'public', name), 'utf8'), encoding: 'utf8'
    });
    assert.equal(result.status, 0, name + ': ' + result.stderr);
  }
});

test('active and all unanswered prefetched questions survive reload in the same account/range', () => {
  const { createSoloQuestionCache } = cacheAPI();
  const localStorage = createMemoryStorage();
  const first = createSoloQuestionCache(localStorage);
  assert.equal(first.activate('uid-1', scope()), true);
  first.append(makeQuiz('第 1 題'));
  first.append(makeQuiz('第 2 題'));
  first.append(makeQuiz('第 3 題'));
  assert.equal(first.takeNext().data.q, '第 1 題');
  assert.equal(first.pendingCount(), 3);
  const refreshed = createSoloQuestionCache(localStorage);
  refreshed.activate('uid-1', scope());
  assert.equal(refreshed.getActive().data.q, '第 1 題');
  assert.deepEqual(Array.from(refreshed.getQueue(), q => q.data.q), ['第 2 題', '第 3 題']);
  refreshed.consumeActive();
  assert.equal(refreshed.takeNext().data.q, '第 2 題');
  const refreshedAgain = createSoloQuestionCache(localStorage);
  refreshedAgain.activate('uid-1', scope());
  assert.equal(refreshedAgain.getActive().data.q, '第 2 題');
  assert.equal(refreshedAgain.getQueue().length, 1);
});

test('changing account or learning range discards prior local questions even after switching back', () => {
  const { createSoloQuestionCache } = cacheAPI();
  const storage = createMemoryStorage();
  const cache = createSoloQuestionCache(storage);
  cache.activate('user-A', scope());
  cache.append(makeQuiz('A 原範圍'));
  cache.activate('user-A', scope('數學/幾何'));
  assert.equal(cache.pendingCount(), 0);
  cache.append(makeQuiz('A 幾何'));
  cache.activate('user-B', scope('數學/幾何'));
  assert.equal(cache.pendingCount(), 0);
  cache.append(makeQuiz('B 幾何'));
  const afterReload = createSoloQuestionCache(storage);
  afterReload.activate('user-A', scope('數學/幾何'));
  assert.equal(afterReload.pendingCount(), 0);
});

test('invalid persisted records are ignored and storage-disabled browser remains usable', () => {
  const { createSoloQuestionCache, SOLO_QUESTION_CACHE_KEY } = cacheAPI();
  const storage = createMemoryStorage();
  storage.setItem(SOLO_QUESTION_CACHE_KEY, '{broken-json');
  const cache = createSoloQuestionCache(storage);
  cache.activate('uid', scope());
  assert.equal(cache.pendingCount(), 0);
  assert.equal(cache.append(makeQuiz('可恢復')), true);
  assert.equal(cache.isPersistent(), true);
  const blocked = createSoloQuestionCache({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  });
  blocked.activate('uid', scope());
  assert.equal(blocked.append(makeQuiz('僅本次會話')), true);
  assert.equal(blocked.isPersistent(), false);
});

test('seen-question history survives reload and blocks exact or long structural repeats', () => {
  const { createSoloQuestionCache } = cacheAPI();
  const storage = createMemoryStorage();
  const first = createSoloQuestionCache(storage);
  first.activate('uid-history', scope());

  const original = makeQuiz('小明買了 12 顆蘋果，平均分給 3 個人，每人可以分到幾顆？');
  original.meta = { concept_id: 'division', template_id: 'equal-share', question_form: 'scenario-modeling' };
  first.append(original);
  first.takeNext();
  first.consumeActive({ remember: true });

  assert.equal(first.getHistory().length, 1);
  assert.equal(first.getHistory()[0].template_id, 'equal-share');

  const refreshed = createSoloQuestionCache(storage);
  refreshed.activate('uid-history', scope());
  assert.equal(refreshed.getHistory().length, 1);
  assert.equal(refreshed.append(makeQuiz('小華買了 20 顆蘋果，平均分給 5 個人，每人可以分到幾顆？')), false);
  assert.equal(refreshed.append(makeQuiz('下列哪一個圖形具有四條等長的邊？')), true);
});

test('solo quiz uses restored active question before hitting the API and saves each prefetched result', () => {
  assert.match(legacy, /let nextQ = soloQuestionCache.getActive\(\) \|\| soloQuestionCache.takeNext\(\)/);
  assert.match(legacy, /const BUFFER_SIZE = 1;/);
  assert.match(legacy, /if \(!nextQ && isFetchingBuffer\)/);
  assert.match(legacy, /if \(isFetchingBuffer\) return bufferFillPromise/);
  assert.match(legacy, /soloQuestionCache.append\(question\)/);
  assert.match(legacy, /soloQuestionCache.setActive\(q\)/);
  assert.match(legacy, /soloQuestionCache\.consumeActive\(\{ remember: true \}\)/);
  assert.match(legacy, /recentSoloQuestionContext\(\)/);
  assert.match(legacy, /avoidQuestionMeta/);
  assert.match(legacy, /pickBankQuestionWithoutReplacement/);
  assert.match(legacy, /soloQuestionScope\(\) !== scope/);
  assert.match(legacy, /auth.currentUser\?\.uid !== uid/);
  assert.match(legacy, /const identity = JSON.stringify\(\[uid, scope\]\)/);
  assert.match(legacy, /source: mode === 'bank'/);
  assert.match(legacy, /topics: Array.isArray\(unit\?\.sub_topics\)/);
  assert.match(legacy, /data\?\.q === quiz\.data\?\.q/);
});

test('quiz exposes a responsive mouse and touch calculation whiteboard', () => {
  assert.match(index, /id="btn-quiz-whiteboard"/);
  assert.match(index, /id="quiz-whiteboard-panel"/);
  assert.match(index, /role="dialog"/);
  assert.match(index, /aria-modal="true"/);
  assert.match(index, /class="quiz-whiteboard-backdrop"/);
  assert.match(index, /id="quiz-whiteboard-question"/);
  assert.match(index, /id="quiz-whiteboard-canvas"/);
  assert.match(index, /onclick="clearQuizWhiteboard\(\)"/);
  assert.match(legacy, /window\.toggleQuizWhiteboard =/);
  assert.match(legacy, /window\.clearQuizWhiteboard =/);
  assert.match(legacy, /canvas\.addEventListener\('pointerdown'/);
  assert.match(legacy, /resetQuizWhiteboard\(\{ close: true \}\)/);
  assert.match(xianxia, /#quiz-whiteboard-canvas/);
  assert.match(xianxia, /height:\s*100dvh/);
  assert.match(xianxia, /\.quiz-whiteboard-question-wrap/);
  assert.match(xianxia, /max-height:\s*20dvh/);
  assert.match(xianxia, /quiz-whiteboard-question-wrap::before/);
  assert.match(xianxia, /quiz-whiteboard-question-wrap::after/);
  assert.match(xianxia, /touch-action:\s*none/);
});


test('quiz question includes contextual helper chat with responsive collapse', () => {
  assert.match(index, /id="quiz-helper-shell"/);
  assert.match(index, /id="quiz-helper-messages"/);
  assert.match(index, /id="quiz-helper-input"/);
  assert.match(index, /onsubmit="submitQuizHelper\(event\)"/);
  assert.match(legacy, /window\.toggleQuizHelper =/);
  assert.match(legacy, /window\.submitQuizHelper =/);
  assert.match(legacy, /fetch\('\/api\/question-helper'/);
  assert.match(legacy, /\(max-width: 1099px\)/);
  assert.match(index, /class="quiz-question-helper-layout"/);
  assert.match(index, /class="quiz-main-column"/);
  assert.match(index, /class="quiz-main-column"[\s\S]*id="options-container"[\s\S]*id="feedback-section"/);
  assert.match(legacy, /classList\.toggle\('helper-collapsed', !open\)/);
  assert.match(legacy, /const hadPreviousQuestion = !!quizHelperState\.question/);
  assert.match(legacy, /const wasOpen = shell \? !shell\.classList\.contains\('collapsed'\) : false/);
  assert.match(legacy, /setQuizHelperOpen\(hadPreviousQuestion \? wasOpen : defaultOpen, \{ remember: false \}\)/);
  assert.match(xianxia, /\.quiz-question-helper-layout\.helper-collapsed/);
  assert.match(xianxia, /\.quiz-helper-shell\.collapsed/);
  assert.match(xianxia, /@media \(min-width: 1100px\)/);
  assert.match(xianxia, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(xianxia, /@media \(max-width: 1099px\)/);
  assert.match(xianxia, /width:\s*100vw/);
  assert.match(xianxia, /height:\s*100dvh/);
  assert.match(legacy, /quiz-helper-fullscreen-open/);
  assert.match(server, /app\.post\('\/api\/question-helper'/);
  assert.match(server, /尚未作答/);
});


test('helper replies expose knowledge-point extended practice', () => {
  assert.match(index, /id="btn-extended-practice-stop"/);
  assert.match(legacy, /quiz-helper-practice-btn/);
  assert.match(legacy, /window\.startQuizExtendedPractice = async/);
  assert.match(legacy, /async function fetchExtendedPracticeQuestion\(\)/);
  assert.match(legacy, /specificTopic: knowledgePoint/);
  assert.match(legacy, /extendedPracticeState\.active/);
  assert.match(legacy, /window\.endQuizExtendedPractice =/);
  assert.match(xianxia, /\.quiz-helper-practice-btn/);
  assert.match(xianxia, /\.quiz-extended-practice-stop/);
  assert.match(server, /knowledgePoint/);
  assert.match(server, /最適合延伸練習的核心知識點/);
});


test('core import and page query change together to refresh browser cached code', () => {
  assert.match(main, /main-legacy\.js\?v=20260925-helper-state1/);
  assert.match(index, /main\.js\?v=20260925-helper-state1/);
  assert.match(index, /xianxia\.css\?v=20260925-helper-state1/);
});
