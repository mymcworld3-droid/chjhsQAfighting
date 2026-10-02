const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const layers = [], animations = [], timers = new Map();
  let reduced = false, timerId = 0;
  function classes() {
    const set = new Set();
    return { add: name => set.add(name), remove: name => set.delete(name), contains: name => set.has(name) };
  }
  class Element {
    constructor(id = '') { this.id = id; this.style = { willChange: '' }; this.dataset = {}; this.classList = classes(); }
    setAttribute() {}
    contains(node) { return node === this; }
    cloneNode() { throw Error('Page cloning must never happen'); }
    remove() { this.removed = true; }
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return { width: 1200, height: 800, top: 70 }; }
    animate(frames, options) {
      const animation = { target: this, frames, options, canceled: false, finished: new Promise(() => {}), cancel() { this.canceled = true; } };
      animations.push(animation);
      return animation;
    }
  }
  const nav = new Element('bottom-nav'), body = { classList: classes(), appendChild: layer => layers.push(layer) };
  const context = {
    window: {}, Element, innerWidth: 1200, innerHeight: 900,
    document: { hidden: false, querySelector: () => ({ getBoundingClientRect: () => ({ top: 800, height: 72 }) }), getElementById: () => nav, createElement: () => new Element(), body },
    getComputedStyle: () => ({ transform: 'none' }),
    matchMedia: () => ({ matches: reduced }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../public/cultivation/scene-transitions.js'), 'utf8').replace(/export /g, '');
  vm.runInContext(source, context);
  return { direction: context.sceneDirection, begin: context.window.beginSceneTransition, layers, animations, target: new Element(), nav, body, reduce: () => { reduced = true; }, timers };
}

test('animate the real destination across its width without cloning a page or stylesheet', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud')();
  assert.equal(h.animations[0].target, h.target);
  assert.equal(h.animations[0].frames[0].transform, 'translate3d(1200px,0,0)');
  assert.equal(h.animations[0].frames[1].transform, 'translate3d(0,0,0)');
  assert.equal(h.layers.length, 1); // Only the empty accent.
  assert.equal(h.target.style.transform, undefined);
  assert.equal(h.target.style.pointerEvents, undefined);
});

test('rapid navigation cancels obsolete motion and an obsolete renderer cannot restart it', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud')();
  const stale = h.begin(null, h.target, 'sword');
  const latest = h.begin(null, h.target, 'raid');
  stale();
  assert.equal(h.animations.length, 2);
  assert.ok(h.animations.every(a => a.canceled));
  latest(); latest();
  assert.equal(h.animations.length, 4);
  assert.equal(h.layers[0].removed, true);
  assert.equal(h.layers[1].dataset.sceneTransition, 'raid');
});

test('initial combat phases do not stack motion above page navigation', () => {
  const h = harness();
  h.begin(null, h.target, 'sword')();
  h.begin(null, h.target, 'scroll', 'battle-phase')();
  assert.equal(h.animations.length, 2);
});

test('same-scene polling is quiet and reduced motion cancels a pending animation', () => {
  const h = harness();
  h.begin(h.target, h.target, 'raid', 'raid-phase')();
  assert.equal(h.animations.length, 0);
  h.begin(null, h.target, 'raid')();
  h.reduce(); h.begin(null, h.target, 'scroll')();
  assert.ok(h.animations.every(a => a.canceled));
  assert.equal(h.timers.size, 0);
  assert.equal(h.body.classList.contains('scene-page-sliding'), false);
});

test('return journeys slide in from the left', () => {
  const h = harness();
  h.begin(null, h.target, 'scroll', 'page', false, -1)();
  assert.equal(h.animations[0].frames[0].transform, 'translate3d(-1200px,0,0)');
});

test('navigation stays stationary and outside the accent layer', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud')();
  assert.ok(h.body.classList.contains('scene-page-sliding'));
  assert.equal(h.layers[0].style.cssText.includes('bottom:100px'), true);
  assert.equal(h.animations.some(a => a.target === h.nav), false);
  for (const fn of [...h.timers.values()]) fn();
  assert.equal(h.body.classList.contains('scene-page-sliding'), false);
  assert.equal(h.body.classList.contains('scene-motion-active'), false);
  assert.equal(h.target.style.willChange, '');
  assert.equal(h.target.classList.contains('scene-content-moving'), false);
});

test('a removed destination or navigation itself cannot be animated', () => {
  const h = harness();
  h.target.getClientRects = () => [];
  h.begin(null, h.target)();
  h.begin(null, h.nav)();
  assert.equal(h.animations.length, 0);
  assert.equal(h.body.classList.contains('scene-page-sliding'), false);
});

test('direction follows navigation order and fullscreen return', () => {
  const h = harness();
  assert.equal(h.direction({id:'page-store'}, {id:'page-settings'}), 1);
  assert.equal(h.direction({id:'page-settings'}, {id:'page-store'}), -1);
  assert.equal(h.direction({id:'cs-stage-2'}, {id:'cs-stage-1'}), -1);
  assert.equal(h.direction(h.target, h.target, 'scope-close'), -1);
});

test('closing a fullscreen scene is not interrupted by its destination navigation', () => {
  const h = harness();
  h.begin(null, h.target, 'cloud', 'dongtian-close')();
  h.begin(null, h.target, 'cloud', 'page')();
  assert.equal(h.animations.length, 2);
  assert.equal(h.animations[0].canceled, false);
});
