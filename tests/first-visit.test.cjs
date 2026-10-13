'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../public/cultivation/first-visit-rules.js');
const legacy = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
const intro = fs.readFileSync(path.join(__dirname, '../public/cultivation/first-visit.js'), 'utf8');
const guest = { uid: 'guest-one', isAnonymous: true };
const account = { uid: 'account-one', isAnonymous: false };
const state = stage => ({ version: 1, stage, guestUid: guest.uid });

test('a new device welcomes once; finished devices do not repeat the trial after logout', () => {
  assert.equal(rules.readyStage({}, null), 'welcome');
  assert.equal(rules.readyStage({ version: 1, stage: 'done' }, null), 'done');
  assert.equal(rules.normalize({ version: 99, stage: 'done' }).stage, 'welcome');
});

test('guest reload resumes the saved question or feature introduction, and a saved correct answer resumes the invitation', () => {
  for (const stage of ['features', 'question']) {
    assert.equal(rules.readyStage(state(stage), guest, { stats: { totalScore: 0 } }), stage);
  }
  for (const stage of ['scope', 'features', 'question', 'invite']) {
    assert.equal(rules.readyStage(state(stage), guest, { stats: { totalScore: 1 } }), 'invite');
  }
  assert.equal(rules.readyStage(state('question'), { ...guest, uid: 'another-guest' }, { stats: { totalScore: 0 } }), 'scope');
});

test('new accounts and account linking show backgrounds before gender, while returning players keep their account state', () => {
  assert.equal(rules.readyStage({}, account, { profile: {}, stats: {} }, true), 'background');
  assert.equal(rules.readyStage({}, account, { profile: {}, stats: {} }, false), 'done');
  assert.equal(rules.readyStage({ ...state('invite'), joining: true }, account, {}), 'background');
  assert.equal(rules.readyStage(state('gender'), account, {}), 'gender');
  assert.equal(rules.readyStage(state('background'), account, { arrivalOnboardingV1: { completed: true } }), 'done');
  assert.equal(rules.needsGender({ storyProgressV1: { gender: 'female' } }), false);
  assert.equal(rules.needsGender({}), true);
});

function loginHarness({ collision = false, cancel = false } = {}) {
  const calls = [], player = { uid: guest.uid, displayName: '匿名修士', stats: { totalScore: 1, gold: 20 }, gameSettings: { sourceMode: 'focused' }, inventory: [] };
  const person = { ...guest, isAnonymous: false, displayName: 'New name', email: 'new@example.test', photoURL: 'https://example.test/photo.png' };
  const auth = { currentUser: { ...guest } };
  const ctx = vm.createContext({
    auth, provider: {}, db: {}, currentUserData: player,
    document: { getElementById: () => ({ textContent: '' }) },
    window: { isFirstVisitActive: () => true, handleFirstVisitReady: async (user, data) => calls.push(['ready', user.uid, data.stats.totalScore]) },
    alert: message => calls.push(['alert', message]),
    signInAnonymously: async () => ({ user: auth.currentUser }),
    linkWithPopup: async user => {
      calls.push(['link', user.uid]);
      if (cancel) throw Object.assign(new Error('cancel'), { code: 'auth/popup-closed-by-user' });
      if (collision) throw Object.assign(new Error('existing'), { code: 'auth/credential-already-in-use', credential: 'verified-credential' });
      auth.currentUser = person;
      return { user: person };
    },
    GoogleAuthProvider: { credentialFromError: error => error.credential },
    signInWithCredential: async (_, credential) => { calls.push(['existing', credential]); auth.currentUser = account; return { user: account }; },
    signInWithPopup: async () => ({ user: person }),
    doc: (_, collection, uid) => ({ collection, uid }),
    updateDoc: async (ref, patch) => calls.push(['save', ref.uid, patch]),
    updateSettingsInputs: async () => {}
  });
  const start = legacy.indexOf('window.startFirstVisitGuest =');
  const end = legacy.indexOf('window.completeFirstVisitSetup =', start);
  vm.runInContext(legacy.slice(start, end), ctx);
  return { ctx, calls, player };
}

test('Google binding preserves anonymous UID and first-answer rewards, updating only account identity', async () => {
  const { ctx, calls, player } = loginHarness();
  await ctx.window.googleLogin();
  assert.equal(ctx.auth.currentUser.uid, guest.uid);
  assert.deepEqual(player.stats, { totalScore: 1, gold: 20 });
  assert.equal(player.gameSettings.sourceMode, 'focused');
  assert.deepEqual(calls.map(row => row[0]), ['link', 'save', 'ready']);
  assert.deepEqual(Object.keys(calls[1][2]).sort(), ['displayName', 'email', 'photoURL']);
});

test('existing Google credential signs into its own account and never overwrites that account with guest data', async () => {
  const { ctx, calls } = loginHarness({ collision: true });
  await ctx.window.googleLogin();
  assert.equal(ctx.auth.currentUser.uid, account.uid);
  assert.deepEqual(calls.map(row => row[0]), ['link', 'existing']);
});

test('cancelling the popup preserves the guest and allows a second login attempt', async () => {
  const { ctx, calls, player } = loginHarness({ cancel: true });
  await assert.rejects(ctx.window.googleLogin(), /cancel/);
  assert.equal(ctx.auth.currentUser.uid, guest.uid);
  assert.equal(player.stats.totalScore, 1);
  assert.deepEqual(calls.map(row => row[0]), ['link']);
});

test('arrival assets exist, the survey is absent, and the first quest explicitly opens the newcomer story', () => {
  const index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.doesNotMatch(index, /id="page-onboarding"|id="ob-level"|submitOnboarding/);
  for (const id of ['set-level', 'set-strong', 'set-weak']) assert.ok(index.includes(`id="${id}"`));
  for (const file of ['player-male-neutral.png', 'player-female-neutral.png']) {
    assert.equal(fs.existsSync(path.join(__dirname, '../public/assets/story/characters', file)), true);
  }
  for (const file of [...intro.matchAll(/\['(opening-\d\.png)'/g)].map(match => match[1])) {
    assert.equal(fs.existsSync(path.join(__dirname, '../public/assets/story/opening', file)), true);
  }
  const q = require('../public/cultivation/quest-rules.js').PATH[0];
  assert.equal(q.chapterId, 'prologue-enter-sect');
  assert.match(q.title, /新手劇情/);
  assert.match(q.description, /不會自動播放/);
});
