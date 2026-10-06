const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = fs.readFileSync(path.join(__dirname, '../public/cultivation/story/story-engine.js'), 'utf8');

test('only the unread first chapter is eligible for automatic playback even at high cultivation', () => {
  const source = engine.slice(engine.indexOf('  function nextEligibleChapter()'), engine.indexOf('  function openGenderChoice('));
  const seen = {};
  const first = { id: 'prologue-enter-sect', minScore: 0 };
  const ctx = vm.createContext({
    AUTO_CHAPTER_ID: first.id,
    storyChapterById: id => id === first.id ? first : { id, minScore: 5 },
    seenMap: () => seen,
    score: () => 2588
  });
  vm.runInContext(source, ctx);
  assert.equal(vm.runInContext('nextEligibleChapter()', ctx), first);
  seen[first.id] = { completedAtMs: 1 };
  assert.equal(vm.runInContext('nextEligibleChapter()', ctx), null, 'unread later chapters and incomplete battle tutorials cannot auto-start');
});

test('manual first viewing records progress while completed chapters and locked admin previews use replay mode', () => {
  const source = engine.slice(engine.indexOf('  window.openXiuxianStoryChapter ='), engine.indexOf('  window.getXiuxianStoryChapters ='));
  const seen = {};
  const chapter = { id: 'second', minScore: 5, tutorialKind: 'dongtian' };
  let currentScore = 5, admin = false, tutorialDone = true;
  const modes = [];
  const ctx = vm.createContext({
    window: {},
    AUTO_CHAPTER_ID: 'prologue-enter-sect',
    storyChapterById: id => id === chapter.id ? chapter : null,
    canPreviewAllStory: () => admin,
    score: () => currentScore,
    seenMap: () => seen,
    storyTutorialComplete: () => tutorialDone,
    startChapter: (_, options) => { modes.push(options.replay); return true; }
  });
  vm.runInContext(source, ctx);
  assert.equal(ctx.window.openXiuxianStoryChapter(chapter.id), true);
  assert.equal(modes.at(-1), false);
  seen[chapter.id] = { completedAtMs: 1 };
  ctx.window.openXiuxianStoryChapter(chapter.id);
  assert.equal(modes.at(-1), true);
  tutorialDone = false;
  ctx.window.openXiuxianStoryChapter(chapter.id);
  assert.equal(modes.at(-1), false, 'legacy readers may finish their missing tutorial by clicking');
  currentScore = 4;
  assert.equal(ctx.window.openXiuxianStoryChapter(chapter.id), false);
  admin = true;
  ctx.window.openXiuxianStoryChapter(chapter.id);
  assert.equal(modes.at(-1), true, 'locked administrator previews are read only');
  assert.equal(ctx.window.openXiuxianStoryChapter('unknown'), false);
});

function finishContext({ replay = false, fail = false } = {}) {
  const profile = { storyProgressV1: { seen: {} } };
  let saves = 0;
  const events = [];
  const ctx = vm.createContext({
    FIELD: 'storyProgressV1', STORY_VERSION: 1, LAYER_ID: 'story-layer',
    busyPersist: false, finishingChapter: false, chapterSaveError: '', tutorialLaunchError: '',
    currentChapter: { id: 'second' }, replayMode: replay, active: true, lineIndex: 12, snoozeUntil: 0,
    data: () => profile, user: () => ({ uid: 'u1' }), score: () => 5,
    seenMap: () => profile.storyProgressV1.seen,
    getApp: () => ({}), getFirestore: () => ({}), doc: () => ({}),
    updateDoc: async () => { saves += 1; if (fail) throw new Error('offline'); },
    document: { getElementById: () => null }, renderLine() {},
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn() {} }
  });
  const persist = engine.slice(engine.indexOf('  async function persist('), engine.indexOf('  function ensureStyle()'));
  const finish = engine.slice(engine.indexOf('  async function finishChapter()'), engine.indexOf('  function deferChapter()'));
  vm.runInContext(persist + finish, ctx);
  return { ctx, profile, events, saves: () => saves };
}

test('failed completion save leaves the chapter open and retry saves and dispatches completion exactly once', async () => {
  const { ctx, profile, events, saves } = finishContext({ fail: true });
  await vm.runInContext('finishChapter()', ctx);
  assert.equal(ctx.active, true);
  assert.equal(profile.storyProgressV1.seen.second, undefined);
  assert.match(ctx.chapterSaveError, /尚未儲存/);
  assert.equal(events.length, 0);
  let retries = 0;
  ctx.updateDoc = async () => { retries += 1; };
  await Promise.all([vm.runInContext('finishChapter()', ctx), vm.runInContext('finishChapter()', ctx)]);
  assert.equal(ctx.active, false);
  assert.ok(profile.storyProgressV1.seen.second.completedAtMs > 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'xiuxian:story-chapter-completed');
  assert.equal(events[0].detail.id, 'second');
  assert.equal(retries, 1, 'double-clicking completion cannot start a second save');
  assert.equal(saves(), 1, 'only the failed original attempt used the offline writer');
});

test('replaying a completed chapter never writes progress or emits a new viewing completion', async () => {
  const { ctx, profile, events, saves } = finishContext({ replay: true });
  profile.storyProgressV1.seen.second = { completedAtMs: 123 };
  await vm.runInContext('finishChapter()', ctx);
  assert.equal(saves(), 0);
  assert.equal(events.length, 0);
  assert.equal(profile.storyProgressV1.seen.second.completedAtMs, 123);
  assert.equal(ctx.active, false);
});

test('the viewing quest opens its own chapter and gives feedback when the player is busy', () => {
  const client = fs.readFileSync(path.join(__dirname, '../public/cultivation/quest-system.js'), 'utf8');
  const source = client.slice(client.indexOf('  function go('), client.indexOf('  function mount()'));
  const q = require('../public/cultivation/quest-rules.js').PATH.find(q => q.chapterId === 'qi-five-dongtian');
  let opened = true;
  const calls = [], messages = [];
  const ctx = vm.createContext({
    window: { openXiuxianStoryChapter: id => { calls.push(id); return opened; } },
    status: message => messages.push(message)
  });
  vm.runInContext(source, ctx);
  ctx.go(q.destination, q);
  assert.deepEqual(calls, ['qi-five-dongtian']);
  assert.equal(messages.length, 0);
  opened = false;
  ctx.go(q.destination, q);
  assert.match(messages[0], /先結束目前的戰鬥或教學/);
});
