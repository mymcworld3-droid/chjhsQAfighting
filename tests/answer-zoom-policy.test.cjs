const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const source = read('answer-zoom-policy.js');
const pageQuestions = [
  '#page-quiz.active-page #quiz-container:not(.hidden)',
  '#page-battle.active-page #bv2-quiz:not(.hidden)',
  '#page-raid.active-page #raid-question:not(.hidden)'
];
const overlayQuestions = [
  ['#opportunity-overlay', '.op-workspace'],
  ['#dongtian-overlay', '.dt-question'],
  ['#daily-meditation-overlay', '#dm-question'],
  ['#five-immortal-challenge', '.fi-question']
];

function element() {
  return {
    hidden: false, laidOut: true, children: new Map(),
    closest() { return this.hidden ? {} : null; },
    getClientRects() { return this.laidOut ? [{}] : []; },
    querySelector(selector) { return this.children.get(selector) || null; }
  };
}

function setup({ scale = 1, visualViewport = true } = {}) {
  const elements = new Map(), frames = new Map(), writes = [], notifications = [];
  const classes = new Set(), listeners = new Map(), styles = new Map();
  let content = 'width=device-width, initial-scale=1', frameId = 0, observer;
  const viewport = {
    getAttribute: () => content,
    setAttribute: (_, value) => { content = value; writes.push(value); }
  };
  const register = target => (type, fn, options) => {
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push({ fn, options });
  };
  const document = {
    hidden: false, body: {},
    documentElement: {
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) }
    },
    querySelector: selector => selector === 'meta[name="viewport"]' ? viewport : elements.get(selector) || null,
    querySelectorAll: selector => selector.split(',').map(part => elements.get(part.trim())).filter(Boolean),
    addEventListener: register('document')
  };
  const window = {
    addEventListener: register('window'),
    dispatchEvent: event => notifications.push(event.detail.allowed)
  };
  if (visualViewport) window.visualViewport = { scale, addEventListener: register('viewport') };
  const context = {
    window, document,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class {
      constructor(fn) { observer = this; this.fn = fn; }
      observe(target, options) { this.target = target; this.options = options; }
    },
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id)
  };
  vm.runInNewContext(source, context);
  return {
    elements, classes, writes, notifications, listeners, document, window,
    get scale() { return Number(styles.get('--app-answer-zoom') || 1); },
    get content() { return content; }, get observer() { return observer; },
    get pendingFrames() { return frames.size; },
    sync: () => observer.fn(),
    allowed: () => window.isAnswerZoomAllowed(),
    add(selector) { const el = element(); elements.set(selector, el); return el; },
    question(selector = pageQuestions[0]) { this.add(selector); this.sync(); this.frame(); },
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    emit(target, type, properties = {}) {
      const event = { cancelable: true, touches: [], prevented: false, preventDefault() { this.prevented = true; }, ...properties };
      for (const { fn } of listeners.get(`${target}:${type}`) || []) fn(event);
      return event;
    }
  };
}

test('the initial view is locked before the app starts and the policy is cache-versioned', () => {
  const h = setup();
  assert.equal(h.allowed(), false);
  assert.ok(h.classes.has('app-zoom-locked'));
  assert.match(h.content, /initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no/);
  const index = read('index.html');
  assert.match(index, /<html[^>]*class="app-zoom-locked"/);
  assert.match(index, /<meta name="viewport"[^>]*maximum-scale=1, user-scalable=no/);
  assert.ok(index.indexOf('answer-zoom-policy.js') < index.indexOf('main.js?'));
  assert.ok(JSON.parse(read('module-versions.json')).files['answer-zoom-policy.js']);
});

test('solo, duel and raid questions allow zoom; loading, combat and results do not', () => {
  for (const selector of pageQuestions) {
    const h = setup();
    h.question(selector);
    assert.equal(h.allowed(), true, selector);
    assert.match(h.content, /maximum-scale=1, user-scalable=no/, 'native zoom stays locked; the app owns question scale');
    assert.ok(!h.classes.has('app-zoom-locked'));
    h.elements.delete(selector);
    h.sync();
    assert.equal(h.allowed(), false, 'no visible question');
    assert.match(h.content, /maximum-scale=1, user-scalable=no/);
  }
});

test('question zoom changes the rendered scale even when the native viewport reports one', () => {
  const h = setup(); h.add(pageQuestions[0]); h.sync();
  assert.equal(h.allowed(), true);
  assert.equal(h.emit('document', 'keydown', { metaKey: true, key: '+' }).prevented, true);
  assert.equal(h.scale, 1.2);
  assert.equal(h.window.visualViewport.scale, 1);
  h.elements.clear(); h.sync(); h.frame();
  assert.equal(h.scale, 1, 'leaving actually clears the enlarged contents');
  assert.match(h.content, /maximum-scale=1, user-scalable=no/);
});

test('all four overlay trials permit questions and lock their offer, loading and result views', () => {
  for (const [overlaySelector, questionSelector] of overlayQuestions) {
    const h = setup();
    h.question(); // Simulate opening a trial over an existing solo question.
    const overlay = h.add(overlaySelector);
    h.sync();
    assert.equal(h.allowed(), false, `${overlaySelector} without a question`);
    overlay.children.set(questionSelector, element());
    h.sync();
    assert.equal(h.allowed(), true, `${overlaySelector} question`);
    overlay.children.clear();
    h.sync();
    assert.equal(h.allowed(), false, `${overlaySelector} result overrides the underlying quiz`);
    h.elements.delete(overlaySelector);
    h.sync();
    assert.equal(h.allowed(), true, 'closing the trial returns to the question');
  }
});

test('raid loading replaces the question in the same container and clears its scale', () => {
  const h = setup(); h.question(pageQuestions[2]);
  h.emit('document', 'keydown', { ctrlKey: true, key: '+' });
  assert.equal(h.scale, 1.2);
  const container = h.elements.get(pageQuestions[2]);
  container.children.set('.raid-loading', element()); h.sync();
  assert.equal(h.allowed(), false);
  assert.equal(h.scale, 1);
  container.children.clear(); h.sync();
  assert.equal(h.allowed(), true);
  assert.equal(h.scale, 1);
});

test('hidden questions and hidden parents never enable zoom', () => {
  for (const hide of [el => { el.hidden = true; }, el => { el.laidOut = false; }]) {
    const h = setup(), q = h.add(pageQuestions[0]);
    hide(q);
    h.sync();
    assert.equal(h.allowed(), false);
    q.hidden = false; q.laidOut = true;
    const overlay = h.add('#daily-meditation-overlay');
    overlay.children.set('#dm-question', element());
    hide(overlay);
    h.sync();
    assert.equal(h.allowed(), true, 'hidden overlays do not override a visible quiz');
    overlay.hidden = false; overlay.laidOut = true;
    hide(overlay.children.get('#dm-question'));
    h.sync();
    assert.equal(h.allowed(), false, 'visible overlay with hidden question is locked');
  }
});

test('login, stories, tutorials and dialogs lock zoom even over a visible question', () => {
  for (const selector of [
    '#login-screen:not(.hidden)', '#page-onboarding:not(.hidden)', '#game-startup-gate',
    '#xiuxian-opening-cinematic', '#xiuxian-story-layer', '#xiuxian-story-archive',
    '#newbie-tutorial-layer', '#golden-core-tutorial-layer', '#qi-five-dongtian-tutorial-layer',
    '#battle-tutorial-layer.bt-final-mode', '#report-modal:not(.hidden)',
    '#custom-confirm-modal:not(.hidden)', '.uib-modal-backdrop', '.dt-modal', '#realm-breakthrough-feedback',
    '#scope-studio', '#admin-product-editor', '.xpp-backdrop', '.op-confirm',
    '[role="dialog"]:not(.fi-modal):not(#quiz-whiteboard-panel)',
    '[aria-modal="true"]:not(.fi-modal):not(#quiz-whiteboard-panel)'
  ]) {
    const h = setup(); h.question();
    const blocker = h.add(selector);
    h.sync();
    assert.equal(h.allowed(), false, selector);
    blocker.hidden = true;
    h.sync();
    assert.equal(h.allowed(), true, 'hidden dialog is ignored');
  }
});

test('locked views block pinch, Safari gestures, modifier wheel and zoom keys only', () => {
  const h = setup();
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(h.emit('document', type, { touches: [{}, {}] }).prevented, true);
    assert.equal(h.emit('document', type, { touches: [{}] }).prevented, false, 'one-finger scrolling');
    assert.equal(h.listeners.get(`document:${type}`)[0].options.passive, false);
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) assert.ok(h.emit('document', type).prevented);
  assert.ok(h.emit('document', 'wheel', { ctrlKey: true }).prevented);
  assert.ok(h.emit('document', 'wheel', { metaKey: true }).prevented);
  assert.equal(h.emit('document', 'wheel').prevented, false);
  for (const key of ['+', '=', '-', '_', 'Add', 'Subtract']) assert.ok(h.emit('document', 'keydown', { ctrlKey: true, key }).prevented);
  for (const key of ['0', 'c', 'v', 'Tab']) assert.equal(h.emit('document', 'keydown', { ctrlKey: true, key }).prevented, false);
  assert.equal(h.emit('document', 'keydown', { key: '+' }).prevented, false);
  assert.equal(h.emit('document', 'gesturechange', { cancelable: false }).prevented, false);
});

test('answer gestures are app-controlled; leaving is enforced before the observer callback', () => {
  const h = setup(); h.question();
  for (const [type, props] of [['touchmove', { touches: [{}, {}] }], ['gesturechange', {}], ['wheel', { ctrlKey: true }], ['keydown', { metaKey: true, key: '+' }]]) {
    assert.equal(h.emit('document', type, props).prevented, true, type);
  }
  assert.equal(h.scale, 1.2);
  h.elements.clear(); // Deliberately do not flush the mutation observer.
  assert.equal(h.emit('document', 'touchstart', { touches: [{}, {}] }).prevented, true);
  assert.equal(h.allowed(), false);
  assert.equal(h.scale, 1);
});

test('two-finger pinch enlarges, contracts and resets on exit in all question modes', () => {
  const touches = distance => [{ clientX: 0, clientY: 0 }, { clientX: distance, clientY: 0 }];
  for (const selector of pageQuestions) {
    const h = setup(); h.question(selector);
    h.emit('document', 'touchstart', { touches: touches(100) });
    h.emit('document', 'touchmove', { touches: touches(250) });
    assert.equal(h.scale, 2.5, selector);
    h.emit('document', 'touchmove', { touches: touches(150) });
    assert.equal(h.scale, 1.5);
    h.emit('document', 'touchend', { touches: [{}] });
    assert.equal(h.emit('document', 'touchmove', { touches: [{}] }).prevented, false);
    h.elements.clear(); h.sync();
    assert.equal(h.scale, 1);
    h.question(selector);
    assert.equal(h.scale, 1, 'reentry never inherits enlargement');
  }
});

test('Safari gesture scale is relative to gesture start and does not double-count touch events', () => {
  const h = setup(); h.question();
  h.emit('document', 'gesturestart');
  h.emit('document', 'gesturechange', { scale: 2 });
  h.emit('document', 'gesturechange', { scale: 3 });
  assert.equal(h.scale, 3);
  h.emit('document', 'wheel', { ctrlKey: true, deltaY: -50 });
  assert.equal(h.scale, 3, 'Safari wheel during a gesture is not applied twice');
  h.emit('document', 'gestureend');
  h.emit('document', 'touchstart', { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
  h.emit('document', 'touchmove', { touches: [{ clientX: 0, clientY: 0 }, { clientX: 150, clientY: 0 }] });
  h.emit('document', 'gesturestart');
  h.emit('document', 'gesturechange', { scale: 1.5 });
  assert.equal(h.scale, 4.5);
  h.elements.clear(); h.sync();
  assert.equal(h.scale, 1);
});

test('modifier wheel and keys preserve ordinary input, honor limits and reset with zero', () => {
  const h = setup(); h.question();
  h.emit('document', 'wheel', { ctrlKey: true, deltaY: -50, deltaMode: 0 });
  assert.ok(h.scale > 1.6 && h.scale < 1.7);
  h.emit('document', 'wheel', { ctrlKey: true, deltaY: -50, deltaMode: 1 });
  assert.ok(h.scale > 4);
  h.emit('document', 'wheel', { ctrlKey: true, deltaY: -50 });
  assert.equal(h.scale, 5);
  h.emit('document', 'keydown', { ctrlKey: true, key: '-' });
  assert.ok(h.scale < 5);
  assert.equal(h.emit('document', 'keydown', { metaKey: true, key: '0' }).prevented, true);
  assert.equal(h.scale, 1);
  h.emit('document', 'keydown', { ctrlKey: true, key: '-' });
  assert.equal(h.scale, 1);
  assert.equal(h.emit('document', 'wheel', { deltaY: 20 }).prevented, false);
  assert.equal(h.emit('document', 'keydown', { ctrlKey: true, key: 'c' }).prevented, false);
  h.elements.clear(); h.sync();
  assert.equal(h.emit('document', 'keydown', { ctrlKey: true, key: '0' }).prevented, false, 'browser reset remains available outside questions');
});

test('switching question surfaces or opening a blocking dialog always clears magnification', () => {
  const h = setup(); h.question();
  h.emit('document', 'keydown', { ctrlKey: true, key: '+' });
  const overlay = h.add('#daily-meditation-overlay');
  overlay.children.set('#dm-question', element());
  h.sync();
  assert.equal(h.allowed(), true);
  assert.equal(h.scale, 1, 'an overlay question starts at its own original scale');
  h.emit('document', 'keydown', { ctrlKey: true, key: '+' });
  const dialog = h.add('#report-modal:not(.hidden)');
  h.sync();
  assert.equal(h.allowed(), false);
  assert.equal(h.scale, 1);
  dialog.hidden = true; h.sync();
  assert.equal(h.allowed(), true);
  assert.equal(h.scale, 1);
  h.emit('document', 'gesturechange', { scale: 4 });
  assert.equal(h.scale, 1, 'a gesture begun before exit cannot resurrect old scale');
});

test('leaving a magnified question requests original scale and finalizes exactly at one', () => {
  const h = setup(); h.question(); h.window.visualViewport.scale = 2;
  h.elements.clear(); h.sync();
  assert.match(h.content, /initial-scale=1\.0001/);
  assert.equal(h.pendingFrames, 1);
  h.frame();
  assert.match(h.content, /initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.equal(h.pendingFrames, 0);
});

test('answer viewport resizes preserve zoom; reentering cancels a pending reset', () => {
  const h = setup(); h.question(); h.window.visualViewport.scale = 2;
  const before = h.writes.length;
  h.emit('viewport', 'resize');
  assert.equal(h.writes.length, before, 'zooming an answer does not reset it');
  h.elements.clear(); h.sync();
  assert.equal(h.pendingFrames, 1);
  h.question();
  assert.equal(h.pendingFrames, 0);
  h.frame();
  assert.equal(h.allowed(), true);
  assert.match(h.content, /maximum-scale=1, user-scalable=no/);
});

test('restore requests are bounded when a browser ignores scale constraints', () => {
  const h = setup({ scale: 2 });
  h.frame();
  for (let n = 0; n < 10; n++) { h.emit('viewport', 'resize'); h.frame(); }
  assert.equal(h.writes.filter(value => value.includes('initial-scale=1.0001')).length, 2);
  assert.equal(h.pendingFrames, 0);
  assert.match(h.content, /maximum-scale=1, user-scalable=no/);
});

test('back navigation, rotation and foregrounding restore locked views, with no viewport API required', () => {
  for (const [target, type] of [['window', 'pageshow'], ['window', 'orientationchange'], ['document', 'visibilitychange']]) {
    const h = setup(); h.window.visualViewport.scale = 2;
    h.emit(target, type); h.frame();
    assert.ok(h.writes.some(value => value.includes('initial-scale=1.0001')), type);
    assert.match(h.content, /maximum-scale=1, user-scalable=no/);
  }
  const h = setup({ visualViewport: false });
  h.question(); h.elements.clear(); h.sync();
  assert.equal(h.allowed(), false);
  assert.equal(h.pendingFrames, 0);
});

test('DOM observation covers phase and overlay changes without repeated viewport writes', () => {
  const h = setup();
  assert.equal(h.observer.target, h.document.body);
  assert.equal(h.observer.options.subtree, true);
  assert.equal(h.observer.options.childList, true);
  assert.deepEqual(Array.from(h.observer.options.attributeFilter), ['class', 'hidden', 'aria-hidden']);
  h.question();
  const writes = h.writes.length, events = h.notifications.length;
  for (let n = 0; n < 20; n++) h.sync();
  assert.equal(h.writes.length, writes);
  assert.equal(h.notifications.length, events);
});

test('managed zoom affects question contents, preserves fullscreen scrollers and handwriting', () => {
  const css = read('styles/visual-viewport-guard.css');
  assert.match(css, /html\.app-zoom-locked body \*\s*\{\s*touch-action:pan-x pan-y!important/);
  assert.match(css, /html\.app-answer-zoom-allowed #quiz-whiteboard-canvas\s*\{\s*touch-action:none!important/);
  assert.match(css, /zoom:var\(--app-answer-zoom,1\)/);
  assert.match(css, /quiz-main-column > :not\(#quiz-whiteboard-panel\)/);
  assert.match(css, /#raid-question \.raid-question-shell > \*/);
  assert.match(read('xianxia.css'), /touch-action:\s*none/);
});
