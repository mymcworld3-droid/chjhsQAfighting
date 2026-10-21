'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const rules = require('../public/cultivation/opportunity-rules.js');
const source = fs.readFileSync('public/cultivation/opportunity-dongtian.js', 'utf8');
const hook = source.slice(source.indexOf('  window.maybeEncounterOpportunity ='), source.indexOf('  async function restore()'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function scenario() {
  const schedule = rules.createEncounterSchedule(null, () => 0), player = { gameSettings: { sourceMode: 'random' } };
  for (let i = 0; i < 20; i++) schedule.step('u1');
  const elements = new Map(), calls = [], pending = [], opened = [];
  let active = false, closed = 0, owner = 'u1', html = '';
  const el = { set innerHTML(value) {
    html = value; elements.clear();
    for (const [, id] of value.matchAll(/id="([^"]+)"/g)) elements.set(id, {});
  }, get innerHTML() { return html; } };
  const window = { isOpportunityActive: () => active };
  const context = vm.createContext({ window, globalThis: { crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' } },
    Math, Date, Promise, rolled: new WeakSet(), uid: () => owner, data: () => player, rules, schedule, inflight: false, restoring: false,
    restoredAccount: '', owner: '', serial: 0, $: id => elements.get(id),
    overlay: () => { active = true; return el; }, focusTitle() {}, header: () => '<button id="op-leave">返回問道</button>', esc: String,
    close: () => { active = false; closed++; context.serial++; elements.clear(); },
    request: (action, body) => { calls.push({ action, body }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    openRun: run => { opened.push(run.id); }, validOwner: () => owner === 'u1'
  });
  vm.runInContext(hook, context);
  return { context, schedule, elements, calls, pending, opened, el, get closed() { return closed; }, get active() { return active; }, switchAccount() { owner = 'u2'; context.serial++; },
    start: () => window.maybeEncounterOpportunity({ quiz: {} }), scope: rules.scopeKey(player) };
}
test('failed encounter stays on screen and explicit retry reuses one request ID without repeating next question encounters', async () => {
  const game = scenario(); let settled = false;
  const opening = game.start().then(value => { settled = true; return value; });
  assert.equal(game.schedule.peek('u1').remaining, 20, 'failure cannot leave a due countdown at zero');
  game.pending.shift().reject(Error('生成服務暫時失敗')); await tick();
  assert.equal(settled, false); assert.equal(game.closed, 0); assert.equal(game.active, true);
  assert.match(game.el.innerHTML, /生成服務暫時失敗/); assert.ok(game.elements.has('op-retry-load'));
  const retry = game.elements.get('op-retry-load').onclick; retry(); retry();
  assert.equal(game.calls.length, 2, 'queued double clicks cannot start parallel retries');
  assert.equal(game.calls[0].body.requestId, game.calls[1].body.requestId);
  game.pending.shift().resolve({ run: { id: 'run-1', scope: game.scope } });
  assert.equal(await opening, true); assert.deepEqual(game.opened, ['run-1']);
});
test('choosing continue after failure closes once and waits for another full encounter interval', async () => {
  const game = scenario(), opening = game.start();
  game.pending.shift().reject(Error('quota exhausted')); await tick();
  game.elements.get('op-cancel-load').onclick(); assert.equal(await opening, true);
  assert.equal(game.closed, 1); assert.equal(game.calls.length, 1);
  assert.equal(await game.start(), false); assert.equal(game.schedule.peek('u1').remaining, 19);
});

test('failed generation retains stage, question and request details for diagnosis',async()=>{
  const game=scenario(),opening=game.start();
  game.pending.shift().reject(Object.assign(Error('機緣題組未通過品質檢查'),{diagnostic:{code:'opportunity-evidence',stage:'validation',questionId:'Q2',reason:'引文不足',retryable:true}}));
  await tick();
  assert.match(game.el.innerHTML,/opportunity-evidence/);assert.match(game.el.innerHTML,/Q2/);
  assert.match(game.el.innerHTML,/validation/);assert.match(game.el.innerHTML,new RegExp(game.calls[0].body.requestId));
  game.elements.get('op-cancel-load').onclick();await opening;
});

test('a nonretryable failure keeps the return control and avoids an ineffective retry loop',async()=>{
  const game=scenario(),opening=game.start();
  game.pending.shift().reject(Object.assign(Error('修習範圍已變更'),{diagnostic:{code:'opportunity-scope',retryable:false}}));
  await tick();assert.equal(game.elements.has('op-retry-load'),false);
  game.elements.get('op-cancel-load').onclick();await opening;
});
test('cancelled or switched-account start responses cannot reopen an encounter', async () => {
  const cancelled = scenario(), opening = cancelled.start();
  cancelled.elements.get('op-cancel-load').onclick(); await opening;
  cancelled.pending.shift().resolve({ run: { id: 'late-run', scope: cancelled.scope } }); await tick();
  assert.deepEqual(cancelled.opened, []); assert.equal(cancelled.calls[1].action, 'abandon');
  cancelled.pending.shift().resolve({});
  const switched = scenario(), other = switched.start(); switched.switchAccount();
  switched.pending.shift().resolve({ run: { id: 'old-account-run', scope: switched.scope } });
  assert.equal(await other, true); assert.deepEqual(switched.opened, []); assert.equal(switched.calls.length, 1);
});
test('a deliberate close marks the encounter restored so user-ready notifications cannot reopen paused progress', () => {
  const start = source.indexOf('  function close('), end = source.indexOf('  function header(', start);
  const context = vm.createContext({ owner: 'u1', restoredAccount: '', validOwner: () => true, serial: 0, run: {}, busy: true,
    $: () => null, window: {}, document: { querySelector: () => null, body: { classList: { remove() {} } } }, escapeHandler: null, previousFocus: null });
  vm.runInContext(source.slice(start, end) + '\nclose(false);', context);
  assert.equal(context.restoredAccount, 'u1'); assert.equal(context.run, null);
});

test('a stalled authentication request cannot hold the opportunity loader forever',async()=>{
  let expire,signal,cleared=false;
  const context={AbortController,Promise,JSON,Error,
    authenticatedMainFetch:async(_path,init)=>{signal=init.signal;return new Promise(()=>{});},
    setTimeout(fn){expire=fn;return 1;},clearTimeout(){cleared=true;}};
  const a=source.indexOf('  async function request('),b=source.indexOf('  function ensureStyle()',a);
  vm.runInNewContext(source.slice(a,b)+'\nthis.request=request;',context);
  const pending=context.request('start',{requestId:'test-request-001'},90000);
  expire();
  await assert.rejects(pending,error=>error.diagnostic.code==='opportunity-client-timeout');
  assert.equal(signal.aborted,true);assert.equal(cleared,true);
});
