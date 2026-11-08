'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { setup } = require('./helpers/d1-db.cjs');
const { PROJECT_IDS } = require('../firebase-admin-projects.cjs');
const { buildTarget } = require('../d1-browser-api.cjs');
const { registerRetiredMarketApi, returnMarketEscrow } = require('../retired-market-api.cjs');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');

test('the store opens directly to system goods without a player trading module', () => {
  const html = read('public/index.html');
  const store = html.slice(html.indexOf('id="page-store"'), html.indexOf('id="page-battle"'));
  for (const category of ['all', 'frame', 'avatar']) assert.ok(store.includes(`filterStore('${category}', this)`));
  assert.match(store, /id="store-grid"/);
  assert.match(store, /onclick="unequipAvatar\(\)"/);
  assert.doesNotMatch(store, /player-market|pm-view-/);
  assert.doesNotMatch(read('public/main.js'), /player-marketplace|openPlayerMarketplace/);
  assert.doesNotMatch(read('public/cultivation/cultivation-refinery-v2.js'), /openPlayerMarketplace|交易市集/);
  assert.equal(existsSync(join(__dirname, '../public/cultivation/player-marketplace.js')), false);
});

test('D1 browser targets reject the retired collection and still resolve system products', () => {
  const { db } = setup();
  const target = { role: 'A', kind: 'query', constraints: [] };
  assert.throws(() => buildTarget(db, { ...target, path: 'marketListings' }), { status: 403 });
  assert.throws(() => buildTarget(db, { ...target, kind: 'doc', path: 'marketListings/item' }), { status: 403 });
  assert.equal(buildTarget(db, { ...target, path: 'products' }).path, 'products');
});

test('concurrent returns restore only the owner’s active escrow and preserve equipped items, gold and licenses', async () => {
  const { db } = setup();
  const player = db.doc('users/alice');
  const original = {
    uid: 'alice', stats: { gold: 100 }, recipeLicenses: { learned: true },
    artifactSystem: { inventory: { sword: 1 }, equipped: { weapon: 'sword' } },
    materialSystem: { inventory: { stone: 2 }, metadata: { source: 'raid' } }
  };
  await player.set(original);
  const listings = db.collection('marketListings');
  const listing = { sellerUid: 'alice', type: 'artifact', itemId: 'sword', quantity: 2, status: 'active' };
  await listings.doc('weapon').set(listing);
  await listings.doc('weapon-2').set({ ...listing, quantity: 1 });
  await listings.doc('material').set({ ...listing, type: 'material', itemId: 'stone', quantity: 3 });
  await listings.doc('guide').set({ ...listing, type: 'recipe', itemId: 'new-guide', quantity: 1 });
  await listings.doc('sold').set({ ...listing, status: 'sold', buyerUid: 'bob' });
  await listings.doc('cancelled').set({ ...listing, status: 'cancelled' });
  await listings.doc('other').set({ ...listing, sellerUid: 'bob' });

  await Promise.all([returnMarketEscrow(db, 'alice'), returnMarketEscrow(db, 'alice')]);
  await returnMarketEscrow(db, 'alice');

  assert.deepEqual((await player.get()).data(), {
    ...original,
    artifactSystem: { ...original.artifactSystem, inventory: { sword: 4 } },
    materialSystem: { ...original.materialSystem, inventory: { stone: 5 } }
  });
  for (const id of ['weapon', 'weapon-2', 'material', 'guide']) {
    const row = (await listings.doc(id).get()).data();
    assert.equal(row.status, 'cancelled');
    assert.ok(row.completedAtMs > 0);
  }
  assert.equal((await listings.doc('sold').get()).data().status, 'sold');
  assert.equal((await listings.doc('cancelled').get()).data().completedAtMs, undefined);
  assert.equal((await listings.doc('other').get()).data().status, 'active');
});

test('the return walks multiple pages and preserves malformed listings without minting inventory', async () => {
  const { db } = setup();
  const player = db.doc('users/alice');
  await player.set({ uid: 'alice' });
  const listings = db.collection('marketListings');
  const batch = db.batch();
  const listing = { sellerUid: 'alice', type: 'artifact', itemId: 'bow', quantity: 1, status: 'active' };
  batch.set(listings.doc('a-invalid'), { ...listing, itemId: '__proto__' });
  for (let i = 0; i < 51; i++) batch.set(listings.doc(`bow-${i}`), listing);
  await batch.commit();

  await returnMarketEscrow(db, 'alice');

  assert.deepEqual((await player.get()).data().artifactSystem.inventory, { bow: 51 });
  const remaining = await listings.where('status', '==', 'active').get();
  assert.deepEqual(remaining.docs.map(doc => doc.id), ['a-invalid']);
});

test('the return endpoint authenticates the caller and ignores any supplied player ID', async () => {
  const { db } = setup();
  await db.doc('users/alice').set({ uid: 'alice' });
  await db.doc('users/bob').set({ uid: 'bob' });
  for (const uid of ['alice', 'bob']) {
    await db.doc(`marketListings/${uid}`).set({ sellerUid: uid, type: 'artifact', itemId: 'blade', quantity: 1, status: 'active' });
  }
  let handler;
  registerRetiredMarketApi({ post: (path, route) => { handler = route; } }, {
    resolveA: () => ({ db, auth: { verifyIdToken: async () => ({ uid: 'alice', aud: PROJECT_IDS.A,
      iss: 'https://securetoken.google.com/' + PROJECT_IDS.A }) } })
  });
  const res = { set() {}, status(code) { this.code = code; return this; }, end() {}, json() {} };
  await handler({ get: () => '' }, res);
  assert.equal(res.code, 401);
  await handler({ get: () => 'Bearer token', body: { uid: 'bob' } }, res);
  assert.equal(res.code, 204);
  assert.equal((await db.doc('users/alice').get()).data().artifactSystem.inventory.blade, 1);
  assert.equal((await db.doc('users/bob').get()).data().artifactSystem, undefined);
  assert.equal((await db.doc('marketListings/bob').get()).data().status, 'active');
});
