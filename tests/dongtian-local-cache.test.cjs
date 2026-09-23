const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/cultivation/dongtian-cache.js'), 'utf8');
const caveSource = readFileSync(join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');
function setup(storage = new Map(), now = Date.now) {
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const context = vm.createContext({ localStorage, Map, Array, JSON, Date: { now } });
  vm.runInContext(source.replace('export const dongtianCache =', 'const dongtianCache =') + '\nthis.cache = dongtianCache;', context);
  return context.cache;
}

test('own cave listing is persisted between reloads and isolated by account', () => {
  const storage = new Map();
  const one = setup(storage);
  const a = [{ id: 'd1', ownerUid: 'a', status: 'active' }];
  one.setOwnedList('a', a);
  assert.equal(setup(storage).getOwnedList('a')[0].id, 'd1');
  assert.equal(setup(storage).getOwnedList('b'), null);
  one.setOwnedList('b', a);
  assert.equal(setup(storage).getOwnedList('b'), null, 'owner data must not cross accounts');
});

test('own cave questions are cached and removed only for that cave', () => {
  const storage = new Map();
  const cache = setup(storage);
  const a = { id: 'd1', ownerUid: 'a', questions: [{ q: 'Q' }] };
  cache.setFull('a', 'd1', a);
  cache.setFull('b', 'd1', { ...a, ownerUid: 'b' });
  assert.equal(setup(storage).getFull('a', 'd1').questions[0].q, 'Q');
  assert.equal(cache.getFull('b', 'd1').ownerUid, 'b');
  cache.removeFull('a', 'd1');
  assert.equal(setup(storage).getFull('a', 'd1'), null);
  assert.equal(cache.getFull('b', 'd1').ownerUid, 'b');
});

test('manual refresh invalidates owner full data and public discovery but retains own listing', () => {
  const cache = setup();
  cache.setOwnedList('a', [{ id: 'd1', ownerUid: 'a' }]);
  cache.setFull('a', 'd1', { id: 'd1', ownerUid: 'a', questions: [{ q: 'Q' }] });
  cache.setPublicList([{ id: 'x', status: 'active' }]);
  cache.clearOwnerFull('a');
  cache.clearPublicList();
  assert.equal(cache.getFull('a', 'd1'), null);
  assert.equal(cache.getPublicList(), null);
  assert.equal(cache.getOwnedList('a')[0].id, 'd1');
});

test('public encounter list expires after one minute, including an empty cached list', () => {
  const storage = new Map();
  const clock = { now: 1000 };
  const cache = setup(storage, () => clock.now);
  cache.setPublicList([{ id: 'd1', status: 'active' }]);
  assert.equal(cache.getPublicList()[0].id, 'd1');
  clock.now += 59 * 1000;
  assert.equal(cache.getPublicList()[0].id, 'd1');
  clock.now += 1000;
  assert.equal(cache.getPublicList(), null, 'other players may have created a new cave');
  cache.setPublicList([]);
  assert.equal(cache.getPublicList().length, 0);
  clock.now += 60 * 1000;
  assert.equal(cache.getPublicList(), null, 'empty discovery results must expire too');
});

test('legacy untimed public cache is discarded, while own question cache is unchanged', () => {
  const storage = new Map();
  storage.set('xiuxian:dongtian:v1:public', JSON.stringify([{ id: 'old', status: 'active' }]));
  const cache = setup(storage);
  assert.equal(cache.getPublicList(), null);
  cache.setFull('a', 'mine', { id: 'mine', ownerUid: 'a', questions: [{ q: 'Q' }] });
  assert.equal(cache.getFull('a', 'mine').questions[0].q, 'Q');
});

test('confirmed encounters are locally memoized without caching negative play checks', () => {
  const cache = setup();
  assert.equal(cache.hasEncountered('a', 'd1'), false);
  cache.markEncountered('a', 'd1');
  assert.equal(cache.hasEncountered('a', 'd1'), true);
  assert.equal(cache.hasEncountered('b', 'd1'), false);
});

test('cave UI has manual refresh and does not forcibly reload on browser focus', () => {
  assert.match(caveSource, /id="dt-refresh"/);
  assert.match(caveSource, /dongtianCache\.clearOwnerFull\(uid\(\)\)/);
  assert.match(caveSource, /await loadOwnDongtians\(true\)/);
  assert.doesNotMatch(caveSource, /addEventListener\('focus',/);
  assert.match(caveSource, /if \(!force && renderCachedOwnList\(\)\) return/);
  assert.match(caveSource, /dongtianCache\.getPublicList\(\)/);
  assert.match(caveSource, /dongtianCache\.markEncountered\(visitor, item\.id\)/);
  assert.match(caveSource, /getDoc\(doc\(db, INDEX_COLLECTION, caveId\)\)/);
  assert.match(caveSource, /const result = await readSessionDongtianStatus\(s\.dongtian\.id\)/);
  assert.match(caveSource, /await runTransaction\(db,/);
});
