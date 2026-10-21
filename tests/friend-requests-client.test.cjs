'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/cultivation/friend-requests.js'), 'utf8').replace(/^import .*;\n/, '');
function client(fetcher) {
  let user = { uid: 'alice' }, local = { friends: [] }, timerId = 0;
  const nodes = new Map(), timers = new Map(), calls = [];
  const document = {
    getElementById: id => nodes.get(id), addEventListener() {},
    createElement: () => ({ setAttribute() {} }),
    head: { appendChild() {} }, body: { appendChild(el) { nodes.set(el.id, el); } }
  };
  const window = { getCurrentUserData: () => local, addEventListener() {} };
  const context = {
    window, document, console, AbortController, Date,
    getMainUser: () => user,
    authenticatedMainFetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body), signal: init.signal }); return fetcher(calls.length, init); },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source + '\nglobalThis.api = { refresh, request, receive, snapshot: () => cache };', context);
  return { ...context.api, module: window.QAFriendRequests, calls, timers, nodes, local: () => local,
    switchUser(uid) { user = { uid }; local = { friends: [] }; } };
}
const response = data => ({ ok: true, json: async () => ({ ok: true, ...data }) });
const status = friends => ({ pending: [], friends, acceptRequests: true });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('friend inbox deduplicates concurrent loads and caches foreground loads without polling', async () => {
  let finish;
  const app = client(() => new Promise(resolve => { finish = resolve; }));
  const jobs = [app.refresh(), app.refresh()]; assert.equal(app.calls.length, 1);
  finish(response(status(['bob']))); await Promise.all(jobs);
  await app.refresh(); assert.equal(app.calls.length, 1);
  assert.deepEqual(app.local().friends, ['bob']);
  assert.equal(app.timers.size, 0);
});
test('late inbox responses cannot overwrite another signed-in player or leave old cached requests', async () => {
  const finishes = [];
  const app = client(() => new Promise(resolve => { finishes.push(resolve); }));
  const old = app.refresh();
  app.switchUser('bob'); const current = app.refresh();
  finishes[1](response(status(['new-friend']))); await current;
  finishes[0](response({ ...status(['private-old-friend']), pending: [{ name: 'private' }] }));
  await assert.rejects(old, /帳號已變更/);
  assert.deepEqual(app.local().friends, ['new-friend']);
  assert.equal(app.snapshot().pending.length, 0);
});
test('multiple avatar or battle clicks share one in-flight friend request', async () => {
  let finish;
  const app = client(() => new Promise(resolve => { finish = resolve; }));
  const jobs = [app.module.send('bob'), app.module.send('bob')];
  assert.equal(app.calls.length, 1); finish(response({ sent: true }));
  assert.deepEqual(await Promise.all(jobs), [true, true]);
  assert.match(app.nodes.get('friend-request-notice').textContent, /等待對方同意/);
});
test('stalled response bodies time out and release friend controls for retry', async () => {
  const app = client(() => ({ ok: true, json: () => new Promise(() => {}) }));
  const job = app.request({ action: 'status' }); await tick();
  const watchdog = [...app.timers.values()].find(timer => timer.ms === 15000);
  watchdog.fn(); await assert.rejects(job, /逾時/);
  assert.equal(app.calls[0].signal.aborted, true); assert.equal(app.timers.size, 0);
});
test('notifications arriving during a status load cause one fresh read after the old read', async () => {
  const finishes = [];
  const app = client(() => new Promise(resolve => { finishes.push(resolve); }));
  const first = app.refresh(); app.receive(); app.receive();
  finishes[0](response(status([]))); await first; await tick();
  assert.equal(app.calls.length, 2);
  finishes[1](response({ ...status([]), pending: [{ id: 'new', name: 'Bob' }] })); await tick();
  assert.equal(app.snapshot().pending.length, 1); assert.equal(app.calls.length, 2);
});
