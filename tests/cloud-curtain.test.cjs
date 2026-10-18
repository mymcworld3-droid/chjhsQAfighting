const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/main-legacy.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}
function coordinator() {
  const curtains = [], waits = [], holds = [], events = [], body = { classList: classes() };
  const context = {
    window: { matchMedia: () => ({ matches: false }) }, document: { body },
    preloadStartupCloudImages: async () => {},
    ensureStartupCloudCurtain: () => {
      const curtain = { classList: classes(), style: { removeProperty() {} }, remove() { this.removed = true; } };
      curtains.push(curtain); return curtain;
    },
    nextStartupFrame: async () => { events.push('paint'); },
    waitForStartupCloudTransform: curtain => new Promise(resolve => waits.push({ curtain, resolve })),
    waitStartupTransition: ms => new Promise(resolve => holds.push({ ms, resolve }))
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('let startupCloudTransitionPromise'), source.indexOf('async function enterHomeWithStartupCloudCurtain()')), context);
  return { play: context.window.playStartupCloudCurtain, curtains, waits, holds, events, body };
}

test('clouds finish closing and paint a fully covered frame before navigation, then hold before opening', async () => {
  const h = coordinator();
  let navigated = false;
  const result = h.play(() => { navigated = true; h.events.push('navigate'); }, { blockInput: true });
  await flush();
  assert.equal(h.curtains.length, 1);
  assert.equal(h.curtains[0].classList.contains('is-closing'), true);
  assert.equal(navigated, false);
  h.waits[0].resolve(); await flush();
  assert.equal(navigated, true);
  assert.equal(h.curtains[0].classList.contains('is-closed'), true);
  assert.equal(h.curtains[0].classList.contains('is-opening'), false);
  assert.equal(h.curtains[0].style.backgroundColor, '#d9e3dc');
  assert.ok(h.events.indexOf('navigate') > h.events.indexOf('paint'));
  assert.equal(h.holds[0].ms, 180);
  h.holds[0].resolve(); await flush();
  assert.equal(h.curtains[0].classList.contains('is-opening'), true);
  assert.equal(h.curtains[0].removed, undefined);
  h.waits[1].resolve();
  assert.equal(await result, true);
  assert.equal(h.curtains[0].removed, true);
  assert.equal(h.body.classList.contains('training-cloud-navigating'), false);
});

test('another caller cannot reset a curtain in flight, and stale queued navigation is discarded', async () => {
  const h = coordinator();
  let current = true, secondNavigation = false;
  const first = h.play(() => {});
  const second = h.play(() => { secondNavigation = true; }, { isCurrent: () => current });
  await flush();
  assert.equal(h.curtains.length, 1);
  current = false;
  h.waits[0].resolve(); await flush();
  h.holds[0].resolve(); await flush();
  assert.equal(h.curtains.length, 1);
  h.waits[1].resolve();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(secondNavigation, false);
  assert.equal(h.curtains.length, 1);
});

test('zero-hold training curtain opens immediately when the destination is ready', async () => {
  const h = coordinator();
  let ready;
  const prepared = new Promise(resolve => { ready = resolve; });
  const result = h.play(() => prepared, { blockInput: true, holdMs: 0 });
  await flush();
  h.waits[0].resolve(); await flush();
  assert.equal(h.curtains[0].classList.contains('is-closed'), true);
  assert.equal(h.curtains[0].classList.contains('is-opening'), false);
  assert.deepEqual(h.holds, []);
  ready(); await flush();
  assert.equal(h.curtains[0].classList.contains('is-opening'), true);
  assert.deepEqual(h.holds, [], 'no fixed sleep is added after destination readiness');
  h.waits[1].resolve();
  assert.equal(await result, true);
});

test('a destination error releases the curtain and input lock so the next transition can run', async () => {
  const h = coordinator();
  const result = h.play(() => { throw Error('render failed'); }, { blockInput: true });
  const rejected = assert.rejects(result, /render failed/);
  await flush(); h.waits[0].resolve(); await rejected;
  assert.equal(h.curtains[0].removed, true);
  assert.equal(h.body.classList.contains('training-cloud-navigating'), false);
  const next = h.play(() => {}, { isCurrent: () => false });
  assert.equal(await next, false);
});

test('closing waits for both cloud banks; a missing event forces its endpoint before resolving', async () => {
  const timers = new Map(); let timerId = 0;
  const halves = [0, 1].map(() => {
    let listener;
    return {
      style: { transition: '' }, forced: false,
      addEventListener: (_name, fn) => { listener = fn; },
      removeEventListener() {},
      getBoundingClientRect() { this.forced = this.style.transition === 'none'; },
      end(propertyName = 'transform') { listener({ target: this, propertyName }); }
    };
  });
  const context = {
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function waitForStartupCloudTransform('), source.indexOf('function nextStartupFrame()')), context);
  let finished = false;
  const wait = context.waitForStartupCloudTransform({ querySelectorAll: () => halves }).then(() => { finished = true; });
  halves[0].end('opacity'); await flush();
  assert.equal(finished, false);
  halves[0].end(); await flush();
  assert.equal(finished, false);
  [...timers.values()][0](); await wait;
  assert.equal(halves[1].forced, true);
  assert.equal(halves[1].style.transition, '');
  assert.equal(timers.size, 0);
});
