'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
const arrival = fs.readFileSync(path.join(__dirname, '../public/cultivation/first-visit.js'), 'utf8');

function signInHarness({ type = 'google', migrationReady = true, featuresReady = true,
  gate = false, activePage = '', firstVisitHandled = false } = {}) {
  const calls = [];
  const user = { uid: 'returning-user', isAnonymous: type === 'guest', displayName: '修士' };
  const auth = { currentUser: user };
  const settings = { uid: user.uid, stats: { totalScore: 1 }, profile: {}, displayName: '修士' };
  const elements = new Map([
    ['login-screen', { classList: { add: value => calls.push(['hide-login', value]) } }],
    ['bottom-nav', { classList: { remove: value => calls.push(['show-nav', value]) } }],
    ['btn-bind-guest', { classList: { toggle() {} } }],
    ['settings-email', { textContent: '' }]
  ]);
  if (gate) elements.set('game-startup-gate', {});
  const window = {
    __xiuxianMigrationApproved: migrationReady,
    __xiuxianFeaturesReady: featuresReady,
    handleFirstVisitAuthPending: person => calls.push(['authenticated', person.uid]),
    handleFirstVisitReady: async person => {
      calls.push(['arrival', person.uid]);
      return firstVisitHandled;
    },
    isFirstVisitActive: () => firstVisitHandled,
    switchToPage: page => calls.push(['page', page])
  };
  const ctx = vm.createContext({
    window, auth, currentUserData: settings,
    document: {
      getElementById: id => elements.get(id) || null,
      querySelector: () => activePage ? { id: activePage } : null
    },
    provider: {}, db: {}, console: { warn() {} },
    signInAnonymously: async () => ({ user }),
    signInWithPopup: async () => ({ user }),
    signInWithCredential: async () => ({ user }),
    linkWithPopup: async () => ({ user }),
    syncAccountBindingUI() {},
    updateSettingsInputs: async () => {}
  });
  // Test the real standalone authentication functions, not a replica.
  vm.runInContext(legacy.slice(legacy.indexOf('let linkedGoogleIdentity ='),
    legacy.indexOf('window.completeFirstVisitSetup =')), ctx);
  return { ctx, calls, user, settings };
}

test('existing-account popup enters home without a second Firebase auth callback or refresh', async () => {
  const h = signInHarness();
  await h.ctx.window.googleLogin();
  assert.ok(h.calls.some(row => row[0] === 'authenticated'));
  assert.ok(h.calls.some(row => row[0] === 'arrival'));
  assert.ok(h.calls.some(row => row[0] === 'hide-login'));
  assert.ok(h.calls.some(row => row[0] === 'page' && row[1] === 'page-home'));
  assert.ok(h.calls.some(row => row[0] === 'show-nav'));
});

test('returning guest also enters home if anonymous sign-in reused an existing session', async () => {
  const h = signInHarness({ type: 'guest' });
  await h.ctx.window.startFirstVisitGuest();
  assert.ok(h.calls.some(row => row[0] === 'page' && row[1] === 'page-home'));
});

test('login recovery does not interrupt an already open gameplay page', async () => {
  const h = signInHarness({ activePage: 'page-training' });
  await h.ctx.window.googleLogin();
  assert.ok(!h.calls.some(row => row[0] === 'page'));
  assert.ok(h.calls.some(row => row[0] === 'hide-login'));
});

test('fresh sessions do not bypass migration, startup feature gate or character creation', async () => {
  for (const options of [{ migrationReady: false }, { featuresReady: false }, { gate: true }]) {
    const h = signInHarness(options);
    await h.ctx.window.googleLogin();
    assert.ok(!h.calls.some(row => row[0] === 'page'), JSON.stringify(options));
    assert.ok(!h.calls.some(row => row[0] === 'arrival'), JSON.stringify(options));
  }
  const h = signInHarness({ firstVisitHandled: true });
  await h.ctx.window.googleLogin();
  assert.ok(h.calls.some(row => row[0] === 'arrival'));
  assert.ok(!h.calls.some(row => row[0] === 'page'));
  assert.ok(!h.calls.some(row => row[0] === 'show-nav'));
});

test('account mismatch never sends another user to the previous home', async () => {
  const h = signInHarness();
  h.ctx.currentUserData = { uid: 'other', stats: {} };
  await h.ctx.window.googleLogin();
  assert.ok(!h.calls.some(row => row[0] === 'page'));
  assert.ok(!h.calls.some(row => row[0] === 'arrival'));
});

test('auth observer releases welcome overlay early, and remote settings do not block entering home', () => {
  assert.match(legacy, /showGameStartupGate\('正在載入玩家資料…'\);\s*window\.handleFirstVisitAuthPending\?\.\(user\)/);
  assert.match(legacy, /void updateSettingsInputs\(\)\.catch/);
  assert.match(arrival, /window\.handleFirstVisitAuthPending = person =>/);
  assert.match(arrival, /if \(!person\?\.uid\) return false;/);
  assert.match(arrival, /removeLayer\(\);\s*return true;/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8'), /20261120-auth-entry-v1/);
});
