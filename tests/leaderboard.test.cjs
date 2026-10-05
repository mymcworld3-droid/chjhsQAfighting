const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');
const start = legacy.indexOf('// 短時間重開排行榜');
const end = legacy.indexOf('//  Visual Helpers', start);
assert.ok(start >= 0 && end > start);

function harness(players, { deferred = false } = {}) {
  const tbody = { innerHTML: '' };
  let visible = false;
  let now = 1000;
  let remote = structuredClone(players);
  const listeners = new Map();
  const reads = [];
  const requests = [];
  const context = vm.createContext({
    console: { error() {} },
    Date: { now: () => now },
    auth: { currentUser: { uid: 'me' } },
    currentUserData: { uid: 'me', stats: { totalScore: players.find(p => p.id === 'me')?.stats.totalScore || 0 } },
    db: {},
    document: { getElementById: id => id === 'leaderboard-body' ? tbody : id === 'page-rank' ? {
      classList: { contains: () => !visible }
    } : null },
    window: { addEventListener(type, fn) { listeners.set(type, fn); } },
    collection: (_, name) => name,
    orderBy: (field, direction) => ({ field, direction }),
    limit: count => ({ count }),
    query: (collection, ...constraints) => ({ collection, constraints }),
    getDocsFromServer(query) {
      reads.push(query);
      const docs = structuredClone(remote);
      for (const order of query.constraints.filter(c => c.field).reverse()) {
        docs.sort((a, b) => {
          const value = p => order.field.split('.').reduce((v, key) => v?.[key], p);
          return (value(a) - value(b)) * (order.direction === 'desc' ? -1 : 1);
        });
      }
      const top = docs.slice(0, query.constraints.find(c => c.count).count);
      const snap = { forEach: fn => top.forEach(p => fn({ id: p.id, data: () => p })) };
      if (!deferred) return Promise.resolve(snap);
      return new Promise((resolve, reject) => requests.push({ resolve: () => resolve(snap), reject }));
    },
    t: key => key,
    escapeHtml: value => String(value),
    getAvatarHtml: () => '<i>avatar</i>',
    calculateRankFromScore: score => Math.floor(score / 10),
    getRankMarkup: rank => `realm-${rank}`
  });
  vm.runInContext(readFileSync(join(__dirname, '../public/cultivation/profile-avatar.js'), 'utf8').replace(/^export /gm, ''), context);
  vm.runInContext(legacy.slice(start, end), context);
  return {
    context, tbody, reads, requests,
    load: options => context.window.loadLeaderboard(options),
    event: type => listeners.get(type)?.({}),
    score: score => { context.currentUserData.stats.totalScore = score; },
    remote: players => { remote = structuredClone(players); },
    visible: value => { visible = value; },
    advance: ms => { now += ms; }
  };
}

const player = (id, totalScore, rankLevel = 0) => ({ id, displayName: id, stats: { totalScore, rankLevel } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function names(h) { return [...h.tbody.innerHTML.matchAll(/data-xiuxian-profile="([^"]+)"/g)].filter((_, i) => i % 2 === 0).map(m => m[1]); }

test('higher cultivation ranks first despite stale, capped or missing stored realm levels', async () => {
  const missing = player('no-rank', 60);
  delete missing.stats.rankLevel;
  const h = harness([player('former-first', 20, 99), player('me', 30, 0), missing]);
  await h.load();
  assert.deepEqual(names(h), ['no-rank', 'me', 'former-first']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reads[0].constraints)), [{ field: 'stats.totalScore', direction: 'desc' }, { count: 10 }]);
  assert.match(h.tbody.innerHTML, /30 修為/);
  assert.match(h.tbody.innerHTML, /bg-blue-900\/20/, 'document UID identifies the current player even without a redundant uid field');
});

test('score ordering happens before the top ten limit so a stale realm cannot exclude the best player', async () => {
  const h = harness([...Array.from({ length: 10 }, (_, i) => player(`old-${i}`, 100 - i, 90)), player('me', 200, 0)]);
  await h.load();
  assert.equal(names(h).length, 10);
  assert.equal(names(h)[0], 'me');
});

test('unchanged stats reuse recent reads; cultivation changes invalidate without querying a hidden page', async () => {
  const h = harness([player('me', 20), player('other', 25)]);
  await h.load();
  h.event('xiuxian:stats-updated');
  await h.load();
  assert.equal(h.reads.length, 1);
  h.score(30);
  h.remote([player('me', 30), player('other', 25)]);
  h.event('xiuxian:stats-updated');
  assert.equal(h.reads.length, 1);
  await h.load();
  assert.deepEqual(names(h), ['me', 'other']);
  assert.equal(h.reads.length, 2);
});

test('a committed answer invalidates a read taken before an optimistic score was saved', async () => {
  const h = harness([player('me', 20), player('other', 25)]);
  h.score(30);
  h.event('xiuxian:stats-updated');
  await h.load();
  assert.equal(names(h)[0], 'other');
  h.remote([player('me', 30), player('other', 25)]);
  h.event('xiuxian:quest-progress-updated');
  await h.load();
  assert.equal(names(h)[0], 'me');
});

test('manual refresh and cache expiry fetch other players latest cultivation', async () => {
  const h = harness([player('me', 30), player('other', 25)]);
  await h.load();
  h.remote([player('me', 30), player('other', 40)]);
  await h.load();
  assert.equal(names(h)[0], 'me');
  await h.load({ force: true });
  assert.equal(names(h)[0], 'other');
  h.advance(120000);
  await h.load();
  assert.equal(h.reads.length, 3);
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="leaderboard-refresh" onclick="loadLeaderboard\(\{force: true\}\)"/);
});

test('simultaneous reads share one request and discard a response invalidated while in flight', async () => {
  const h = harness([player('me', 20), player('other', 25)], { deferred: true });
  const first = h.load();
  const second = h.load();
  assert.equal(h.reads.length, 1);
  h.score(30);
  h.remote([player('me', 30), player('other', 25)]);
  h.event('xiuxian:stats-updated');
  h.requests[0].resolve();
  await tick();
  assert.equal(h.reads.length, 2);
  h.requests[1].resolve();
  await Promise.all([first, second]);
  assert.equal(names(h)[0], 'me');
  await h.load();
  assert.equal(h.reads.length, 2, 'only the updated response is cached');
});

test('visible leaderboard refreshes after cultivation settles without repeated reads for other stats', async () => {
  const h = harness([player('me', 20), player('other', 25)]);
  await h.load();
  h.visible(true);
  h.score(30);
  h.remote([player('me', 30), player('other', 25)]);
  h.event('xiuxian:stats-updated');
  await tick();
  assert.equal(names(h)[0], 'me');
  h.event('xiuxian:stats-updated');
  await tick();
  assert.equal(h.reads.length, 2);
});

test('server failures show a retry message and a manual refresh can recover', async () => {
  const h = harness([player('me', 20)], { deferred: true });
  const first = h.load();
  h.requests[0].reject(new Error('offline'));
  await first;
  assert.match(h.tbody.innerHTML, /排名更新失敗/);
  const retry = h.load({ force: true });
  h.requests[1].resolve();
  await retry;
  assert.deepEqual(names(h), ['me']);
});

test('a refresh supersedes an older failing request and account changes suppress its rendering', async () => {
  const h = harness([player('me', 20)], { deferred: true });
  const first = h.load();
  const refresh = h.load({ force: true });
  h.requests[0].reject(new Error('old request failed'));
  await tick();
  assert.equal(h.reads.length, 2);
  h.requests[1].resolve();
  await Promise.all([first, refresh]);
  assert.deepEqual(names(h), ['me']);
  const next = h.load({ force: true });
  h.context.auth.currentUser = { uid: 'different' };
  h.requests[2].resolve();
  await next;
  assert.deepEqual(names(h), [], 'old account response cannot populate the table');
  const changed = h.load();
  assert.equal(h.reads.length, 4, 'new account does not reuse the old account cache');
  h.requests[3].resolve();
  await changed;
});
