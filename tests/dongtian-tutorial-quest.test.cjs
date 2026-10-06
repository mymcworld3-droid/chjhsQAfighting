'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tutorial = read('public/cultivation/newbie-tutorial-v2.js');
const rules = require('../public/cultivation/quest-rules.js');

test('the actual dream chapter plays all its dialogue without handing off to a tutorial', () => {
  const scripts = read('public/cultivation/story/story-scripts.js').replace(/^export /gm, '');
  const chapter = vm.runInNewContext(scripts + "\nSTORY_CHAPTERS.find(chapter => chapter.id === 'qi-five-dongtian');");
  const engine = read('public/cultivation/story/story-engine.js');
  const lifecycle = engine.slice(engine.indexOf('  function storyTutorialComplete('), engine.indexOf('  async function finishChapter()'));
  let finished = 0;
  const ctx = vm.createContext({
    active: true, currentChapter: chapter, lineIndex: 0, replayMode: false,
    renderLine() {}, finishChapter: () => finished++,
    window: { startStoryDongtianTutorial: () => assert.fail('the dream must never launch the lesson') }
  });
  vm.runInContext(lifecycle, ctx);
  for (let i = 0; i < chapter.lines.length; i++) ctx.nextLine();
  assert.equal(finished, 1);
  assert.equal(ctx.lineIndex, chapter.lines.length - 1);
  assert.equal(chapter.minScore, 5);
  assert.equal(chapter.scene.page, 'page-home');
  assert.match(chapter.lines.at(-1).text, /心滿意足地離開/);
});

function lessonContext({ fail = false, replay = false, flags = {} } = {}) {
  const profile = { stats: { totalScore: 5 } };
  const events = [], renders = [];
  let writes = 0;
  const ctx = vm.createContext({
    active: true, finishing: false, completionError: '', tutorialMode: 'dongtian',
    startedByStory: false, replayOnly: replay, resizeHandler: null,
    dongtianDemoCompleted: true, dongtianDemoReturned: true, dongtianDemoDeleted: true, ...flags,
    FIELD: 'newbieTutorialV1', DONGTIAN_FIELD: 'storyDongtianTutorialV1', VERSION: 2,
    userData: () => profile, getApp: () => ({}), getAuth: () => ({ currentUser: { uid: 'u1' } }),
    getFirestore: () => ({}), doc: (_db, collection, uid) => ({ collection, uid }),
    updateDoc: async (ref, patch) => {
      writes++;
      assert.equal(ref.uid, 'u1');
      assert.equal(profile.storyDongtianTutorialV1, undefined, 'completion is not published locally before saving');
      assert.equal(events.length, 0, 'no completion event precedes the save');
      assert.equal(patch.storyDongtianTutorialV1.completed, true);
      if (fail) throw new Error('offline');
    },
    scopeStudioOpen: () => false, cleanupExampleQuiz() {}, navigate() {},
    renderCardOnly: () => renders.push(ctx.completionError),
    document: { getElementById: () => null },
    window: { dispatchEvent: e => events.push(e), deleteNewbieDongtianDemo() {}, removeEventListener() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn() {} }
  });
  const lifecycle = tutorial.slice(tutorial.indexOf('  function tutorialCompleted('), tutorial.indexOf('  function start('));
  vm.runInContext(lifecycle, ctx);
  return { ctx, profile, events, renders, writes: () => writes };
}

test('skipping the independent lesson leaves the completion marker and quest incomplete', async () => {
  const { ctx, profile, events, writes } = lessonContext();
  await ctx.finish(true);
  assert.equal(ctx.active, false);
  assert.equal(profile.storyDongtianTutorialV1, undefined);
  assert.equal(writes(), 0);
  assert.equal(events.length, 0);
});

test('the lesson cannot finish before playing, returning and deleting the private demo', async () => {
  for (const flag of ['dongtianDemoCompleted', 'dongtianDemoReturned', 'dongtianDemoDeleted']) {
    const { ctx, events, writes } = lessonContext({ flags: { [flag]: false } });
    await ctx.finish(false);
    assert.equal(ctx.active, true, flag);
    assert.equal(writes(), 0);
    assert.equal(events.length, 0);
  }
});

test('failed lesson saves keep the last step available; retrying double clicks saves and emits once', async () => {
  const { ctx, profile, events, writes } = lessonContext({ fail: true });
  await ctx.finish(false);
  assert.equal(ctx.active, true);
  assert.equal(profile.storyDongtianTutorialV1, undefined);
  assert.match(ctx.completionError, /尚未儲存/);
  assert.equal(events.length, 0);
  let retries = 0;
  ctx.updateDoc = async () => { retries++; };
  await Promise.all([ctx.finish(false), ctx.finish(false)]);
  assert.equal(retries, 1);
  assert.equal(writes(), 1);
  assert.equal(ctx.active, false);
  assert.equal(profile.storyDongtianTutorialV1.completed, true);
  assert.equal(profile.storyDongtianTutorialV1.skipped, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'xiuxian:dongtian-tutorial-completed');
});

test('lesson replay never rewrites the old marker or triggers another completion event', async () => {
  const { ctx, profile, events, writes } = lessonContext({ replay: true });
  const marker = { completed: true, skipped: false, completedAt: 123 };
  profile.storyDongtianTutorialV1 = marker;
  await ctx.finish(false);
  assert.equal(profile.storyDongtianTutorialV1, marker);
  assert.equal(writes(), 0);
  assert.equal(events.length, 0);
});

test('the question lesson still resumes its story after saving, including the existing skip option', async () => {
  for (const skipped of [false, true]) {
    const { ctx, profile, events } = lessonContext();
    ctx.tutorialMode = 'question';
    ctx.startedByStory = true;
    let writes = 0;
    ctx.updateDoc = async () => { writes++; };
    await ctx.finish(skipped);
    assert.equal(writes, 1);
    assert.equal(profile.newbieTutorialV1.completed, true);
    assert.equal(profile.newbieTutorialV1.skipped, skipped);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'xiuxian:story-tutorial-finished');
    assert.equal(events[0].detail.kind, 'question');
    assert.equal(ctx.active, false);
  }
});

test('legacy skipped lessons can be learned again while genuinely completed lessons remain read only', () => {
  const { ctx, profile } = lessonContext();
  profile.storyDongtianTutorialV1 = { completed: true, skipped: true };
  assert.equal(ctx.tutorialCompleted('dongtian'), false);
  profile.storyDongtianTutorialV1.skipped = false;
  assert.equal(ctx.tutorialCompleted('dongtian'), true);
  delete profile.storyDongtianTutorialV1;
  profile.qiFiveDongtianTutorialV1 = { completed: true, played: true, deleted: true };
  assert.equal(ctx.tutorialCompleted('dongtian'), true);
});

test('the independent launcher waits for five cultivation and blocks overlays without opening a story', () => {
  const profile = { stats: { totalScore: 4 } };
  let blocked = false;
  const calls = [];
  const ctx = vm.createContext({
    userData: () => profile, blocking: () => blocked,
    start: (...args) => { calls.push(args); return true; }, window: {}
  });
  const launcher = tutorial.slice(tutorial.indexOf('  window.startDongtianTutorial ='), tutorial.indexOf('  window.replayStoryDongtianTutorial ='));
  vm.runInContext(launcher, ctx);
  assert.equal(ctx.window.startDongtianTutorial(), false);
  profile.stats.totalScore = 5;
  blocked = true;
  assert.equal(ctx.window.startDongtianTutorial(), false);
  blocked = false;
  assert.equal(ctx.window.startDongtianTutorial(), true);
  assert.deepEqual(calls, [['dongtian']]);
});

test('the new quest opens the independent lesson, reports a busy state and refreshes on saved completion', () => {
  const client = read('public/cultivation/quest-system.js');
  const route = client.slice(client.indexOf('  function go('), client.indexOf('  function mount()'));
  let opened = true, calls = 0;
  const messages = [];
  const ctx = vm.createContext({
    window: { startDongtianTutorial: () => { calls++; return opened; }, openXiuxianStoryChapter: () => assert.fail('lesson must not open the dream') },
    status: message => messages.push(message)
  });
  vm.runInContext(route, ctx);
  ctx.go(rules.PATH.find(q => q.id === 'path-dongtian-tutorial').destination);
  assert.equal(calls, 1);
  assert.equal(messages.length, 0);
  opened = false;
  ctx.go('dongtian-tutorial');
  assert.match(messages[0], /先結束目前的戰鬥、劇情或教學/);
  assert.match(client, /'xiuxian:dongtian-tutorial-completed'\]\.forEach/);
});
