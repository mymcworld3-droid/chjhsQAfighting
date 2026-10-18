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

function slidesHarness({loaded=true,genderNeeded=true}={}) {
  let layer=null,now=0,serial=0,genderCalls=0;
  const timers=new Map(),pictures=[];
  const context=vm.createContext({state:{stage:'background'},scene:0,sceneTimer:null,pictureRevision:0,
    scenes:[['one.png','一','說明一'],['two.png','二','說明二']],
    Rules:{needsGender:()=>genderNeeded},window:{getCurrentUserData:()=>({})},
    showScenePicture(){return new Promise(resolve=>{pictures.push(resolve);if(loaded)resolve();});},loadSceneImage(){},
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    $:()=>layer,store(patch){Object.assign(context.state,patch);},
    gender(){genderCalls++;context.removeLayer();},action:fn=>fn(),finish(){context.state.stage='done';context.removeLayer();},
    panel(){context.clearTimeout(context.sceneTimer);const handlers={};const nodes={'#fv-prev':{addEventListener:(_,fn)=>handlers.prev=fn},'#fv-next':{}};
      layer={querySelector:key=>nodes[key],handlers,nodes,remove(){layer=null;}};return layer;}});
  const remove= intro.slice(intro.indexOf('  function removeLayer()'),intro.indexOf('  function panel('));
  const slides=intro.slice(intro.indexOf('  function backgrounds()'),intro.indexOf('  function gender()'));
  vm.runInContext(remove+slides,context);context.backgrounds();
  return {context,timers,pictures,layer:()=>layer,genderCalls:()=>genderCalls,
    advance(ms){const until=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>until)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=until;}};
}

test('world pictures advance after three displayed seconds and finish at manual gender selection', async () => {
  const h=slidesHarness();await Promise.resolve();h.advance(2999);assert.equal(h.context.scene,0);
  h.advance(1);assert.equal(h.context.scene,1);await Promise.resolve();h.advance(3000);
  assert.equal(h.context.state.stage,'gender');assert.equal(h.genderCalls(),1);assert.equal(h.timers.size,0);
});

test('slow images wait for decoding, manual navigation resets the clock and stale image callbacks cannot skip slides', async () => {
  const h=slidesHarness({loaded:false});const first=h.layer();h.advance(5000);assert.equal(h.context.scene,0);
  h.pictures[0]();await Promise.resolve();h.advance(1000);first.nodes['#fv-next'].onclick();assert.equal(h.context.scene,1);
  first.nodes['#fv-next'].onclick();assert.equal(h.context.scene,1,'stale buttons cannot skip another slide');
  assert.equal(h.timers.size,0,'previous timer is cancelled');
  h.pictures[1]();await Promise.resolve();h.advance(2999);assert.equal(h.context.scene,1);
  h.layer().handlers.prev();assert.equal(h.context.scene,0);assert.equal(h.timers.size,0);
  h.pictures[2]();h.context.removeLayer();await Promise.resolve();h.advance(5000);assert.equal(h.context.scene,0);
});

test('only accounts needing the world introduction preload all five images and wait for decoding', async () => {
  const images=[],decoders=[];
  const context=vm.createContext({state:{},window:{},Rules:rules,sceneImages:new Map(),
    scenes:[['one.png'],['two.png'],['three.png'],['four.png'],['five.png']],
    Image:class {constructor(){images.push(this);this.naturalWidth=0;}decode(){return new Promise(resolve=>decoders.push(resolve));}}});
  vm.runInContext(intro.slice(intro.indexOf('  function loadSceneImage('),intro.indexOf('  async function showScenePicture(')),context);
  for(const [person,data,first] of [[null,{},true],[guest,{},true],[account,{},false],[account,{arrivalOnboardingV1:{completed:true}},true]]) {
    await context.window.preloadFirstVisitScenes(person,data,first);
    assert.equal(images.length,0);
  }
  let ready=false;
  const first=context.window.preloadFirstVisitScenes(account,{},true).then(()=>ready=true);
  const repeated=context.window.preloadFirstVisitScenes(account,{},true);
  assert.equal(images.length,5,'repeated preloads reuse the image cache');
  const loads=images.slice(0,4).map(image=>{image.naturalWidth=1672;return image.onload();});
  images[4].onerror();await Promise.resolve();assert.equal(ready,false,'loading alone is insufficient before decoding');
  decoders.forEach(resolve=>resolve());await Promise.all(loads);await first;await repeated;
  assert.equal(ready,true,'one failed image does not block startup');
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
