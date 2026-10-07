const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const legacy = read('main-legacy.js');
const navigation = legacy.slice(legacy.indexOf('let brandHomeNavigationPending ='), legacy.indexOf('window.updateUIStats ='));

function setup(pageId = 'page-store') {
  const flags = { page: { id: pageId }, overlays: new Set(), modals: [], profileReady: true, loading: false, battleBusy: false, raidBusy: false, raidFocus: false };
  const calls = { pages: [], battle: 0, raid: 0, toasts: [] };
  const context = {
    auth: { currentUser: { uid: 'player' } }, currentUserData: { profile: {} },
    hasCompletedPlayerProfile: () => flags.profileReady,
    isBattleActive: false, isAnswering: false, soloNextBusy: false,
    console: { warn() {} },
    document: {
      body: { classList: { contains: name => name === 'raid-session-active' && flags.raidFocus } },
      querySelector(selector) {
        if (selector === '.page-section.active-page') return flags.page;
        if (selector === '#quiz-loading:not(.hidden)') return flags.loading ? {} : null;
        return selector.split(',').some(item => flags.overlays.has(item)) ? {} : null;
      },
      querySelectorAll: () => flags.modals
    },
    window: {
      switchToPage: page => { calls.pages.push(page); flags.page = { id: page }; },
      showToast: text => calls.toasts.push(text),
      isXiuxianBattleBusy: () => flags.battleBusy,
      getBattleV2State: () => flags.battle,
      isXiuxianRaidInviteBlocked: () => flags.raidBusy,
      getRaidMvpState: () => flags.raid,
      returnFromBattleResult: async () => { calls.battle++; return true; },
      returnFromRaidResult: async () => { calls.raid++; return true; }
    }
  };
  vm.runInNewContext(navigation, context);
  return { flags, calls, context, home: () => context.window.returnToImmortalHome() };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('the entire brand is a native button that calls guarded navigation', () => {
  const button = read('index.html').match(/<button id="brand-home"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(button);
  assert.match(button[0], /type="button"/);
  assert.match(button[0], /onclick="returnToImmortalHome\(\)"/);
  assert.match(button[0], /aria-label="青雲問道，返回仙府"/);
  assert.match(button[1], /青雲問道/);
  assert.match(button[1], /以學入道 · 積微成仙/);
});

test('normal pages return through the existing page transition; home is a no-op', async () => {
  for (const page of ['page-store', 'page-rank', 'page-settings', 'page-training', 'page-social', 'page-admin', 'page-raid']) {
    const h = setup(page);
    assert.equal(await h.home(), true, page);
    assert.deepEqual(h.calls.pages, ['page-home']);
    assert.equal(await h.home(), false);
    assert.equal(h.calls.pages.length, 1);
  }
});

test('logged-out, incomplete and loading profiles cannot enter the home through the title', async () => {
  for (const block of [h => { h.context.auth.currentUser = null; }, h => { h.context.currentUserData = null; }, h => { h.flags.profileReady = false; }]) {
    const h = setup();
    block(h);
    assert.equal(await h.home(), false);
    assert.equal(h.calls.pages.length, 0);
  }
  for (const selector of ['#login-screen:not(.hidden)', '#page-onboarding:not(.hidden)', '#game-startup-gate', '#startup-cloud-curtain']) {
    const h = setup();
    h.flags.overlays.add(selector);
    assert.equal(await h.home(), false, selector);
    assert.equal(h.calls.pages.length, 0);
  }
});

test('story, tutorials and trials retain their own close and completion flows', async () => {
  for (const selector of ['#xiuxian-opening-cinematic', '#xiuxian-story-layer', '#xiuxian-story-archive', '#newbie-tutorial-layer', '#qi-five-dongtian-tutorial-layer', '#golden-core-tutorial-layer', '#battle-tutorial-layer', '#daily-meditation-overlay', '#dongtian-overlay', '#opportunity-overlay', '#five-immortal-challenge', '#custom-confirm-modal:not(.hidden)', '#report-modal:not(.hidden)']) {
    const h = setup();
    h.flags.overlays.add(selector);
    assert.equal(await h.home(), false, selector);
    assert.equal(h.calls.pages.length, 0);
  }
  const h = setup();
  h.flags.modals = [{ getClientRects: () => [{}] }];
  assert.equal(await h.home(), false);
  h.flags.modals = [{ getClientRects: () => [] }];
  assert.equal(await h.home(), true, 'hidden dialogs do not prevent navigation');
  for (const getter of ['getBattleTutorialState', 'isXiuxianOpeningCinematicActive']) {
    const activeFlow = setup();
    activeFlow.context.window[getter] = () => getter === 'getBattleTutorialState' ? { active: true } : true;
    assert.equal(await activeFlow.home(), false, 'active flow remains protected while its DOM is changing');
    assert.equal(activeFlow.calls.pages.length, 0);
  }
});

test('returning from an unanswered question preserves it and does not abandon or score it', async () => {
  const h = setup('page-quiz');
  const question = { data: { q: 'Unanswered', ans: 1 } };
  h.context.window.currentActiveQuiz = question;
  assert.equal(await h.home(), true);
  assert.equal(h.context.window.currentActiveQuiz, question);
  assert.deepEqual(question, { data: { q: 'Unanswered', ans: 1 } });
  assert.deepEqual(h.calls.pages, ['page-home']);
});

test('quiz loading and next-question operations cannot be interrupted by the title', async () => {
  for (const block of [h => { h.flags.loading = true; }, h => { h.context.soloNextBusy = true; }, h => { h.context.isAnswering = true; }]) {
    const h = setup('page-quiz');
    block(h);
    assert.equal(await h.home(), false);
    assert.equal(h.calls.pages.length, 0);
  }
});

test('answer writes finish before returning and repeated title clicks do not duplicate navigation', async () => {
  const h = setup('page-quiz'), save = deferred();
  h.context.window.currentActiveQuiz = { answerPersistence: save.promise };
  const first = h.home();
  assert.equal(await h.home(), false);
  assert.equal(h.calls.pages.length, 0);
  save.resolve();
  assert.equal(await first, true);
  assert.deepEqual(h.calls.pages, ['page-home']);
});

test('a late answer write cannot override a new account, another page or a newly opened story', async () => {
  for (const change of [h => { h.context.auth.currentUser = { uid: 'another' }; }, h => { h.flags.page = { id: 'page-settings' }; }, h => { h.flags.overlays.add('#xiuxian-story-layer'); }]) {
    const h = setup('page-quiz'), save = deferred();
    h.context.window.currentActiveQuiz = { answerPersistence: save.promise };
    const pending = h.home();
    change(h);
    save.resolve();
    assert.equal(await pending, false);
    assert.equal(h.calls.pages.length, 0);
  }
});

test('matchmaking, recovery and all active battle phases cannot be bypassed', async () => {
  for (const status of ['idle', 'waiting', 'intro', 'playing', 'preparing', 'settled']) {
    const h = setup('page-battle');
    h.flags.battleBusy = true;
    h.flags.battle = { status, roomId: status === 'idle' ? null : 'duel' };
    assert.equal(await h.home(), false, status);
    assert.equal(h.calls.battle, 0);
    assert.equal(h.calls.pages.length, 0);
  }
  const legacyBattle = setup('page-battle');
  legacyBattle.context.isBattleActive = true;
  assert.equal(await legacyBattle.home(), false);
});

test('battle results use room cleanup instead of directly switching pages', async () => {
  const h = setup('page-battle');
  h.flags.battleBusy = true;
  h.flags.battle = { status: 'finished', roomId: 'duel' };
  assert.equal(await h.home(), true);
  assert.equal(h.calls.battle, 1);
  assert.equal(h.calls.pages.length, 0);
});

test('raid lobby and combat retain the existing departure confirmation', async () => {
  for (const status of ['loading', 'lobby', 'active', 'question', 'review', 'submitting', 'spectating']) {
    const h = setup('page-raid');
    h.flags.raidBusy = true;
    h.flags.raid = { status, roomId: status === 'loading' ? null : 'raid' };
    assert.equal(await h.home(), false, status);
    assert.equal(h.calls.raid, 0);
    assert.equal(h.calls.pages.length, 0);
  }
  const h = setup('page-raid');
  h.flags.raidFocus = true;
  assert.equal(await h.home(), false, 'fullscreen lock protects an unavailable raid module');
});

test('finished raids use their existing cleanup; failed cleanup releases the title lock', async () => {
  const h = setup('page-raid');
  h.flags.raid = { status: 'finished', roomId: 'raid' };
  assert.equal(await h.home(), true);
  assert.equal(h.calls.raid, 1);
  assert.equal(h.calls.pages.length, 0);
  h.context.window.returnFromRaidResult = async () => { throw new Error('unavailable'); };
  assert.equal(await h.home(), false);
  h.flags.raid = null;
  assert.equal(await h.home(), true);
});

test('battle result cleanup never forfeits and refuses matchmaking, recovery and active rooms', async () => {
  const source = read('cultivation/battle-mode-v2.js');
  const fn = source.slice(source.indexOf('  async function returnFromBattleResult()'), source.indexOf('  async function joinSpecificRoom('));
  const calls = [];
  const state = { room: { status: 'finished' }, starting: false, leaving: false, recovering: false };
  const context = { state, exitBattle: async options => calls.push(JSON.parse(JSON.stringify(options))) };
  vm.runInNewContext(fn + '\nthis.home = returnFromBattleResult;', context);
  for (const flag of ['starting', 'leaving', 'recovering']) {
    state[flag] = true;
    assert.equal(await context.home(), false, flag);
    state[flag] = false;
  }
  state.room.status = 'playing';
  assert.equal(await context.home(), false);
  assert.equal(calls.length, 0);
  state.room.status = 'finished';
  assert.equal(await context.home(), true);
  assert.deepEqual(calls, [{ navigate: true, forfeit: false }]);
});

function raidCleanup() {
  const source = read('cultivation/raid-mode.js');
  const fn = source.slice(source.indexOf('  let returningFromRaidResult ='), source.indexOf('  function resetRaid('));
  const departure = deferred(), calls = [];
  const context = {
    state: { status: 'finished', roomId: 'original-room' },
    leaveRaidRoom: room => { calls.push(['leave', room]); return departure.promise; },
    resetRaid: clear => { calls.push(['reset', clear]); context.state.roomId = null; },
    window: { switchToPage: page => calls.push(['page', page]) },
    syncRaidViewportLock: () => calls.push(['viewport'])
  };
  vm.runInNewContext(fn + '\nthis.home = returnFromRaidResult;', context);
  return { context, calls, departure };
}

test('raid results leave once and release viewport locks before returning', async () => {
  const h = raidCleanup();
  const first = h.context.home();
  assert.equal(await h.context.home(), false);
  h.departure.resolve();
  assert.equal(await first, true);
  assert.deepEqual(h.calls, [['leave', 'original-room'], ['reset', false], ['page', 'page-home'], ['viewport']]);
});

test('a finished raid departure cannot erase a newly joined room', async () => {
  const h = raidCleanup();
  const pending = h.context.home();
  h.context.state = { status: 'lobby', roomId: 'new-room' };
  h.departure.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(h.calls, [['leave', 'original-room']]);
  assert.equal(h.context.state.roomId, 'new-room');
});
