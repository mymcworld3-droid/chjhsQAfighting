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

test('arrival completion rejects missing names and roles before persisting setup', async () => {
  const calls = [];
  const ctx = vm.createContext({ auth: { currentUser: account }, currentUserData: {}, db: {},
    window: { updatePlayerDisplayName: async name => calls.push(['name', name]), dispatchEvent() {} },
    doc: () => ({}), updateDoc: async (_, patch) => calls.push(['setup', patch]),
    updateUIStats() {}, CustomEvent: class {} });
  const start = legacy.indexOf('window.completeFirstVisitSetup =');
  vm.runInContext(legacy.slice(start, legacy.indexOf('window.anonymousLogin =', start)), ctx);
  await assert.rejects(ctx.window.completeFirstVisitSetup('male', '   '), /輸入你的道號/);
  await assert.rejects(ctx.window.completeFirstVisitSetup('', '清風'), /選擇角色/);
  assert.equal(calls.length, 0);
  await ctx.window.completeFirstVisitSetup('female', '清風');
  assert.deepEqual(calls.map(call => call[0]), ['name', 'setup']);
  assert.equal(ctx.currentUserData.storyProgressV1.gender, 'female');
});

test('a new device welcomes once; finished devices do not repeat the trial after logout', () => {
  assert.equal(rules.readyStage({}, null), 'welcome');
  assert.equal(rules.readyStage({ version: 1, stage: 'done' }, null), 'done');
  assert.equal(rules.normalize({ version: 99, stage: 'done' }).stage, 'welcome');
});



function loginHarness({ collision = false, cancel = false, staleAuth = false } = {}) {
  const calls = [], player = { uid: guest.uid, displayName: '匿名修士', stats: { totalScore: 1, gold: 20 }, gameSettings: { sourceMode: 'focused' }, inventory: [] };
  const person = { ...guest, isAnonymous: false, displayName: 'New name', email: 'new@example.test', photoURL: 'https://example.test/photo.png' };
  const auth = { currentUser: { ...guest } };
  const nodes = new Map([
    ['btn-bind-guest', { hidden: false, classList: {
      classes: new Set(), toggle(name, enabled) {
        if (enabled) this.classes.add(name); else this.classes.delete(name);
      },
      contains(name) { return this.classes.has(name); }
    } }],
    ['settings-email', { textContent: '' }]
  ]);
  const ctx = vm.createContext({
    auth, provider: {}, db: {}, currentUserData: player,
    document: { getElementById: id => nodes.get(id) || { textContent: '' } },
    window: { QingyunFirstVisitRules: rules, isFirstVisitActive: () => true, handleFirstVisitReady: async (user, data) => calls.push(['ready', user.uid, data.stats.totalScore]) },
    calculateRankFromScore: score => score >= 1 ? 1 : 0,
    alert: message => calls.push(['alert', message]),
    signInAnonymously: async () => ({ user: auth.currentUser }),
    linkWithPopup: async user => {
      calls.push(['link', user.uid]);
      if (cancel) throw Object.assign(new Error('cancel'), { code: 'auth/popup-closed-by-user' });
      if (collision) throw Object.assign(new Error('existing'), { code: 'auth/credential-already-in-use', credential: 'verified-credential' });
      if (!staleAuth) auth.currentUser = person;
      return { user: person };
    },
    GoogleAuthProvider: { credentialFromError: error => error.credential },
    signInWithCredential: async (_, credential) => { calls.push(['existing', credential]); auth.currentUser = account; return { user: account }; },
    signInWithPopup: async () => ({ user: person }),
    doc: (_, collection, uid) => ({ collection, uid }),
    updateDoc: async (ref, patch) => calls.push(['save', ref.uid, patch]),
    updateSettingsInputs: async () => {}
  });
  const start = legacy.indexOf('let linkedGoogleIdentity =');
  const end = legacy.indexOf('window.completeFirstVisitSetup =', start);
  vm.runInContext(legacy.slice(start, end), ctx);
  return { ctx, calls, player, nodes };
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

test('provider linking synchronizes guest binding UI even if Firebase keeps the anonymous currentUser object', async () => {
  const { ctx, player, nodes } = loginHarness({ staleAuth: true });
  assert.equal(ctx.auth.currentUser.isAnonymous, true);
  await ctx.window.googleLogin();
  assert.equal(ctx.auth.currentUser.isAnonymous, true, 'stale SDK flag reproduces reported issue');
  assert.equal(ctx.auth.currentUser.uid, guest.uid);
  assert.equal(nodes.get('btn-bind-guest').classList.contains('hidden'), true);
  assert.equal(nodes.get('settings-email').textContent, 'new@example.test');
  assert.equal(player.email, 'new@example.test');
  // Re-rendering the profile form must not resurrect the link button.
  vm.runInContext('syncAccountBindingUI()', ctx);
  assert.equal(nodes.get('btn-bind-guest').classList.contains('hidden'), true);
  assert.equal(nodes.get('settings-email').textContent, 'new@example.test');
});

test('existing Google credential signs into its own account and never overwrites that account with guest data', async () => {
  const { ctx, calls } = loginHarness({ collision: true });
  await ctx.window.googleLogin();
  assert.equal(ctx.auth.currentUser.uid, account.uid);
  assert.deepEqual(calls.map(row => row[0]), ['link', 'existing']);
});

test('a Google identity without a game character inherits the live guest scope and earned realm', async () => {
  const {ctx,player,calls}=loginHarness({collision:true});
  player.profile={educationLevel:'國中二年級',strongSubjects:'數學',weakSubjects:'英文'};
  player.gameSettings={sourceMode:'focused',source:'ai',difficulty:'auto',focusedUnits:[{subject:'數學',unit:'二次函數'}]};
  player.isAdmin=true; player.inventory=['private-item'];
  await ctx.window.googleLogin();
  player.gameSettings.focusedUnits[0].unit='改過的範圍';
  const created=ctx.initialPlayerData(account,'NEW123');
  assert.equal(created.uid,account.uid); assert.equal(created.email,'');
  assert.equal(created.profile.educationLevel,'國中二年級');
  assert.equal(created.gameSettings.focusedUnits[0].unit,'二次函數','scope is captured before auth switches accounts');
  assert.equal(created.stats.totalScore,1);assert.equal(created.stats.rankLevel,1);assert.equal(created.stats.gold,20);
  assert.equal(created.isAdmin,false);assert.equal(created.inventory.length,0);
  assert.deepEqual(calls.map(row=>row[0]),['link','existing'],'existing accounts are never patched');
  const anotherGuest=ctx.initialPlayerData({uid:'other-guest',isAnonymous:true},'GUEST1');
  assert.equal(anotherGuest.stats.totalScore,0);assert.equal(anotherGuest.gameSettings,undefined);
});

test('guest handoff is applied only to a transactionally missing player and is consumed after account loading', async () => {
  const {ctx,player}=loginHarness({collision:true});await ctx.window.googleLogin();
  const start=legacy.indexOf('                const initialized = await runTransaction(db, async tx => {');
  const end=legacy.indexOf('\n            // Reuse the trusted',start);
  const snippet=legacy.slice(start,end).replace(/^            }\n/m,'');
  // Execute the actual initialization branch with a destination created by another login.
  ctx.user=account;ctx.userRef={uid:account.uid};ctx.code='NEW123';ctx.firstLoginUid='';
  let writes=0;
  ctx.runTransaction=async(_,worker)=>worker({get:async()=>({exists:()=>true,data:()=>({uid:account.uid,stats:{totalScore:68},gameSettings:{sourceMode:'random'}})}),set(){writes++;}});
  await vm.runInContext('(async()=>{'+snippet+'})()',ctx);
  assert.equal(ctx.currentUserData.stats.totalScore,68);assert.equal(writes,0);
  assert.equal(ctx.initialPlayerData({uid:'new-account',isAnonymous:false},'NEXT').stats.totalScore,0,'the guest cannot seed another account later');
  assert.equal(player.stats.totalScore,1);
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
  assert.match(q.title, /第一章/);
  assert.match(q.description, /不會自動播放/);
});
