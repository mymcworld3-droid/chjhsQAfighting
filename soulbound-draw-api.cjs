'use strict';
const crypto = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const access = require('./public/cultivation/training-access-rules.js');
const pool = require('./public/cultivation/soulbound-pool.js');
const fragments = require('./public/cultivation/forge-fragments.js');
const { educationCohort, ROLE_IDS } = require('./world-immortals-cleanup-api.cjs').__test;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
function reconcileLots(user, state) {
  let changed = false;
  for (const [id, prices] of Object.entries(state.lots || {})) {
    let consumed = Object.values(prices).reduce((sum, qty) => sum + number(qty), 0) - number(user.artifactSystem?.inventory?.[id]);
    // Inventory is fungible. Refining/consuming raw copies uses the lowest-priced
    // lot first, so later copies retain their actual paid price.
    for (const paid of Object.keys(prices).map(Number).sort((a, b) => a - b)) {
      if (consumed <= 0) break;
      const remove = Math.min(consumed, number(prices[paid]));
      prices[paid] -= remove; consumed -= remove; changed ||= remove > 0;
    }
  }
  return changed;
}
function requestKey(uid, id) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(String(id || ''))) throw fail('抽取請求編號無效', 400);
  return crypto.createHash('sha256').update(uid + ':' + id).digest('hex');
}
async function transaction(db, uid, action = 'view', body = {}, random = () => crypto.randomInt(0, 0x100000000) / 0x100000000) {
  const payment = body.payment || 'gold';
  if (!['gold', 'ticket'].includes(payment)) throw fail('抽取方式不正確', 400);
  const stateRef = db.collection('soulboundDrawStates').doc(uid), userRef = db.collection('users').doc(uid);
  const key = ['draw', 'redeem', 'recover'].includes(action) ? requestKey(uid, body.requestId) : null;
  const receiptRef = key ? db.collection('soulboundDrawReceipts').doc(key) : null;
  // A committed receipt survives retries, account reloads, and transaction reruns.
  return db.runTransaction(async tx => {
    const [userSnap, stateSnap, receiptSnap] = await Promise.all([
      tx.get(userRef), tx.get(stateRef), receiptRef ? tx.get(receiptRef) : null
    ]);
    if (!userSnap.exists) throw fail('玩家資料不存在', 404);
    const user = userSnap.data() || {}, state = { draws: 0, lots: {}, ...(stateSnap.data() || {}) };
    if (user.uid && user.uid !== uid) throw fail('玩家身分不符', 403);
    state.draws = number(state.draws);
    const group = educationCohort(user.profile?.educationLevel);
    const seats = group && access.score(user) >= 1868 ? await Promise.all([...ROLE_IDS].map(role =>
      tx.get(db.collection('worldImmortals').doc(group + '__' + role)))) : [];
    const immortal = seats.some(s => s.exists && s.data()?.uid === uid && s.data()?.cohort === group);
    const rank = pool.rankFor(access.score(user), immortal);
    const pendingRef = state.pending ? db.collection('soulboundDrawReceipts').doc(state.pending) : null;
    const pendingSnap = pendingRef ? await tx.get(pendingRef) : null;
    let pending = pendingSnap?.data()?.result || null, result = null;
    let stateDirty = reconcileLots(user, state);
    if (state.poolVersion !== pool.VERSION) {
      // The previous fragment pool has a valid consecutive-miss counter.
      // Earlier weapon-only pools start at zero; lifetime draws and receipts survive.
      if (state.poolVersion !== 'soulbound-v2-fragments50') state.misses = 0;
      state.poolVersion = pool.VERSION; stateDirty = true;
    }
    state.misses = Math.min(pool.PITY - 1, number(state.misses));
    if (receiptSnap?.exists) {
      const saved = receiptSnap.data();
      if (saved.action !== action || (action === 'draw' && (saved.count !== body.count || (saved.payment || 'gold') !== payment)) ||
          ((action === 'recover' || action === 'redeem') && saved.itemId !== body.itemId)) throw fail('此請求編號已用於其他操作');
      result = saved.result;
    } else if (action === 'draw') {
      if (body.poolVersion !== pool.VERSION) throw fail('獎池已更新，請重新整理契器台後抽取');
      if (![1, 5].includes(body.count)) throw fail('只能選擇單抽或五連抽', 400);
      if (rank < 0) throw fail('金丹境開放締結本命');
      if (pending) throw fail('請先查看並收入上一批抽取結果');
      const ticketsSpent = payment === 'ticket' ? body.count : 0;
      const cost = ticketsSpent ? 0 : pool.cost(rank, state.draws, body.count);
      if (body.expectedCost !== undefined && body.expectedCost !== cost) throw fail('境界或價格已更新，請重新同步後抽取');
      if (number(user.stats?.gold) < cost) throw fail('靈石不足');
      if (number(user.soulboundDrawTickets) < ticketsSpent) throw fail('本命法器抽獎券不足');
      const results = Array.from({ length: body.count }, (_, index) => {
        const ordinal = state.draws + index + 1, paid = ticketsSpent ? 0 : ordinal === 1 ? 250 : pool.price(rank);
        const row = { ...pool.roll(rank, state.misses, random), ordinal, paid };
        if (row.kind === 'weapon') {
          user.artifactSystem ||= {}; user.artifactSystem.inventory ||= {};
          user.artifactSystem.inventory[row.itemId] = number(user.artifactSystem.inventory[row.itemId]) + 1;
          state.misses = 0;
        } else {
          user.stats ||= {}; user.forgeFragments = fragments.balance(user) + row.fragments;
          state.misses += 1;
        }
        return row;
      });
      user.stats ||= {};
      user.stats.gold = number(user.stats.gold) - cost;
      user.soulboundDrawTickets = number(user.soulboundDrawTickets) - ticketsSpent;
      state.draws += body.count; state.pending = key;
      result = { requestId: body.requestId, poolVersion: pool.VERSION, createdAtMs: Date.now(), cost, payment, ticketsSpent, results };
      pending = result;
      tx.update(userRef, { 'stats.gold': user.stats.gold, soulboundDrawTickets:user.soulboundDrawTickets, 'forgeFragments':fragments.balance(user), 'artifactSystem.inventory': user.artifactSystem?.inventory || {} });
      stateDirty = true;
      tx.create(receiptRef, { uid, action, count: body.count, payment, result });
    } else if (action === 'redeem') {
      if (body.poolVersion !== pool.VERSION) throw fail('獎池已更新，請重新整理契器台後兌換');
      if (rank < 0) throw fail('金丹境開放締結本命');
      if (pending) throw fail('請先查看並收入上一批抽取結果');
      const item = pool.get(body.itemId);
      if (!item || !pool.candidates(rank).some(row => row.id === item.id)) {
        throw fail('只能兌換目前境界的常駐本命法器', 400);
      }
      const cost = pool.redemptionCost(rank);
      if (body.expectedFragments !== cost) throw fail('碎片兌換價格已更新，請重新同步後兌換');
      const available = fragments.balance(user);
      if (available < cost) throw fail('煉器碎片不足');
      user.artifactSystem ||= {}; user.artifactSystem.inventory ||= {};
      user.artifactSystem.inventory[item.id] = number(user.artifactSystem.inventory[item.id]) + 1;
      user.forgeFragments = available - cost;
      result = { requestId:body.requestId, kind:'redemption', itemId:item.id, name:item.name, costFragments:cost };
      tx.update(userRef, { 'forgeFragments':user.forgeFragments, 'artifactSystem.inventory':user.artifactSystem.inventory });
      tx.create(receiptRef, { uid, action, itemId:item.id, result });
    } else if (action === 'recover') {
      throw fail('原器回收已改為碎片分解，請從背包或煉器的「物品分解」操作');
    } else if (action === 'ack') {
      if (pending && pending.requestId === body.requestId) {
        state.pending = null; pending = null; stateDirty = true;
      }
    }
    if (stateDirty) tx.set(stateRef, state);
    return { ok: true, result, pending, balance: number(user.stats?.gold), drawTickets:number(user.soulboundDrawTickets), fragments:fragments.balance(user), inventory: user.artifactSystem?.inventory || {},
      draws: state.draws, misses:state.misses, untilPity: pool.PITY - state.misses, poolVersion: pool.VERSION, rank, realm: pool.REALMS[rank]?.name || null,
      prices: rank < 0 ? null : { single: pool.cost(rank, state.draws, 1), five: pool.cost(rank, state.draws, 5) },
      redemptionCost: rank < 0 ? null : pool.redemptionCost(rank), recovery: [] };
  });
}
function createHandler({ action = 'view', resolveA = () => playerRepository.resolve(), logger = console } = {}) {
  return async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
      if (!token) throw fail('請先登入', 401);
      const a = resolveA(); let identity;
      try { identity = await a.auth.verifyIdToken(token[1], true); } catch (_) { throw fail('登入狀態已失效，請重新登入', 401); }
      if (!identity?.uid || identity.aud !== PROJECT_IDS.A || identity.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) throw fail('登入身分驗證失敗', 401);
      return res.json(await transaction(a.db, identity.uid, action, req.body || {}));
    } catch (e) {
      if (!e.status) logger.error('[Soulbound draw]', e.code || e.message);
      return res.status(e.status || 503).json({ ok: false, error: e.status ? e.message : '契器台同步暫時未完成，請重試原操作' });
    }
  };
}
module.exports = app => {
  app.get('/api/soulbound', createHandler());
  for (const action of ['draw', 'ack', 'recover', 'redeem']) app.post('/api/soulbound/' + action, createHandler({ action }));
};
module.exports.__test = { transaction, createHandler, requestKey, reconcileLots };
