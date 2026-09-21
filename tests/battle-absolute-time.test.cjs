'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const battle = read('public/cultivation/battle-mode-v2.js');
const tutorial = read('public/cultivation/battle-tutorial.js');
const fullscreen = read('public/cultivation/battle-v3-stability-ui.js');

test('a throttled callback respects its absolute deadline rather than chaining paint delays', () => {
  const a = battle.indexOf('  function scheduleBattleAt(deadlineMs, key, action) {');
  const b = battle.indexOf('  function animateSettlement(room) {', a);
  assert.ok(a > 0 && b > a);
  const timerQueue = [];
  const state = { roomId: 'r', seenSettlementKey: 'k', animationTimers: [] };
  let now = 1000;
  const context = {
    state, nowMs: () => now,
    setTimeout: (callback, ms) => {
      timerQueue.push({ callback, at: now + ms });
      return timerQueue.length;
    }
  };
  vm.runInNewContext(battle.slice(a, b) + '\nthis.schedule = scheduleBattleAt;', context);
  const events = [];
  context.schedule(1800, 'k', time => events.push(time));
  assert.equal(timerQueue[0].at, 1800);
  // The browser is suspended until 2100ms; resume must not add an extra 800ms.
  now = 2100;
  // Run scheduled callback despite having missed the nominal deadline.
  context.schedule(2600, 'k', time => events.push(time));
  const oldCallback = timerQueue.shift();
  oldCallback.callback();
  assert.deepEqual(events, [2100]);
  assert.equal(timerQueue.shift().at, 2600);
});

test('early timers recheck the actual clock; late timers remain cancellable', () => {
  const a = battle.indexOf('  function scheduleBattleAt(deadlineMs, key, action) {');
  const b = battle.indexOf('  function animateSettlement(room) {', a);
  let now = 100;
  const queued = [];
  const state = { roomId:'r', seenSettlementKey:'key', animationTimers:[] };
  const context = {state, nowMs:()=>now,
    setTimeout:(callback,ms)=>{queued.push({callback,at:now+ms});return queued.length;}
  };
  vm.runInNewContext(battle.slice(a,b)+'\nthis.schedule=scheduleBattleAt;',context);
  const fired=[];
  context.schedule(1100,'key',at=>fired.push(at));
  now=750;
  queued.shift().callback();
  assert.equal(queued[0].at,1100);
  assert.deepEqual(fired,[]);
  now=1400;
  context.schedule(1600,'key',at=>fired.push(at));
  state.seenSettlementKey='new-round';
  queued.shift().callback();
  assert.deepEqual(fired,[]);
});

test('long counterattack sequences reserve enough absolute time before next round', () => {
  const a = battle.indexOf('  const ANIMATION_STEP_MS = ');
  const b = battle.indexOf('  const ANSWER_WINDOW_MS = ',a);
  assert.ok(a>0 && b>a);
  const context={Math};
  vm.runInNewContext(battle.slice(a,b) + '\nthis.grace=roundAnimationGrace;',context);
  assert.equal(context.grace({lastSettlement:{steps:[]}}),5200);
  assert.ok(context.grace({lastSettlement:{steps:[{},{},{},{}]}})>9000);
  assert.match(battle, /patch.nextRoundAtMs = nowMs\(\) \+ roundAnimationGrace\(fresh\)/);
  assert.match(battle, /left \/ roundAnimationGrace\(room\) \* 100/);
});

test('formal and tutorial attacks both use a fixed timeline and a delayed impact', () => {
  assert.match(battle,/startAtMs \+ ATTACK_LEAD_MS \+ index \* ANIMATION_STEP_MS/);
  assert.match(battle,/const impactAtMs = strikeAtMs \+ ATTACK_IMPACT_MS/);
  assert.match(battle,/scheduleBattleAt\(impactAtMs, key/);
  assert.match(battle,/atMs >= clearAtMs/);
  assert.doesNotMatch(battle.slice(battle.indexOf('  function animateSettlement(room) {'),battle.indexOf('  async function confirmReview() {')),/requestAnimationFrame/);
  assert.match(tutorial,/async function waitUntil\(deadlineMs\)/);
  assert.match(tutorial,/const strikeAtMs = startAtMs \+ 280 \+ index \* TURN_ANIMATION_MS/);
  assert.match(tutorial,/await waitUntil\(impactAtMs\)/);
  assert.match(tutorial,/await waitUntil\(clearAtMs\)/);
});

test('answering fills the viewport while preserving exit and scrolling for long questions',()=>{
  assert.match(battle,/page.classList.toggle\('bv2-quiz-active', name === 'quiz'\)/);
  assert.match(fullscreen, /#page-battle.bv2-quiz-active \.bv2-shell/);
  assert.match(fullscreen, /#page-battle \.bv2-quiz:not\(\.hidden\) > \.bv2-question-card/);
  assert.match(fullscreen, /height:100%!important;min-height:0!important;max-height:none!important/);
  assert.match(fullscreen, /overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain/);
  assert.match(fullscreen, /#page-battle #bv2-quiz:not\(\.hidden\) > #battle-tutorial-layer\.bt-quiz-mode/);
  assert.match(fullscreen, /animation-duration:1450ms!important/);
  assert.match(tutorial, /#\$\{LAYER_ID\} \.bt-fighter.strike\{animation-duration:1450ms!important\}/);
});
