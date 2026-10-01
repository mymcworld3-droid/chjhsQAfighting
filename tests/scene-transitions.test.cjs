const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const layers = [], animations = [], timers = new Map();
  let reduced = false, timerId = 0;
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
    window: {}, Element, innerWidth: 1200,
    document: { hidden: false, createElement: () => new Element(), body: { appendChild: layer => layers.push(layer) } },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../public/cultivation/scene-transitions.js'), 'utf8').replace(/export /g, '');
  vm.runInContext(source, context);
  return { direction: context.sceneDirection, begin: context.window.beginSceneTransition, layers, animations, target: new Element(), reduce: () => { reduced = true; }, timers };
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
