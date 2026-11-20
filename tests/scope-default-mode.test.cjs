'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
const index = readFileSync(join(__dirname, '../public/index.html'), 'utf8');

function settingsHarness(gameSettings) {
  const nodes = new Map();
  for (const id of ['set-display-name','set-level','set-strong','set-weak','set-source-mode']) {
    nodes.set(id, { value: id === 'set-source-mode' ? 'random' : '' });
  }
  const calls = [];
  const ctx = vm.createContext({
    currentUserData: {
      displayName: '修士', profile: { educationLevel: '高中一年級', strongSubjects: '', weakSubjects: '' },
      ...(gameSettings === undefined ? {} : { gameSettings })
    },
    document: { getElementById: id => nodes.get(id) || null },
    window: {
      toggleSourceMode: () => calls.push('toggle'),
      renderSelectedUnitsList: () => calls.push('render')
    },
    syncAccountBindingUI() {},
    fetch: async () => ({ json: async () => ({}) }),
    console: { error: () => {} }
  });
  const start = legacy.indexOf('async function updateSettingsInputs() {');
  const end = legacy.indexOf('\nasync function getCleanSubjects(', start);
  assert.ok(start >= 0 && end > start, 'load real settings initializer');
  vm.runInContext(legacy.slice(start, end), ctx);
  return { ctx, nodes, calls, update: () => ctx.updateSettingsInputs() };
}

test('scope selector initially displays focused practice without waiting for profile loading', () => {
  const scope = index.match(/<select id="set-source-mode"[\s\S]*?<\/select>/)?.[0];
  assert.ok(scope, 'scope mode selector exists');
  assert.match(scope, /<option value="focused" selected>/);
  assert.doesNotMatch(scope, /<option value="random" selected>/);
  assert.match(index, /id="focused-source-container" class="bg-slate-900/);
  assert.match(index, /id="comprehensive-source-container" class="cs-scope hidden"/);
});

test('new players without saved scope settings start in focused mode, with an empty unit list', async () => {
  for (const choice of [undefined, {}, { sourceMode: '' }]) {
    const h = settingsHarness(choice);
    await h.update();
    assert.equal(h.nodes.get('set-source-mode').value, 'focused');
    assert.equal(h.ctx.window.soloSelectedUnits.length, 0);
    assert.deepEqual(h.calls, ['toggle', 'render']);
  }
});

test('previously saved random, bank and focused modes remain unchanged', async () => {
  for (const sourceMode of ['random', 'bank', 'focused']) {
    const selected = [{ path: '數學/高中一年級/一次函數.json' }];
    const h = settingsHarness({ sourceMode, focusedUnits: selected });
    await h.update();
    assert.equal(h.nodes.get('set-source-mode').value, sourceMode);
    assert.equal(h.ctx.window.soloSelectedUnits.length, 1);
    assert.equal(h.ctx.window.soloSelectedUnits[0].path, selected[0].path);
  }
});

test('focused practice still requires at least one selected unit before saving', () => {
  assert.match(legacy, /if \(sourceMode === 'focused' && \(!window\.soloSelectedUnits \|\| window\.soloSelectedUnits\.length === 0\)\)/);
  assert.match(readFileSync(join(__dirname, '../public/main.js'), 'utf8'), /import '\.\/main-legacy\.js\?v=20\d{6}-[\w-]+';/);
  assert.match(index, /main\.js\?v=20\d{6}-[\w-]+/);
});
