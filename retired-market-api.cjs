'use strict';

const { playerRepository } = require('./server-repositories.cjs');
const { verifyMainIdentity } = require('./raid-question-ticket.cjs');

const PAGE_SIZE = 50;
const INVENTORY_FIELDS = new Map([
  ['artifact', 'artifactSystem'],
  ['material', 'materialSystem']
]);

async function returnMarketEscrow(db, uid) {
  const playerRef = db.collection('users').doc(uid);
  const pending = db.collection('marketListings').where('sellerUid', '==', uid)
    .where('status', '==', 'active').limit(PAGE_SIZE);
  let page = await pending.get();
  while (page.docs.length) {
    await db.runTransaction(async tx => {
      const [playerSnap, ...listings] = await Promise.all([
        tx.get(playerRef), ...page.docs.map(listing => tx.get(listing.ref))
      ]);
      if (!playerSnap.exists) return;
      const player = playerSnap.data();
      if (player.uid && player.uid !== uid) return;

      const patch = {};
      for (const listingSnap of listings) {
        const listing = listingSnap.data();
        if (listing?.status !== 'active' || listing.sellerUid !== uid) continue;
        if (listing.type !== 'recipe') {
          const system = INVENTORY_FIELDS.get(listing.type);
          const { itemId, quantity } = listing;
          if (!system || typeof itemId !== 'string' || !itemId || itemId.length > 160 ||
              /[\u0000-\u001f/]/.test(itemId) || ['__proto__', 'constructor', 'prototype'].includes(itemId) ||
              !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) continue;

          const field = `${system}.inventory`;
          const inventory = patch[field] ?? { ...player[system]?.inventory };
          const current = Math.max(0, Math.floor(Number(inventory[itemId]) || 0));
          const restored = current + quantity;
          if (!Number.isSafeInteger(restored)) continue;
          inventory[itemId] = restored;
          patch[field] = inventory;
        }
        // Recipe listings held no physical inventory. Cancel those offers without changing licenses.
        tx.update(listingSnap.ref, { status: 'cancelled', completedAtMs: Date.now() });
      }
      if (Object.keys(patch).length) tx.update(playerRef, patch);
    });
    if (page.docs.length < PAGE_SIZE) break;
    page = await pending.startAfter(page.docs.at(-1)).get();
  }
}

function registerRetiredMarketApi(app, { resolveA = () => playerRepository.resolve() } = {}) {
  app.post('/api/inventory/retired-market-returns', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let project;
    try {
      const uid = await verifyMainIdentity(req, { resolveA: () => (project ??= resolveA()) });
      await returnMarketEscrow(project.db, uid);
      return res.status(204).end();
    } catch (error) {
      if (error.status === 401) return res.status(401).json({ error: '請先登入。' });
      console.warn('[Retired market returns]', error.code || 'unavailable');
      return res.status(503).json({ error: '暫時無法退還寄售物品。' });
    }
  });
}

module.exports = { registerRetiredMarketApi, returnMarketEscrow };
