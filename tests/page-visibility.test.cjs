const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(publicDir, name), 'utf8');

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (/\.(css|js|html)$/.test(entry.name)) yield file;
  }
}

function* styles() {
  for (const file of files(publicDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const name = path.relative(publicDir, file);
    if (file.endsWith('.css')) yield { name, text };
    else if (file.endsWith('.html')) {
      for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) yield { name, text: match[1] };
    } else {
      for (const match of text.matchAll(/\.textContent\s*=\s*`([^`]+)`/g)) yield { name, text: match[1] };
    }
  }
}

// Inspect only the selector's subject, not page IDs/classes inside :has(),
// :not(), or an ancestor. This is a source invariant, not a CSS layout engine.
function subjects(selector) {
  const parts = [];
  let part = '', last = '', depth = 0, quote = '';
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    if (!depth && /[\s,>+~]/.test(char) && !quote) {
      if (char === ',') { parts.push(part || last); part = ''; last = ''; }
      else if (part) { last = part; part = ''; }
    } else part += char;
  }
  parts.push(part || last);
  return parts.map(part => part.replace(/:(?:has|not)\((?:[^()]|\([^()]*\))*\)/g, ''));
}

test('page-level display rules require the page to be active, including retained contract content', () => {
  const checked = new Set();
  let count = 0;
  for (const { name, text } of styles()) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const display = declarations.match(/(?:^|;)\s*display\s*:\s*([^;]+)/)?.[1].trim();
      if (!display || /^none\b/.test(display)) continue;
      for (const subject of subjects(selector.trim())) {
        if (!/(?:#page-[\w-]+|\.page-section\b|\.training-page-v3\b)/.test(subject)) continue;
        count++;
        checked.add(name);
        assert.match(subject, /\.active-page\b/, `${name}: ${selector.trim()} can reveal an inactive page`);
      }
    }
  }
  assert.ok(count >= 6, 'audit must inspect both static and injected page display rules');
  assert.ok(checked.has('styles/training-pages.css'), 'contract display override must be audited');
  assert.ok(checked.has('cultivation/content-capacity-layout.js'), 'injected layout must be audited');
  assert.ok(checked.has('index.html'), 'preloaded layout must be audited');
});

test('navigation hiding has priority over unlayered theme overrides for every page root', () => {
  const css = read('styles/page-layout-unified.css');
  assert.match(css, /@layer\s+[\w-]+\s*\{\s*\.page-section\.hidden\s*\{\s*display:\s*none\s*!important\s*;\s*\}\s*\}/);
  assert.match(read('index.html'), /href="styles\/page-layout-unified\.css\?v=[^"]+"/);
});

function runtime() {
  const classes = names => {
    const set = new Set(names.split(' '));
    return {
      contains: name => set.has(name),
      add: (...names) => names.forEach(name => set.add(name)),
      remove: (...names) => names.forEach(name => set.delete(name)),
      toggle(name, force) { if (force) set.add(name); else set.delete(name); }
    };
  };
  const ids = ['page-home', 'page-training', 'page-raid', 'page-store', 'page-quiz', 'page-battle', 'page-settings'];
  const pages = ids.map(id => ({ id, classList: classes('page-section hidden') }));
  // The contract intentionally remains mounted, so leaving it must hide its
  // page without destroying the carousel or depending on a content remount.
  const contract = { id: 'soulbound-page' };
  const training = pages.find(page => page.id === 'page-training');
  training.contract = contract;
  const navigation = ids.map(id => ({ dataset: { target: id }, classList: classes('nav-btn') }));
  const calls = { transitions: 0, texts: 0 };
  const context = {
    isBattleActive: false, chatUnsub: null,
    sceneTheme: id => id,
    beginSceneTransition: () => () => calls.transitions++,
    updateTexts: () => calls.texts++,
    renderInventory() {}, loadUserHistory() {}, loadAdminData() {}, switchSocialTab() {}, alert() {},
    document: {
      body: { classList: classes('xianxia-theme ui-cleanup') },
      getElementById: id => pages.find(page => page.id === id) || null,
      querySelector: () => pages.find(page => page.classList.contains('active-page')) || null,
      querySelectorAll: selector => selector === '.page-section' ? pages : navigation
    },
    window: { promptXiuxianEducationLevel: () => false }
  };
  const legacy = read('main-legacy.js');
  const source = legacy.slice(legacy.indexOf('window.switchToPage = (pageId,'), legacy.indexOf('let brandHomeNavigationPending ='));
  assert.ok(source.startsWith('window.switchToPage ='), 'exercise the production router');
  vm.runInNewContext(source, context);
  return { context, pages, training, contract, calls, navigate: context.window.switchToPage };
}

test('contract, sect, raid and other destinations repeatedly switch with only one active page', () => {
  const h = runtime();
  const route = ['page-training', 'page-home', 'page-raid', 'page-home', 'page-training', 'page-raid', 'page-training', 'page-store', 'page-quiz', 'page-training', 'page-settings'];
  for (let round = 0; round < 3; round++) {
    for (const destination of route) {
      h.navigate(destination);
      assert.deepEqual(h.pages.filter(page => !page.classList.contains('hidden')).map(page => page.id), [destination]);
      assert.deepEqual(h.pages.filter(page => page.classList.contains('active-page')).map(page => page.id), [destination]);
      assert.equal(h.training.contract, h.contract, 'retaining contract DOM must not affect page visibility');
    }
  }
  assert.equal(h.calls.transitions, route.length * 3);
});

test('invalid or blocked navigation preserves the current page without exposing the contract', () => {
  const h = runtime();
  h.navigate('page-home');
  h.navigate('page-missing');
  assert.equal(h.training.classList.contains('hidden'), true);
  assert.equal(h.calls.transitions, 1);
  h.navigate('page-battle');
  h.context.isBattleActive = true;
  h.navigate('page-training');
  assert.equal(h.training.classList.contains('hidden'), true);
  assert.deepEqual(h.pages.filter(page => page.classList.contains('active-page')).map(page => page.id), ['page-battle']);
  assert.equal(h.calls.transitions, 2);
});
