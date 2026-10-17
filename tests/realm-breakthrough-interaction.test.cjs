const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness() {
  let now = 100, score = 0, id = 0, focused = 0;
  const timers = new Map(), nodes = new Map();
  function target() {
    const listeners = new Map();
    return {
      addEventListener(type, fn, capture) {
        const list = listeners.get(type) || [];
        list.push({ fn, capture }); listeners.set(type, list);
      },
      removeEventListener(type, fn) {
        listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn));
      },
      emit(type, extra = {}) {
        const event = { type, prevented: false, stopped: false,
          preventDefault() { this.prevented = true; },
          stopImmediatePropagation() { this.stopped = true; }, ...extra };
        for (const { fn } of [...(listeners.get(type) || [])]) fn(event);
        return event;
      },
      count(type) { return (listeners.get(type) || []).length; },
      captures(type) { return (listeners.get(type) || []).every(item => item.capture === true); }
    };
  }
  const document = Object.assign(target(), {
    readyState: 'complete', querySelector: () => true,
    getElementById: name => nodes.get(name),
    activeElement: { isConnected: true, focus() { focused++; } },
    body: { appendChild(node) { nodes.set(node.id, node); } },
    createElement() {
      const classes = new Set();
      return { hint: { hidden: true }, classList: { add: name => classes.add(name), contains: name => classes.has(name) },
        setAttribute() {}, focus() {}, querySelector() { return this.hint; },
        remove() { if (nodes.get(this.id) === this) nodes.delete(this.id); } };
    }
  });
  const parentDocument = target();
  const window = Object.assign(target(), {
    parent: { document: parentDocument }, getCurrentUserData: () => ({stats:{totalScore:score}}),
    limitImmortalRank: i => i, dispatchEvent() {}
  });
  vm.runInNewContext(read('public/cultivation/realm-breakthrough-feedback.js'), {
    window, document, navigator: {}, Date: { now: () => now },
    CustomEvent: class {}, setInterval() {},
    setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { document, window, parentDocument, timers,
    overlay: () => nodes.get('realm-breakthrough-feedback'),
    focused: () => focused, time(value) { now = value; },
    runDue() {
      for (const [key, item] of [...timers]) if (item.at <= now) { timers.delete(key); item.fn(); }
    },
    advance(value) { now = value; this.runDue(); },
    trigger(value) { score = value; window.emit('xiuxian:stats-updated'); }
  };
}

test('breakthrough blocks early taps, reveals at one second, then accepts the card itself', () => {
  const h = harness();
  h.trigger(1);
  const overlay = h.overlay();
  assert.equal(overlay.hint.hidden, true);
  h.time(1099);
  const early = h.document.emit('click', { target: { className: 'realm-breakthrough-card' } });
  assert.equal(early.prevented && early.stopped, true);
  assert.equal(overlay.classList.contains('leaving'), false);
  h.advance(1100);
  assert.equal(overlay.hint.hidden, false);
  assert.match(overlay.innerHTML, /按任何地方以繼續/);
  const tap = h.document.emit('click', { target: { className: 'realm-breakthrough-card' } });
  assert.equal(tap.prevented && tap.stopped, true);
  h.advance(1360);
  assert.equal(h.overlay(), undefined);
  assert.equal(h.document.count('click'), 0);
  assert.equal(h.parentDocument.count('click'), 0);
  assert.equal(h.focused(), 1);
});

test('late timers do not add waiting time, and black stage margins accept the first tap', () => {
  const h = harness();
  h.trigger(10);
  h.time(8100); // No frames or timer callbacks ran while the browser was suspended.
  assert.equal(h.overlay().hint.hidden, true);
  assert.equal(h.parentDocument.captures('click'), true);
  const tap = h.parentDocument.emit('click', { target: { id: 'game-stage' } });
  assert.equal(tap.stopped, true);
  assert.equal(h.overlay().hint.hidden, false);
  assert.equal(h.overlay().classList.contains('leaving'), true);
  h.advance(8360);
  assert.equal(h.overlay(), undefined);
});

test('a breakthrough waits indefinitely for input and resume reveals the continue hint', () => {
  const h = harness();
  h.trigger(1);
  h.time(60000);
  h.document.emit('visibilitychange');
  assert.equal(h.overlay().hint.hidden, false);
  h.runDue();
  assert.ok(h.overlay());
  assert.equal(h.overlay().classList.contains('leaving'), false);
});

test('a replaced breakthrough resolves only its own promise and removes obsolete listeners', async () => {
  const h = harness();
  const first = h.window.showFirstQiBreakthrough();
  await Promise.resolve();
  h.advance(1100);
  h.document.emit('click');
  h.time(1200);
  h.trigger(10); // Replace during the old modal fade-out.
  const second = h.overlay();
  await first;
  h.advance(1360);
  assert.equal(h.overlay(), second);
  assert.equal(second.hint.hidden, true);
  assert.equal(h.document.count('click'), 1);
  assert.equal(h.parentDocument.count('click'), 1);
  h.advance(2200);
  h.document.emit('keydown', { key: 'Enter' });
  h.advance(2460);
  assert.equal(h.overlay(), undefined);
});

test('mobile styles preserve authored animation durations for cards and breakthrough effects', () => {
  const css = read('public/style.css');
  assert.doesNotMatch(css, /\*\s*\{\s*animation-duration:\s*0?\.5s\s*!important/);
  assert.match(read('public/realm-breakthrough-feedback.css'), /realmBreakthroughRays 14s linear infinite/);
  assert.match(read('public/realm-icons.css'), /var\(--realm-entry-time\)/);
});
