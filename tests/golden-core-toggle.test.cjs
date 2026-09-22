const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const training = read('public/cultivation/cultivation-training-v4.js');
const rules = read('public/cultivation/cultivation-rules.js');
const status = read('public/cultivation/cultivation-status-panel.js');
const profile = read('public/cultivation/player-profile.js');
const battle = read('public/cultivation/golden-core-battle-effects.js');
const css = read('public/cultivation-status-panel.css');

function runtime() {
  const store = new Map();
  const remote = [];
  const data = { stats: { totalScore: 35, gold: 300 } };
  const fakeElement = () => ({
    id: '', className: '', textContent: '',
    classList: { add() {}, remove() {} }, remove() {}
  });
  const document = {
    readyState: 'loading', addEventListener() {}, getElementById() { return null; },
    createElement: fakeElement, body: { appendChild() {} }
  };
  const window = {
    getCurrentUserData: () => data, dispatchEvent() {}
  };
  const context = {
    window, document, console, Math, Date, JSON, Number, String, Object, Array,
    getApp: () => ({}), getAuth: () => ({ currentUser: { uid: 'fixture-user' } }),
    getFirestore: () => ({}), doc: (_db, ...path) => path.join('/'),
    updateDoc: async (_ref, payload) => { remote.push(payload); },
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, value) => store.set(key, value)
    },
    CustomEvent: class CustomEvent { constructor(name, opts) { this.type = name; this.detail = opts?.detail; } },
    requestAnimationFrame() {}, setTimeout() {}
  };
  const script = training.replace(/^import .*?;\s*$/gm, '');
  vm.runInNewContext(script, context);
  return { window, data, store, remote };
}

test('core toggle saves flag without replacing core, and effects stop and resume', async () => {
  const { window, data, store, remote } = runtime();
  const original = window.getEquippedGoldenCoreState();
  assert.equal(original.equipped, true);
  assert.equal(window.isGoldenCoreEnabled(), true);
  assert.equal(await window.setGoldenCoreEnabled(false), true);
  assert.equal(window.isGoldenCoreEnabled(), false);
  assert.equal(window.getEquippedGoldenCoreState(), null);
  const dormant = window.getStoredGoldenCoreState();
  assert.equal(dormant.grade, original.grade);
  assert.equal(dormant.type, original.type);
  assert.equal(dormant.equipped, false);
  assert.equal(window.resolveGoldenCoreCultivationReward({ stats: data.stats, isCorrect: true }).bonusGain, 0);
  assert.equal(remote.at(-1).cultivationTraining.coreEnabled, false);
  assert.equal(data.cultivationTraining.coreEnabled, false);
  assert.equal(JSON.parse(store.get('xiuxian_training_state_v4')).coreEnabled, false);
  assert.equal(await window.setGoldenCoreEnabled(true), true);
  assert.equal(window.getEquippedGoldenCoreState().type, original.type);
  assert.equal(remote.at(-1).cultivationTraining.coreEnabled, true);
});

test('runtime and downstream snapshots do not expose a disabled core as active', () => {
  assert.doesNotMatch(training, /id="toggle-golden-core"/);
  assert.match(status, /data-status-core-toggle/);
  assert.match(status, /setGoldenCoreEnabled\(!snapshot\.core\.equipped\)/);
  assert.match(status, /coreTogglePending/);
  assert.match(training, /window\.getStoredGoldenCoreState = function/);
  assert.match(training, /window\.getEquippedGoldenCoreState = function/);
  assert.match(training, /snapshot\?\.coreEnabled \? snapshot : null/);
  assert.match(training, /coreEnabled: raw\.coreEnabled !== false/);
  assert.match(status, /getStoredGoldenCoreState\?\.\(\)/);
  assert.match(status, /已停用/);
  assert.match(battle, /if \(!core\?\.equipped\) return null/);
  assert.match(profile, /if \(!enabled\) return null/);
  assert.match(css, /\.status-core-toggle:disabled/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) auto/);
});

test('dormant core shield is suspended without being consumed by a wrong answer', () => {
  const stats = { totalScore: 42, goldenCoreShield: true };
  const window = { isGoldenCoreEnabled: () => false, resolveGoldenCoreCultivationReward: () => {
    throw Error('disabled core reward must never run');
  } };
  const code = rules.replace(/^export /gm, '') + '\nthis.apply=applyCultivationReward;';
  const context = { window, console };
  vm.runInNewContext(code, context);
  const result = context.apply(stats, false);
  assert.equal(result.penalty, 1);
  assert.equal(result.shieldBlockedPenalty, false);
  assert.equal(stats.goldenCoreShield, true);
  assert.equal(stats.totalScore, 41);
});
