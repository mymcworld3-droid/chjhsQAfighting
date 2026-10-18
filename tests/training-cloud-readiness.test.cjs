const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/cultivation/training-scene-map.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture() {
  let current = 'page-home', uid = 'u1', fitCalls = 0;
  const clouds = [], loads = [], home = {}, training = {}, timers = [];
  const window = {
    switchToPage(id) { current = id; return id; },
    playStartupCloudCurtain(onClosed, options) {
      let finish;
      const promise = new Promise(resolve => { finish = resolve; });
      clouds.push({ onClosed, options, finish, promise });
      return promise;
    }
  };
  Object.defineProperty(window, 'location', { get() { throw Error('No document navigation'); } });
  const context = {
    window, console, PAGE: 'page-training', page: { isConnected: true }, navigation: null,
    navigationRevision: 0, entryCheck: 0, pageNavigation: null, committingPageNavigation: false,
    innerWidth: 390, innerHeight: 844, getMainUser: () => ({ uid }),
    visible: () => current === 'page-training', reducedMotion: () => false,
    document: { hidden: false, getElementById: () => null,
      querySelector: () => current === 'page-training' ? training : home },
    markTrainingEntry() {}, markTrainingStable() {}, markTrainingExit() {},
    setTimeout(fn, ms) { timers.push(ms); return timers.length; }, clearTimeout() {},
    showMap() { context.navigationRevision++; }, fit() { fitCalls++; },
    Rules: { PLACES: [] },
    preloadTrainingSceneAssets(orientation) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      loads.push({ orientation, resolve });
      return promise;
    }
  };
  vm.createContext(context);
  const start = source.indexOf('function wrapNavigation() {');
  vm.runInContext(source.slice(start, source.indexOf('\nfunction sync() {', start)) + '\nwrapNavigation();', context);
  return { window, context, clouds, loads, timers,
    current: () => current, fits: () => fitCalls, account(value) { uid = value; } };
}

test('cloud navigation preloads during closing, shares rapid taps, and waits only for actual assets', async () => {
  const h = fixture();
  const first = h.window.switchToPage('page-training');
  assert.equal(h.loads.length, 1, 'preloading starts before the cloud has closed');
  assert.equal(h.loads[0].orientation, 'portrait');
  assert.equal(h.current(), 'page-home');
  assert.equal(h.window.switchToPage('page-training'), first);
  assert.equal(h.clouds.length, 1);
  assert.equal(h.clouds[0].options.holdMs, 0);
  assert.equal(h.clouds[0].options.blockInput, true);
  let ready = false;
  const closed = h.clouds[0].onClosed().then(() => { ready = true; });
  await flush();
  assert.equal(h.current(), 'page-training');
  assert.equal(ready, false);
  assert.equal(h.window.switchToPage('page-training'), first, 'taps during loading do not reset the curtain');
  h.loads[0].resolve(); await closed;
  assert.equal(ready, true);
  assert.equal(h.fits(), 1);
  assert.deepEqual(h.timers, [15000], 'only the existing renderer-stability timer is scheduled');
  h.clouds[0].finish(true);
  assert.equal(await first, true);
});

test('rotation during closing prepares the new layout without adding a fixed delay', async () => {
  const h = fixture();
  const result = h.window.switchToPage('page-training');
  h.context.innerWidth = 1280; h.context.innerHeight = 720;
  const closed = h.clouds[0].onClosed();
  h.loads[0].resolve(); await flush();
  assert.equal(h.loads[1].orientation, 'landscape');
  assert.equal(h.fits(), 0);
  h.loads[1].resolve(); await closed;
  assert.equal(h.fits(), 1);
  h.clouds[0].finish(true); await result;
});

test('leaving the source or changing account invalidates a queued cloud navigation', async () => {
  for (const cancel of [h => h.window.switchToPage('page-store'), h => h.account('u2')]) {
    const h = fixture();
    const result = h.window.switchToPage('page-training');
    assert.equal(h.clouds[0].options.isCurrent(), true);
    cancel(h);
    assert.equal(h.clouds[0].options.isCurrent(), false);
    h.loads[0].resolve(); h.clouds[0].finish(false);
    assert.equal(await result, false);
    assert.notEqual(h.current(), 'page-training');
  }
});

test('scene readiness waits for decoding, deduplicates images, and retries a failed asset', async () => {
  const images = [];
  class Image {
    constructor() { this.handlers = new Map(); this.complete = false; images.push(this); }
    addEventListener(type, fn) { this.handlers.set(type, fn); }
    removeEventListener(type) { this.handlers.delete(type); }
    decode() { return this.decoded = new Promise(resolve => { this.finishDecode = resolve; }); }
    finish(ok = true) { this.naturalWidth = ok ? 100 : 0; this.handlers.get(ok ? 'load' : 'error')(); }
  }
  const context = { Image, sceneImageLoads: new Map(), trainingRenderProfile: () => 'balanced',
    Layouts: { portrait: { image: 'plate.webp', layers: [{image:'cloud.webp'}],
      places: { a: {sprite:{image:'building.webp'}}, b: {sprite:{image:'building.webp'}} } } } };
  vm.createContext(context);
  const start = source.indexOf('function preloadTrainingSceneAssets(');
  vm.runInContext(source.slice(start, source.indexOf('\nfunction renderScene(', start)), context);
  let ready = false;
  const first = context.preloadTrainingSceneAssets('portrait').then(() => { ready = true; });
  const second = context.preloadTrainingSceneAssets('portrait');
  assert.equal(images.length, 3, 'duplicate building URLs and repeat visits share loading');
  images.forEach((image, i) => image.finish(i !== 1));
  await flush();
  assert.equal(ready, false, 'load alone is insufficient until the image has decoded');
  images.forEach(image => image.finishDecode());
  await first; await second;
  assert.equal(ready, true, 'a failed asset can finish without trapping the curtain');
  const retry = context.preloadTrainingSceneAssets('portrait');
  assert.equal(images.length, 4);
  assert.equal(images[3].src, 'cloud.webp');
  images[3].finish(); await flush(); images[3].finishDecode(); await retry;
});
