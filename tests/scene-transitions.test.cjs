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
    animate(frames, options) {
      const effect = { frames, options, canceled: false, finished: new Promise(() => {}), cancel() { this.canceled = true; } };
      animations.push(effect);
      return effect;
    }
  }
  const context = {
    window: {}, Element,
    document: { hidden: false, createElement: () => new Element(), body: { appendChild: layer => layers.push(layer) } },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../public/cultivation/scene-transitions.js'), 'utf8').replace(/export /g, '');
  vm.runInContext(source, context);
  return { begin: context.window.beginSceneTransition, layers, animations, target: new Element(), reduce: () => { reduced = true; }, timers };
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
  assert.equal(h.animations.length, 2);
  assert.equal(h.layers[1].dataset.sceneTransition, 'raid');
  assert.equal(h.target.style.transform, undefined);
  assert.equal(h.target.style.pointerEvents, undefined);
});

test('initial combat phase does not stack another effect above page navigation', () => {
  const h = harness();
  h.begin(null, h.target, 'sword')();
  h.begin(null, h.target, 'scroll', 'battle-phase')();
  assert.equal(h.layers.length, 1);
  assert.equal(h.animations.length, 2);
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
