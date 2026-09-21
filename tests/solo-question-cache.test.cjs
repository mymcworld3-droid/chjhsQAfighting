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

test('solo quiz uses restored active question before hitting the API and saves each prefetched result', () => {
  assert.match(legacy, /let nextQ = soloQuestionCache.getActive\(\) \|\| soloQuestionCache.takeNext\(\)/);
  assert.match(legacy, /const BUFFER_SIZE = 1;/);
  assert.match(legacy, /if \(!nextQ && isFetchingBuffer\)/);
  assert.match(legacy, /if \(isFetchingBuffer\) return bufferFillPromise/);
  assert.match(legacy, /soloQuestionCache.append\(question\)/);
  assert.match(legacy, /soloQuestionCache.setActive\(q\)/);
  assert.match(legacy, /soloQuestionCache.consumeActive\(\)/);
  assert.match(legacy, /soloQuestionScope\(\) !== scope/);
  assert.match(legacy, /auth.currentUser\?\.uid !== uid/);
  assert.match(legacy, /const identity = JSON.stringify\(\[uid, scope\]\)/);
  assert.match(legacy, /source: mode === 'bank'/);
  assert.match(legacy, /topics: Array.isArray\(unit\?\.sub_topics\)/);
  assert.match(legacy, /data\?\.q === quiz\.data\?\.q/);
});

test('core import and page query change together to refresh browser cached code', () => {
  assert.match(main, /main-legacy\.js\?v=20260921-solo-cache1/);
  assert.match(index, /main\.js\?v=20260921-recipe-expand2/);
});
