const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const layers = [], animations = [], timers = new Map();
  let reduced = false, timerId = 0;
  const bodyClasses = new Set();
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; }
    setAttribute() {}
    appendChild(child) { this.children.push(child); }
    remove() { this.removed = true; }
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { width: 0, height: 0 }; }
    animate(frames, options) {
      const effect = { frames, options, canceled: false, finished: new Promise(() => {}), cancel() { this.canceled = true; } };
      animations.push(effect);
      return effect;
    }
  }
  const context = {
    window: {}, Element, innerWidth: 1200, innerHeight: 900,
    document: { hidden: false, querySelector: () => null, getElementById: () => null, createElement: () => new Element(), body: { classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) }, appendChild: layer => layers.push(layer) } },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../public/cultivation/scene-transitions.js'), 'utf8').replace(/export /g, '');
  vm.runInContext(source, context);
  return { context, bodyClasses, nav: top => { context.document.querySelector = () => ({ getBoundingClientRect: () => ({ top, width: 600, height: 72 }) }); }, direction: context.sceneDirection, begin: context.window.beginSceneTransition, layers, animations, target: new Element(), reduce: () => { reduced = true; }, timers };
}

test('rapid navigation removes the previous effect and an obsolete render cannot restart it', () => {
  const h = harness();
  const staleFinish = h.begin(null, h.target, 'sword');
  const latestFinish = h.begin(null, h.target, 'raid');
  staleFinish();
  assert.equal(h.animations.length, 0);
  assert.equal(h.layers[0].removed, true);
  latestFinish();
  latestFinish();
  assert.equal(h.animations.length, 3);
  assert.equal(h.layers[1].dataset.sceneTransition, 'raid');
  assert.equal(h.target.style.transform, undefined);
  assert.equal(h.target.style.pointerEvents, undefined);
});

test('initial combat phase does not stack another effect above page navigation', () => {
  const h = harness();
  h.begin(null, h.target, 'sword')();
  h.begin(null, h.target, 'scroll', 'battle-phase')();
  assert.equal(h.layers.length, 1);
  assert.equal(h.animations.length, 3);
});

test('same-scene polling is quiet and reduced motion clears a pending effect', () => {
  const h = harness();
  h.begin(h.target, h.target, 'raid', 'raid-phase')();
  assert.equal(h.layers.length, 0);
  h.begin(null, h.target, 'raid')();
  h.reduce();
  h.begin(null, h.target, 'scroll')();
  assert.equal(h.layers.length, 1);
  assert.equal(h.layers[0].removed, true);
  assert.ok(h.animations.every(effect => effect.canceled));
  assert.equal(h.timers.size, 0);
});

test('closing a fullscreen scene remains visible while its destination changes', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud', 'dongtian-close')();
  h.begin(null, h.target, 'cloud', 'page')();
  assert.equal(h.layers.length, 1);
  assert.equal(h.layers[0].removed, undefined);
});


test('navigation slides both copies in opposite directions and never transforms live controls', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud', 'page', false, 1)();
  assert.equal(h.animations[0].frames[1].transform, 'translate3d(-1200px,0,0)');
  assert.equal(h.animations[1].frames[0].transform, 'translate3d(1200px,0,0)');
  assert.equal(h.animations[1].frames[1].transform, 'translate3d(0,0,0)');
  assert.equal(h.target.style.transform, undefined);
  h.begin(null, h.target, 'scroll', 'page', false, -1)();
  assert.equal(h.animations[3].frames[1].transform, 'translate3d(1200px,0,0)');
  assert.equal(h.animations[4].frames[0].transform, 'translate3d(-1200px,0,0)');
  assert.equal(h.layers[0].removed, true);
});

test('direction follows navigation order, curriculum steps and fullscreen return', () => {
  const h = harness();
  assert.equal(h.direction({ id: 'page-store' }, { id: 'page-settings' }), 1);
  assert.equal(h.direction({ id: 'page-settings' }, { id: 'page-store' }), -1);
  assert.equal(h.direction({ id: 'cs-stage-2' }, { id: 'cs-stage-1' }), -1);
  assert.equal(h.direction({ id: 'raid-arena' }, { id: 'raid-question' }), 1);
  assert.equal(h.direction(h.target, h.target, 'scope-close'), -1);
});


test('page slides leave fixed navigation outside the overlay and release visibility on cleanup', () => {
  const h = harness();
  h.nav(800);
  const finish = h.begin(null, h.target, 'cloud');
  assert.ok(h.bodyClasses.has('scene-page-sliding'));
  assert.equal(h.layers[0].style.clipPath, 'inset(0px 0px 100px 0px)');
  finish();
  assert.equal(h.layers[0].style.clipPath, 'inset(0px 0px 100px 0px)');
  assert.equal(h.animations[0].options.duration, 300);
  for (const cleanup of [...h.timers.values()]) cleanup();
  assert.equal(h.bodyClasses.has('scene-page-sliding'), false);
  assert.equal(h.layers[0].removed, true);
});

test('fast navigation keeps the visibility flag until the latest slide ends', () => {
  const h = harness();
  const stale = h.begin(null, h.target, 'cloud');
  h.begin(null, h.target, 'alchemy')();
  stale();
  assert.ok(h.bodyClasses.has('scene-page-sliding'));
  assert.equal(h.layers[0].removed, true);
  assert.equal(h.layers[1].removed, undefined);
});

test('snapshot styles are parsed once and refreshed only when their source changes', () => {
  const h = harness();
  let parses = 0, clones = 0;
  class Sheet { replaceSync() { parses++; } }
  h.context.CSSStyleSheet = Sheet;
  const owner = { tagName: 'STYLE', textContent: 'a{color:red}', sheet: { cssRules: [{ cssText: 'a{color:red}' }] }, cloneNode() { clones++; } };
  h.context.document.querySelectorAll = () => [owner];
  const first = { adoptedStyleSheets: [], appendChild() {} };
  const second = { adoptedStyleSheets: [], appendChild() {} };
  h.context.installSnapshotStyles(first);
  h.context.installSnapshotStyles(second);
  assert.equal(parses, 1);
  assert.equal(clones, 0);
  assert.equal(first.adoptedStyleSheets[0], second.adoptedStyleSheets[0]);
  owner.textContent = 'a{color:blue}';
  h.context.installSnapshotStyles(second);
  assert.equal(parses, 2);
});


test('subview slides also leave visible navigation outside the moving background', () => {
  const h = harness();
  h.nav(800);
  h.begin(null, h.target, 'alchemy', 'market-view')();
  assert.equal(h.layers[0].style.clipPath, 'inset(0px 0px 100px 0px)');
  assert.equal(h.bodyClasses.has('scene-page-sliding'), false);
});
