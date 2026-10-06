'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const legacy = readFileSync(require.resolve('../public/main-legacy.js'), 'utf8');
const engine = readFileSync(require.resolve('../public/cultivation/story/story-engine.js'), 'utf8');

function loginContext({ failSave = false } = {}) {
  const rows = new Map(), auth = { currentUser: null };
  const node = { classList: { add() {}, remove() {} }, removeAttribute() {}, setAttribute() {} };
  let handler;
  const ctx = vm.createContext({
    auth, db: {}, firstLoginUid: '', currentUserData: null, immortalBoardUnsub: null,
    window: { setTrueImmortalBoard() {} }, document: { getElementById: () => node },
    collection: () => ({}), onSnapshot: () => () => {}, updateTexts() {}, injectSocialUI() {},
    showGameStartupGate() {}, showGameStartupFailure() {}, alert() {},
    doc: (_, collection, uid) => ({ collection, uid }),
    getDoc: async ref => ({ exists: () => rows.has(ref.uid), data: () => rows.get(ref.uid) }),
    setDoc: async (ref, value) => { if (failSave) throw Error('offline'); rows.set(ref.uid, value); },
    updateDoc: async () => {},
    // Stop after account initialization; feature loading is unrelated to this decision.
    waitForVerifiedPlayerMigration: async () => { throw Error('end of account-init test'); },
    console: { error() {}, warn() {} },
    onAuthStateChanged: (_, callback) => { handler = callback; }
  });
  const flag = legacy.match(/^window\.isXiuxianFirstLogin = .*;$/m)[0];
  const start = legacy.indexOf('onAuthStateChanged(auth, async (user) => {');
  const end = legacy.indexOf("window.addEventListener('xiuxian:stats-updated', ensureGameplayNavigationForReadyProfile);", start);
  vm.runInContext(flag + '\n' + legacy.slice(start, end), ctx);
  return { ctx, rows, login: async uid => { auth.currentUser = { uid }; await handler(auth.currentUser); } };
}

test('only a successfully created player document grants first-login autoplay, including after reload', async () => {
  const first = loginContext();
  await first.login('new-player');
  assert.equal(first.ctx.window.isXiuxianFirstLogin(), true);
  const returning = loginContext();
  returning.rows.set('new-player', first.rows.get('new-player'));
  await returning.login('new-player');
  assert.equal(returning.ctx.window.isXiuxianFirstLogin(), false, 'an unread prologue does not make a returning player new');
  await first.login('new-player');
  assert.equal(first.ctx.window.isXiuxianFirstLogin(), false, 'signing in again resets first-login eligibility');
});

test('first-login eligibility belongs to the authenticated account and failed initialization grants none', async () => {
  const session = loginContext();
  await session.login('one');
  session.ctx.auth.currentUser = { uid: 'two' };
  assert.equal(session.ctx.window.isXiuxianFirstLogin(), false);
  await session.login('two');
  assert.equal(session.ctx.window.isXiuxianFirstLogin(), true);
  const failed = loginContext({ failSave: true });
  await failed.login('offline-player');
  assert.equal(failed.ctx.window.isXiuxianFirstLogin(), false);
});

function autoContext({ firstLogin = true, gender = 'male' } = {}) {
  const calls = [], chapter = { id: 'prologue-enter-sect' };
  const ctx = vm.createContext({
    window: { isXiuxianFirstLogin: () => firstLogin },
    user: () => ({ uid: 'u1' }), data: () => ({ stats: {} }),
    prologueAutoStartedUid: '', storyImagesReady: true, active: false, storyTutorialPaused: false,
    ARCHIVE_ID: 'archive', snoozeUntil: 0, autoPermits: 1,
    document: { getElementById: () => null }, onboardingReady: () => true, blocking: () => false,
    nextEligibleChapter: () => chapter, gender: () => gender,
    openGenderChoice: () => { calls.push('gender'); return true; },
    startChapter: value => { calls.push(value.id); return true; }
  });
  const start = engine.indexOf('  function maybeAutoStart()');
  const end = engine.indexOf('  function handleScoreUpdate()', start);
  vm.runInContext(engine.slice(start, end), ctx);
  return { ctx, calls };
}

test('first login opens the prologue once; later timers, score updates and deferral never reopen it', () => {
  const { ctx, calls } = autoContext();
  ctx.maybeAutoStart();
  assert.deepEqual(calls, ['prologue-enter-sect']);
  ctx.autoPermits = 1;
  ctx.snoozeUntil = 0;
  ctx.maybeAutoStart();
  assert.equal(calls.length, 1);
  const returning = autoContext({ firstLogin: false });
  returning.ctx.maybeAutoStart();
  assert.equal(returning.calls.length, 0);
});

test('onboarding and busy screens defer the first opening without consuming it; gender selection also opens once', () => {
  const { ctx, calls } = autoContext({ gender: '' });
  ctx.onboardingReady = () => false;
  ctx.maybeAutoStart();
  assert.equal(ctx.prologueAutoStartedUid, '');
  ctx.onboardingReady = () => true;
  ctx.blocking = () => true;
  ctx.maybeAutoStart();
  assert.equal(calls.length, 0);
  ctx.blocking = () => false;
  ctx.maybeAutoStart();
  ctx.maybeAutoStart();
  assert.deepEqual(calls, ['gender']);
});

test('a returning player can manually open the prologue and choose a gender without an autoplay permit', () => {
  const chapter = { id: 'prologue-enter-sect', minScore: 0 }, choices = [];
  const ctx = vm.createContext({
    window: {}, AUTO_CHAPTER_ID: chapter.id, storyChapterById: () => chapter,
    canPreviewAllStory: () => false, score: () => 0, gender: () => '',
    onboardingReady: () => true, blocking: () => false,
    openGenderChoice: options => { choices.push(options.chapterId); return true; }
  });
  const start = engine.indexOf('  window.openXiuxianStoryChapter =');
  const end = engine.indexOf('  window.getXiuxianStoryChapters =', start);
  vm.runInContext(engine.slice(start, end), ctx);
  assert.equal(ctx.window.openXiuxianStoryChapter(chapter.id), true);
  assert.deepEqual(choices, [chapter.id]);
  ctx.blocking = () => true;
  assert.equal(ctx.window.openXiuxianStoryChapter(chapter.id), false);
});
