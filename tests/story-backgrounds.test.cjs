'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const backgroundsSource = read('public/cultivation/story/story-backgrounds.js');
const api = vm.runInNewContext(backgroundsSource.replace(/^export /gm, '') +
  '\n({ STORY_BACKGROUNDS, storyBackgroundById, storyBackgroundForLine, nextStoryBackground, createStoryBackgroundLoader });');
const chapters = vm.runInNewContext(read('public/cultivation/story/story-scripts.js').replace(/^export /gm, '') + '\nSTORY_CHAPTERS;');
const engine = read('public/cultivation/story/story-engine.js');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('all 24 backgrounds have unique reserved filenames, existing fallbacks and valid chapter checkpoints', () => {
  assert.equal(api.STORY_BACKGROUNDS.length, 24);
  assert.equal(new Set(api.STORY_BACKGROUNDS.map(item => item.filename)).size, 24);
  const used = new Set();
  for (const item of api.STORY_BACKGROUNDS) {
    assert.match(item.src, /^assets\/story\/backgrounds\/story-bg-\d\d-[a-z-]+\.png$/);
    assert.equal(fs.existsSync(path.join(__dirname, '../public', item.fallback)), true, item.fallback);
  }
  for (const chapter of chapters) {
    assert.equal(chapter.backgrounds[0].fromLine, 0, chapter.id);
    let previous = -1;
    for (const scene of chapter.backgrounds) {
      assert.ok(scene.fromLine > previous && scene.fromLine < chapter.lines.length, chapter.id);
      assert.ok(api.storyBackgroundById(scene.id), scene.id);
      used.add(scene.id);
      previous = scene.fromLine;
    }
  }
  assert.equal(used.size, 24, 'every requested image is used by the current story');
});

test('the dream changes from study to library, returns to the study, then reveals the corridor', () => {
  const dream = chapters.find(item => item.id === 'qi-five-dongtian');
  const expected = [[0, 'study-night'], [1, 'bamboo-dream'], [18, 'bamboo-dream'], [19, 'study-night'], [21, 'corridor-night']];
  for (const [line, id] of expected) assert.equal(api.storyBackgroundForLine(dream, line).id, id);
  assert.equal(api.nextStoryBackground(dream, 1).id, 'study-night');
  const first = chapters[0];
  assert.equal(api.storyBackgroundForLine(first, first.tutorialAfterLine + 1).id, 'study-day');
  assert.equal(api.nextStoryBackground(dream, 21), null);
});

test('concurrent requests share the primary image load and successful primary images take precedence', async () => {
  const calls = [];
  const loader = api.createStoryBackgroundLoader(async src => { calls.push(src); return { ok: true }; });
  const scene = api.STORY_BACKGROUNDS[0];
  const results = await Promise.all([loader.load(scene), loader.load(scene), loader.load(scene)]);
  assert.deepEqual(results, [scene.src, scene.src, scene.src]);
  assert.deepEqual(calls, [scene.src]);
  assert.equal(loader.has(scene.id), true);
  assert.equal(loader.get(scene.id), scene.src);
});

test('missing custom images share fallback loads while total failure still resolves readiness', async () => {
  const calls = [];
  const loader = api.createStoryBackgroundLoader(async src => {
    calls.push(src);
    if (src.includes('/backgrounds/')) throw new Error('404');
    return { ok: true };
  });
  const [a, b] = api.STORY_BACKGROUNDS;
  const results = await Promise.all([loader.load(a), loader.load(b)]);
  assert.deepEqual(results, [a.fallback, b.fallback]);
  assert.equal(calls.filter(src => src === a.fallback).length, 1);
  const failed = api.createStoryBackgroundLoader(async () => ({ ok: false }));
  assert.equal(await failed.load(a), null);
  assert.equal(failed.has(a.id), true, 'a failed background cannot retry forever and prevent chapter opening');
});

test('an unresponsive image request times out rather than blocking a chapter', async () => {
  const callbacks = [];
  const ctx = vm.createContext({
    Image: class {}, setTimeout: fn => { callbacks.push(fn); return 1; }, clearTimeout() {}
  });
  const source = engine.slice(engine.indexOf('  function preloadImageAsset('), engine.indexOf('  function addStoryPreloadHints()'));
  vm.runInContext(source, ctx);
  const pending = ctx.preloadImageAsset('missing.png', 20);
  callbacks[0]();
  const result = await pending;
  assert.equal(result.src, 'missing.png');
  assert.equal(result.ok, false);
});

test('batch portrait preload uses the full timeout for every image instead of the array index', async () => {
  const timeouts = [];
  const ctx = vm.createContext({
    Image: class {
      set src(value) { this.value = value; queueMicrotask(() => this.onload?.()); }
    },
    setTimeout: (_fn, delay) => { timeouts.push(delay); return timeouts.length; }, clearTimeout() {},
    STORY_IMAGE_ASSETS: ['first.png', 'second.png'], storyImagesPromise: null,
    document: { head: { querySelector: () => null, appendChild() {} }, createElement: () => ({}) },
    window: { dispatchEvent() {} }, CustomEvent: class {}, console
  });
  const source = engine.slice(engine.indexOf('  function preloadImageAsset('), engine.indexOf('  async function persist('));
  vm.runInContext(source, ctx);
  const images = await ctx.preloadStoryImages();
  assert.deepEqual(timeouts, [8000, 8000]);
  assert.ok(images.every(item => item.ok));
});

class Node {
  constructor() { this.dataset = {}; this.children = []; this.isConnected = true; this.className = ''; }
  get classList() {
    const classes = () => new Set(this.className.split(' ').filter(Boolean));
    return {
      add: value => { const set = classes(); set.add(value); this.className = [...set].join(' '); },
      remove: value => { const set = classes(); set.delete(value); this.className = [...set].join(' '); },
      contains: value => classes().has(value)
    };
  }
  setAttribute() {}
  append(node) { node.parent = this; this.children.push(node); }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.classList.contains(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function paintingContext(loader) {
  const el = new Node(), frames = [], timers = [];
  const ctx = vm.createContext({
    active: true, lineIndex: 0, currentChapter: { backgrounds: [{ fromLine: 0, id: 'sect-courtyard' }, { fromLine: 1, id: 'spirit-root-hall' }] },
    storyBackgroundForLine: api.storyBackgroundForLine, nextStoryBackground: api.nextStoryBackground,
    backgroundLoader: loader, document: { createElement: () => new Node() },
    window: { requestAnimationFrame: fn => frames.push(fn) }, setTimeout: fn => timers.push(fn)
  });
  const source = engine.slice(engine.indexOf('  function updateStoryBackground('), engine.indexOf('  function renderLine('));
  vm.runInContext(source, ctx);
  return { el, ctx, frames, flush: () => { while (frames.length) frames.shift()(); while (timers.length) timers.shift()(); } };
}

test('fast scene changes with the same fallback never remove the only visible image', () => {
  const same = 'assets/story/opening/opening-1.png';
  const { el, ctx, flush, frames } = paintingContext({ has: () => true, get: () => same, load: () => Promise.resolve(same) });
  ctx.updateStoryBackground(el);
  ctx.lineIndex = 1;
  ctx.updateStoryBackground(el);
  flush();
  const images = el.querySelectorAll('.story-background-image');
  assert.equal(images.length, 1);
  assert.equal(images[0].classList.contains('is-visible'), true);
  const image = images[0];
  ctx.updateStoryBackground(el);
  assert.equal(frames.length, 0, 'same-scene dialogue does not restart a fade');
  assert.equal(el.querySelector('.story-background-image'), image);
});

test('slow old scene loads cannot overwrite the newer scene or paint after the chapter closes', async () => {
  const pending = new Map();
  const loader = {
    has: () => false,
    load: scene => {
      if (!pending.has(scene.id)) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pending.set(scene.id, { promise, resolve });
      }
      return pending.get(scene.id).promise;
    }
  };
  const { el, ctx, flush } = paintingContext(loader);
  ctx.updateStoryBackground(el);
  ctx.lineIndex = 1;
  ctx.updateStoryBackground(el);
  pending.get('spirit-root-hall').resolve('new.png');
  await settle(); flush();
  pending.get('sect-courtyard').resolve('old.png');
  await settle(); flush();
  assert.deepEqual(el.querySelectorAll('.story-background-image').map(node => node.src), ['new.png']);
  ctx.active = false;
  ctx.lineIndex = 0;
  ctx.updateStoryBackground(el);
  await settle(); flush();
  assert.deepEqual(el.querySelectorAll('.story-background-image').map(node => node.src), ['new.png']);
});

test('a chapter selected while another background loads supersedes the old pending chapter', async () => {
  const ready = new Set(), pending = new Map(), prepared = [];
  const ctx = vm.createContext({
    active: false, storyTutorialPaused: false, storyImagesReady: true, chapterStartRequest: 0,
    blocking: () => false,
    storyBackgroundForLine: chapter => ({ id: chapter.id }),
    backgroundLoader: { has: id => ready.has(id), load: scene => new Promise(resolve => pending.set(scene.id, () => { ready.add(scene.id); resolve(); })) },
    document: { getElementById: () => null }, ARCHIVE_ID: 'archive',
    prepareStoryScene: chapter => prepared.push(chapter.id), renderLine() {}
  });
  const source = engine.slice(engine.indexOf('  function startChapter('), engine.indexOf('  function nextEligibleChapter()'));
  vm.runInContext(source, ctx);
  ctx.startChapter({ id: 'old' });
  ctx.startChapter({ id: 'new' });
  pending.get('old')(); await settle();
  assert.deepEqual(prepared, []);
  pending.get('new')(); await settle();
  assert.deepEqual(prepared, ['new']);
  assert.equal(ctx.currentChapter.id, 'new');
});

test('backgrounds preserve their node across dialogue, cover the viewport and respect reduced motion', () => {
  assert.match(engine, /if \(backdrop\) el\.prepend\(backdrop\)/);
  assert.match(engine, /story-background-image\{[^}]*width:100%;height:100%;object-fit:cover/);
  assert.match(engine, /@media\(prefers-reduced-motion:reduce\)/);
});
