const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', 'public', file), 'utf8');
const main = read('main-legacy.js');
function section(start, end) {
    const a = main.indexOf(start), b = main.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return main.slice(a, b);
}
function element() {
    const classes = new Set(['hidden']);
    const label = { textContent: '' };
    return {
        dataset: {}, disabled: false, isConnected: true, textContent: '', innerText: '', title: '',
        querySelector: () => label, label,
        classList: {
            add: name => classes.add(name), remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
        }
    };
}
function setup() {
    const nodes = new Map();
    const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
    const buttons = ['功與動能', '角動量'].map(point => Object.assign(element(), { dataset: { knowledgePoint: point } }));
    const generated = [], renders = [], toasts = [];
    const answered = new WeakSet();
    const auth = { currentUser: { uid: 'u1' } };
    let scope = '原本範圍', rollCount = 0, failGeneration = false;
    const normal = { data: { q: '目前題目', opts: ['A', 'B'], ans: 0, exp: '本題解析' }, rank: '練氣', badge: '物理' };
    const buffered = { data: { q: '原本預載的下一題', opts: ['A', 'B'], ans: 0 }, rank: '練氣', badge: '物理' };
    const w = {
        currentActiveQuiz: normal,
        isOpportunityActive: () => false,
        maybeEncounterOpportunity: async () => { rollCount++; return false; },
        showToast: text => toasts.push(text)
    };
    const context = vm.createContext({
        window: w, auth, answeredSoloQuizzes: answered,
        document: { getElementById: get, querySelectorAll: () => buttons },
        currentUserData: { stats: { rankLevel: 0 }, gameSettings: { difficulty: 'auto' }, profile: { educationLevel: '高中二年級' } },
        currentLang: 'zh-TW',
        quizHelperState: { subject: '物理', question: normal.data.q },
        soloQuestionScope: () => scope,
        syncSoloQuestionCache: () => scope,
        switchToPage() {}, fillBuffer() {}, t: key => key, alert() {},
        fetchOneQuestion: async () => { throw Error('Should use the original prefetched question'); },
        renderQuiz: (data, rank, badge) => renders.push({ data, rank, badge }),
        getRankName: () => '練氣', getSmartDifficulty: () => '中等',
        shuffleArray: items => items, quizMetaFromRaw: () => ({}), recentSoloQuestionContext: () => ({}),
        fetch: async (url, init) => {
            assert.equal(url, '/api/generate-quiz');
            const body = JSON.parse(init.body);
            generated.push(body);
            if (failGeneration) throw Error('generation failed');
            return { ok: true, json: async () => ({ text: JSON.stringify({ q: `${body.specificTopic}延伸題 ${generated.length}`, correct: 'A', wrong: ['B'], exp: '延伸解析' }) }) };
        },
        console: { error() {}, warn() {} }
    });
    const storage = new Map();
    context.storage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    vm.runInContext(read('solo-question-cache.js').replace(/^export /gm, '') + '\n globalThis.cache = createSoloQuestionCache(storage);', context);
    context.cache.activate('u1', scope);
    context.cache.setActive(normal);
    context.cache.append(buffered);
    context.soloQuestionCache = context.cache;
    vm.runInContext('let soloQuizOpenSerial = 0, soloCacheRevision = 0, quizBuffer = [], isFetchingBuffer = false; const soloSession = { active:true, mode:"infinite", correctCount:0, wrongCount:0 };'
        + section('const extendedPracticeState =', 'const quizHelperState =')
        + section('let soloNextBusy = false;', 'async function handleAnswer(')
        + section('async function fetchExtendedPracticeQuestion(', 'const quizWhiteboardState =')
        + section('window.startQuizFlow =', '// 🆕 單人模式選擇與啟動邏輯')
        + '\n globalThis.extension = extendedPracticeState;', context);
    return {
        w, context, auth, buttons, generated, renders, toasts, get, normal, buffered,
        cache: context.cache, state: context.extension,
        get rolls() { return rollCount; },
        setScope(value) { scope = value; },
        failGeneration() { failGeneration = true; },
        complete() { answered.add(w.currentActiveQuiz); context.cache.consumeActive({ remember: true }); }
    };
}

test('selecting an extension before answering keeps the current question, cache and prefetched queue intact', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    assert.equal(h.w.currentActiveQuiz, h.normal);
    assert.equal(h.cache.getActive().data.q, h.normal.data.q);
    assert.equal(h.cache.getQueue()[0].data.q, h.buffered.data.q);
    assert.equal(h.cache.getHistory().length, 0);
    assert.equal(h.state.active, false);
    assert.equal(h.state.pending.knowledgePoint, '功與動能');
    assert.equal(h.generated.length, 0);
    assert.equal(h.renders.length, 0);
    await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz, h.normal);
    assert.equal(h.state.pending.knowledgePoint, '功與動能');
    assert.equal(h.generated.length, 0, 'unanswered next cannot start generation');
    assert.match(h.toasts.at(-1), /完成本題後/);
});

test('after completion the selected extension becomes the next question before random encounters or cached questions', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    h.complete();
    await h.w.nextQuestion();
    assert.equal(h.generated.length, 1);
    assert.equal(h.generated[0].specificTopic, '功與動能');
    assert.equal(h.generated[0].subject, '物理');
    assert.equal(h.w.currentActiveQuiz.extendedPractice, true);
    assert.equal(h.w.currentActiveQuiz.data.q, '功與動能延伸題 1');
    assert.equal(h.state.pending, null);
    assert.equal(h.state.active, true);
    assert.equal(h.rolls, 0);
    assert.equal(h.cache.getQueue()[0].data.q, h.buffered.data.q, 'the original queue is not discarded');
});

test('selecting after answering still preserves the feedback until the player presses next', async () => {
    const h = setup();
    h.complete();
    await h.w.startQuizExtendedPractice('角動量');
    assert.equal(h.w.currentActiveQuiz, h.normal);
    assert.equal(h.generated.length, 0);
    assert.equal(h.renders.length, 0);
    assert.match(h.toasts.at(-1), /按「下一題」/);
    await h.w.nextQuestion();
    assert.equal(h.generated[0].specificTopic, '角動量');
});

test('repeat selection does not duplicate pending work and changing the point updates the single next slot', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    const pending = h.state.pending;
    await h.w.startQuizExtendedPractice('功與動能');
    assert.equal(h.state.pending, pending);
    assert.equal(h.toasts.length, 1);
    assert.equal(h.buttons[0].disabled, true);
    assert.equal(h.buttons[0].label.textContent, '已排入下一題');
    await h.w.startQuizExtendedPractice('角動量');
    assert.equal(h.state.pending.knowledgePoint, '角動量');
    assert.equal(h.buttons[0].disabled, false);
    assert.equal(h.buttons[1].disabled, true);
    h.complete();
    await h.w.nextQuestion();
    assert.equal(h.generated.length, 1);
    assert.equal(h.generated[0].specificTopic, '角動量');
});

test('cancelling pending practice retains the unanswered question and restores normal next-question flow', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    assert.equal(h.get('btn-extended-practice-stop').classList.contains('hidden'), false);
    h.w.endQuizExtendedPractice();
    assert.equal(h.state.pending, null);
    assert.equal(h.state.active, false);
    assert.equal(h.buttons[0].disabled, false);
    assert.equal(h.w.currentActiveQuiz, h.normal);
    assert.equal(h.cache.getHistory().length, 0);
    assert.match(h.toasts.at(-1), /已取消/);
    h.complete();
    await h.w.nextQuestion();
    assert.equal(h.generated.length, 0);
    assert.equal(h.rolls, 1);
    assert.equal(h.w.currentActiveQuiz.data.q, h.buffered.data.q);
});

test('reopening the quiz while practice is queued resumes the original unanswered question', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    await h.w.startQuizFlow();
    assert.equal(h.generated.length, 0);
    assert.equal(h.w.currentActiveQuiz.data.q, h.normal.data.q);
    assert.equal(h.renders[0].data.q, h.normal.data.q);
    assert.equal(h.state.pending.knowledgePoint, '功與動能');
});

test('changing extension topics waits for the current extension and reopening it never skips the unfinished question', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    h.complete(); await h.w.nextQuestion();
    const extension = h.w.currentActiveQuiz;
    await h.w.startQuizExtendedPractice('角動量');
    assert.equal(h.state.knowledgePoint, '功與動能');
    assert.equal(h.generated.length, 1);
    await h.w.startQuizFlow();
    assert.equal(h.w.currentActiveQuiz, extension);
    assert.equal(h.generated.length, 1);
    h.complete(); await h.w.nextQuestion();
    assert.equal(h.generated[1].specificTopic, '角動量');
});

test('ending active practice also cancels its pending topic, but keeps the current extension until answered', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    h.complete(); await h.w.nextQuestion();
    const extension = h.w.currentActiveQuiz;
    await h.w.startQuizExtendedPractice('角動量');
    h.w.endQuizExtendedPractice();
    assert.equal(h.state.pending, null);
    assert.equal(h.state.active, false);
    await h.w.startQuizFlow();
    assert.equal(h.w.currentActiveQuiz, extension);
    assert.equal(h.generated.length, 1);
    h.complete(); await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz.data.q, h.buffered.data.q);
});

test('pending topics cannot cross accounts, curriculum changes or unrelated source questions', async () => {
    for (const change of ['account', 'scope', 'question']) {
        const h = setup();
        await h.w.startQuizExtendedPractice('功與動能');
        if (change === 'account') h.auth.currentUser = { uid: 'u2' };
        if (change === 'scope') h.setScope('另一範圍');
        if (change === 'question') h.w.currentActiveQuiz = { data: { q: '另一題' } };
        h.complete(); await h.w.nextQuestion();
        assert.equal(h.generated.length, 0, change);
        assert.equal(h.state.pending, null, change);
        assert.equal(h.state.active, false, change);
    }
});

test('extension generation failure falls back to the original prefetched question', async () => {
    const h = setup();
    await h.w.startQuizExtendedPractice('功與動能');
    h.complete(); h.failGeneration(); await h.w.nextQuestion();
    assert.equal(h.state.active, false);
    assert.equal(h.state.pending, null);
    assert.equal(h.w.currentActiveQuiz.data.q, h.buffered.data.q);
    assert.match(h.toasts.at(-1), /出題失敗/);
});

test('rapid next clicks and extension clicks during generation start only one next question', async () => {
    const h = setup();
    let resolve;
    const fetch = h.context.fetch;
    h.context.fetch = async (...args) => { await new Promise(r => { resolve = r; }); return fetch(...args); };
    await h.w.startQuizExtendedPractice('功與動能'); h.complete();
    const pending = h.w.nextQuestion();
    await h.w.nextQuestion();
    await h.w.startQuizExtendedPractice('角動量');
    assert.equal(h.state.pending, null);
    resolve(); await pending;
    assert.equal(h.generated.length, 1);
    assert.equal(h.generated[0].specificTopic, '功與動能');
});

test('ready correction appends behind the buffer but is selected next without discarding normal questions', async () => {
    const h = setup(); h.complete();
    await h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.equal(h.w.currentActiveQuiz, h.normal, 'completion never replaces the current feedback');
    assert.equal(h.state.active, false);
    assert.equal(h.cache.getQueue()[0].data.q, h.buffered.data.q);
    const correction = h.cache.getQueue()[1];
    assert.equal(correction.recoveryOrigin, h.normal.data.q);
    assert.equal(correction.extendedPractice, false, 'one correction does not enter endless extension mode');
    assert.match(correction.badge, /訂正練習/);
    assert.match(h.get('solo-correction-practice').textContent, /已就緒/);
    await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz, correction);
    assert.equal(h.rolls, 0, 'a ready correction takes precedence over random encounters');
    assert.equal(h.cache.getQueue()[0].data.q, h.buffered.data.q);
    h.complete(); await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz.data.q, h.buffered.data.q);
    assert.equal(h.generated.length, 1);
});

test('unfinished correction lets the player continue, then takes priority after the current normal question', async () => {
    const h = setup(); h.complete();
    let release;
    const fetch = h.context.fetch;
    h.context.fetch = async (...args) => { await new Promise(r => { release = r; }); return fetch(...args); };
    const generating = h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.match(h.get('solo-correction-practice').textContent, /生成中/);
    await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz.data.q, h.buffered.data.q);
    const ongoing = h.w.currentActiveQuiz;
    release(); await generating;
    assert.equal(h.w.currentActiveQuiz, ongoing, 'late completion cannot interrupt an unanswered question');
    await h.w.startQuizFlow();
    assert.equal(h.w.currentActiveQuiz, ongoing, 'reopening also preserves that unanswered question');
    h.complete(); await h.w.nextQuestion();
    assert.equal(h.w.currentActiveQuiz.recoveryOrigin, h.normal.data.q);
    assert.equal(h.rolls, 1, 'only the earlier ordinary next step could roll an encounter');
});

test('repeated correction clicks share one generation and the ready question cannot be queued twice', async () => {
    const h = setup(); h.complete();
    let release, calls = 0;
    const fetch = h.context.fetch;
    h.context.fetch = async (...args) => { calls++; await new Promise(r => { release = r; }); return fetch(...args); };
    const a = h.w.startQuizExtendedPractice('功與動能', { correction: true });
    const b = h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.equal(calls, 1);
    release(); await Promise.all([a, b]);
    await h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.equal(calls, 1);
    assert.equal(h.cache.getQueue().filter(item => item.recoveryOrigin).length, 1);
});

test('correction generation failure preserves the normal buffer and allows an explicit retry', async () => {
    const h = setup(); h.complete();
    const fetch = h.context.fetch;
    h.context.fetch = async () => { throw Error('offline'); };
    await h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.equal(h.cache.getQueue().length, 1);
    assert.equal(h.get('solo-correction-practice').disabled, false);
    assert.match(h.get('solo-correction-practice').textContent, /重試/);
    h.context.fetch = fetch;
    await h.w.startQuizExtendedPractice('功與動能', { correction: true });
    assert.equal(h.cache.getQueue().filter(item => item.recoveryOrigin).length, 1);
});

test('a correction response from an old account, scope or cache generation is ignored', async () => {
    for (const change of ['account', 'scope', 'generation']) {
        const h = setup(); h.complete();
        let release;
        const fetch = h.context.fetch;
        h.context.fetch = async (...args) => { await new Promise(r => { release = r; }); return fetch(...args); };
        const generating = h.w.startQuizExtendedPractice('功與動能', { correction: true });
        if (change === 'account') h.auth.currentUser = { uid: 'u2' };
        if (change === 'scope') h.setScope('新範圍');
        if (change === 'generation') vm.runInContext('soloCacheRevision += 1;', h.context);
        release(); await generating;
        assert.equal(h.cache.getQueue().length, 1, change);
        assert.equal(h.cache.getQueue().some(item => item.recoveryOrigin), false, change);
    }
});

test('wrong-answer helper selections use correction prefetch instead of the next-question extension gate', async () => {
    const h = setup(); h.complete();
    h.context.quizHelperState.selectedIndex = 1;
    h.context.quizHelperState.correctIndex = 0;
    await h.w.startQuizExtendedPractice('功與動能');
    assert.equal(h.state.pending, null);
    assert.equal(h.generated.length, 1);
    assert.equal(h.w.hasReadySoloCorrection(), true);
});

test('correction finishing during a cold normal request is selected first and keeps that new normal question', async () => {
    const h = setup(); h.complete();
    h.cache.takeNext(); h.cache.consumeActive();
    let releaseCorrection, releaseNormal;
    const fetch = h.context.fetch;
    h.context.fetch = async (...args) => { await new Promise(r => { releaseCorrection = r; }); return fetch(...args); };
    h.context.fetchOneQuestion = () => new Promise(r => { releaseNormal = r; });
    const generating = h.w.startQuizExtendedPractice('功與動能', { correction: true });
    const next = h.w.nextQuestion();
    await new Promise(resolve => setImmediate(resolve));
    releaseCorrection(); await generating;
    releaseNormal(h.buffered); await next;
    assert.equal(h.w.currentActiveQuiz.recoveryOrigin, h.normal.data.q);
    assert.equal(h.cache.getQueue()[0].data.q, h.buffered.data.q);
});
