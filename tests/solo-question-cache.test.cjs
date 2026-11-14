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

test('corrections retain origin and priority after reload without replacing an unfinished ordinary question', () => {
  const { createSoloQuestionCache } = cacheAPI();
  const storage = createMemoryStorage();
  const cache = createSoloQuestionCache(storage);
  cache.activate('uid-correction', scope());
  cache.setActive(makeQuiz('目前待答'));
  cache.append(makeQuiz('一般甲'));
  cache.append(makeQuiz('一般乙'));
  cache.append({ ...makeQuiz('訂正甲'), recoveryOrigin: '錯題甲', badge: '📝 訂正練習 | 數學' });
  cache.append({ ...makeQuiz('訂正乙'), recoveryOrigin: '錯題乙', badge: '📝 訂正練習 | 數學' });
  assert.deepEqual(Array.from(cache.getQueue(), q => q.data.q), ['一般甲', '一般乙', '訂正甲', '訂正乙']);
  const refreshed = createSoloQuestionCache(storage);
  refreshed.activate('uid-correction', scope());
  assert.equal(refreshed.takeNext().data.q, '目前待答');
  refreshed.consumeActive();
  assert.equal(refreshed.takeNext().recoveryOrigin, '錯題甲');
  refreshed.consumeActive();
  assert.equal(refreshed.takeNext().recoveryOrigin, '錯題乙');
  refreshed.consumeActive();
  assert.equal(refreshed.takeNext().data.q, '一般甲');
  refreshed.consumeActive();
  assert.equal(refreshed.takeNext().data.q, '一般乙');
});

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
  assert.match(legacy, /const takeNext = \(\) => soloQuestionCache.takeNext\(/);
  assert.match(legacy, /const BUFFER_SIZE = 5;/);
  assert.match(legacy, /if \(!quiz && isFetchingBuffer\)/);
  assert.match(legacy, /if \(isFetchingBuffer\) return firstReady \? bufferNextQuestionPromise : bufferFillPromise/);
  assert.match(legacy, /soloQuestionCache.append\(question\)/);
  assert.match(legacy, /soloQuestionCache.setActive\(generated\)/);
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
  assert.match(xianxia, /\.quiz-helper-shell:not\(\.collapsed\)[\s\S]*position:\s*fixed/);
  assert.match(xianxia, /right:\s*max\(16px, calc\(\(100vw - 1220px\) \/ 2 \+ 16px\)\)/);
  assert.match(xianxia, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(xianxia, /@media \(max-width: 1099px\)/);
  assert.match(xianxia, /width:\s*100vw/);
  assert.match(xianxia, /height:\s*100dvh/);
  assert.match(legacy, /quiz-helper-fullscreen-open/);
  assert.match(legacy, /function quizHelperAppendThinking\(\)/);
  assert.match(legacy, /quiz-helper-thinking-bubble/);
  assert.match(legacy, /requestId !== quizHelperState\.requestSerial/);
  assert.match(xianxia, /@keyframes quiz-helper-thinking-dot/);
  assert.match(xianxia, /quiz-helper-thinking-bubble span:nth-child\(3\)/);
  assert.match(server, /app\.post\('\/api\/question-helper'/);
  assert.match(server, /尚未作答/);
});


test('helper replies expose knowledge-point extended practice', () => {
  assert.match(index, /id="btn-extended-practice-stop"/);
  assert.match(legacy, /quiz-helper-practice-btn/);
  assert.match(legacy, /window\.startQuizExtendedPractice = async/);
  assert.match(legacy, /async function fetchExtendedPracticeQuestion\(practice = extendedPracticeState\)/);
  assert.match(legacy, /specificTopic: knowledgePoint/);
  assert.match(legacy, /extendedPracticeState\.active/);
  assert.match(legacy, /window\.endQuizExtendedPractice =/);
  assert.match(xianxia, /\.quiz-helper-practice-btn/);
  assert.match(xianxia, /\.quiz-extended-practice-stop/);
  assert.match(server, /knowledgePoint/);
  assert.match(server, /最適合延伸練習的核心知識點/);
});


test('core import and page query change together to refresh browser cached code', () => {
  const coreVersion = main.match(/main-legacy\.js\?v=([^']+)/)?.[1];
  assert.ok(coreVersion);
  assert.equal(index.match(/src="main\.js\?v=([^"]+)"/)?.[1], coreVersion);
});

test('assistance on the exact active question survives reload and cannot replace an unanswered question',()=>{
  const {createSoloQuestionCache}=cacheAPI(),storage=createMemoryStorage(),cache=createSoloQuestionCache(storage);
  cache.activate('uid-help',scope());const quiz=makeQuiz('待答且已使用提示的題目');quiz.adaptive={questionId:'help-question'};
  cache.setActive(quiz);quiz.adaptiveHelp=2;quiz.adaptiveLessonHelp=true;
  assert.equal(cache.persistActive(quiz),true);assert.equal(cache.persistActive({...quiz,data:{...quiz.data,q:'另一題'}}),false);
  const reloaded=createSoloQuestionCache(storage);reloaded.activate('uid-help',scope());
  assert.equal(reloaded.getActive().adaptiveHelp,2);assert.equal(reloaded.getActive().adaptiveLessonHelp,true);assert.equal(reloaded.getActive().data.q,quiz.data.q);
  cache.consumeActive();assert.equal(cache.persistActive(quiz),false);
});

test('a ready challenge can move ahead of ordinary stock while active and correction questions keep priority',()=>{
  const {createSoloQuestionCache}=cacheAPI();
  const cache=createSoloQuestionCache(createMemoryStorage());
  cache.activate('player',scope());
  const active=makeQuiz('目前答題'),normal=makeQuiz('先準備的一般題');
  const challenge={...makeQuiz('新生成的進階題'),adaptive:{role:'challenge'}};
  const correction={...makeQuiz('需要訂正的練習'),recoveryOrigin:'已做錯的題'};
  cache.setActive(active);
  for(const quiz of [normal,challenge,correction])assert(cache.append(quiz));
  const draw=()=>cache.takeNext(quiz=>quiz.adaptive?.role==='challenge');
  for(const expected of [active,correction,challenge,normal]){
    assert.equal(draw(),expected);
    cache.consumeActive();
  }
});

test('upgrading the diagnostic policy replaces queued legacy easy diagnostics and retains the active question',()=>{
  const {createSoloQuestionCache}=cacheAPI();
  const cache=createSoloQuestionCache(createMemoryStorage());
  cache.activate('player',scope());
  const easy={role:'diagnostic',difficulty:'easy'};
  const active={...makeQuiz('正在回答的診斷'),adaptive:easy};
  const old={...makeQuiz('舊版簡單診斷'),adaptive:easy};
  const newQuiz={...makeQuiz('新版觀念練習'),adaptive:{...easy,policyVersion:2}};
  const correction={...makeQuiz('需要訂正的原題'),adaptive:easy,recoveryOrigin:'原題'};
  cache.setActive(active);
  for(const quiz of [old,newQuiz,correction])assert(cache.append(quiz));
  cache.discardLegacyDiagnostics(2);
  assert.equal(cache.takeNext(),active);
  assert.deepEqual(Array.from(cache.getQueue()),[newQuiz,correction]);
});

test('the shared refill reserves a challenge even when five ordinary questions are already ready',async()=>{
  const Rules=require('../public/cultivation/adaptive-learning-rules.js');
  const unit={path:'數學/八下/單元',detail:'幾何',sub_topics:[]};
  const scopeId='1'.repeat(24),conceptId='c_'+'2'.repeat(16);
  const stats={adaptiveLearningV1:{scopes:{[scopeId]:{recent:Array.from({length:2},()=>({
    conceptId,role:'diagnostic',difficulty:'medium',correct:true,help:0
  }))}}}};
  const {createSoloQuestionCache}=cacheAPI();
  const cache=createSoloQuestionCache(createMemoryStorage());
  cache.activate('player','range');
  for(const stem of ['三角形','正方形','圓形','角度','面積'])assert(cache.append(makeQuiz(stem)));
  const challenge={...makeQuiz('跨圖形推理'),adaptive:{scopeId,conceptId,scope:unit,role:'challenge',difficulty:'hard'}};
  const calls=[];
  const sandbox={
    auth:{currentUser:{uid:'player'}},currentUserData:{stats,gameSettings:{sourceMode:'focused',focusedUnits:[unit]}},
    window:{QAAdaptiveLearningRules:Rules},soloQuestionCache:cache,adaptiveSoloUnits:new Map([[scopeId,unit]]),
    syncSoloQuestionCache:()=> 'range',soloQuestionScope:()=> 'range',soloDraws:new WeakMap(),console,
    fetchOneQuestion:async target=>{calls.push(target);return challenge;}
  };
  vm.createContext(sandbox);
  vm.runInContext(`let isFetchingBuffer=false, bufferNextQuestionPromise=null, bufferFillPromise=null;
    let quizBuffer=[], soloCacheRevision=1;
    const BUFFER_SIZE=5;
    ${legacy.slice(legacy.indexOf('function pendingSoloChallenge('),legacy.indexOf('window.QASoloQuestionQueue ='))}
    globalThis.flow={fillBuffer,takeSoloQuestion};
  `,sandbox);
  await sandbox.flow.fillBuffer();
  assert.deepEqual(calls,[unit]);
  assert.equal(cache.pendingCount(),6);
  assert.equal(await sandbox.flow.takeSoloQuestion(),challenge);
  assert.equal(calls.length,1);
});
