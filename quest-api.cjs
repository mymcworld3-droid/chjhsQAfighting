'use strict';
const { playerRepository } = require('./server-repositories.cjs');
const { PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const rules = require('./public/cultivation/quest-rules.js');
const error = (message, status = 409) => Object.assign(new Error(message), { status });

// Claim state lives outside the client-written player document. The same
// transaction advances the chain and deposits rewards, including materials.
async function questTransaction(db, uid, request = null, now = new Date()) {
  const date = rules.dateKey(now), userRef = db.collection('users').doc(uid),
    stateRef = db.collection('questStates').doc(uid),
    enlightenmentRef = db.collection('enlightenmentTrialStates').doc(uid);
  return db.runTransaction(async tx => {
    const [userSnap, stateSnap, enlightenmentSnap] = await Promise.all([tx.get(userRef), tx.get(stateRef), tx.get(enlightenmentRef)]);
    if (!userSnap.exists) throw error('玩家資料不存在', 404);
    const user = userSnap.data() || {}, rawState = stateSnap.exists ? stateSnap.data() : {};
    if (user.uid && user.uid !== uid) throw error('玩家身分不符', 403);
    const state = rules.normalizeState(rawState, date);
    const verifiedTrial = enlightenmentSnap.exists ? enlightenmentSnap.data() : null;
    let stateChanged = false;
    // Mint today's assignments once on the server; a new realm or ability score
    // cannot reshuffle missions halfway through the day.
    if (state.commissionDate !== date || state.commissionIds.length !== 2) {
      state.commissionDate = date;
      state.commissionIds = rules.dailyCommissions(user, uid, date).map(q=>q.id);
      state.commissionClaimed = [];
      stateChanged = true;
    }
    let awarded = false, reward = null;
    if (request) {
      if (!['path', 'daily', 'commission'].includes(request.kind)) throw error('任務類型無效', 400);
      if (request.kind !== 'path' && request.date !== date) throw error('今日委託已跨日，請重新查看今日任務');
      const list = request.kind === 'path' ? rules.PATH : request.kind === 'daily' ? rules.DAILY : rules.COMMISSION_POOL;
      const index = list.findIndex(q => q.id === request.id);
      if (index < 0 || (request.kind === 'commission' && !state.commissionIds.includes(request.id)))
        throw error('找不到今日指定的委託', 400);
      const duplicate = request.kind === 'path' ? state.pathClaimed.includes(request.id)
        : request.kind === 'commission' ? state.commissionClaimed.includes(request.id)
        : state.dailyClaimed.includes(request.id);
      const ticketOnly = request.kind === 'path' && duplicate && list[index].reward.drawTickets > 0 &&
        (state.pathTicketAmounts[request.id] || 0) < list[index].reward.drawTickets;
      if (!duplicate || ticketOnly) {
        const snapshot = rules.view(user, state, date, verifiedTrial);
        const q = ticketOnly ? snapshot.pathTicketRewards.find(q => q.id === request.id)
          : request.kind === 'path' ? snapshot.path
          : request.kind === 'commission' ? snapshot.commissions.find(q => q.id === request.id)
          : snapshot.daily.find(q => q.id === request.id);
        if (!q || q.id !== request.id || !q.claimable) throw error('任務尚未完成，請先達成目標');
        reward = q.reward;
        const patch = {
          'stats.gold': Math.max(0, Number(user.stats?.gold) || 0) + reward.gold,
          'stats.totalScore': Math.max(0, Number(user.stats?.totalScore) || 0) + reward.cultivation
        };
        user.stats = { ...(user.stats || {}), gold: patch['stats.gold'], totalScore: patch['stats.totalScore'] };
        if (reward.drawTickets) {
          user.soulboundDrawTickets = Math.max(0, Math.floor(Number(user.soulboundDrawTickets) || 0)) + reward.drawTickets;
          patch.soulboundDrawTickets = user.soulboundDrawTickets;
          state.pathTicketAmounts[request.id] = (state.pathTicketAmounts[request.id] || 0) + reward.drawTickets;
        }
        for (const [id, amount] of Object.entries(reward.materials)) {
          const quantity = Math.max(0, Math.floor(Number(user.materialSystem?.inventory?.[id]) || 0)) + amount;
          patch[`materialSystem.inventory.${id}`] = quantity;
          user.materialSystem = { ...(user.materialSystem || {}), inventory: { ...(user.materialSystem?.inventory || {}), [id]: quantity } };
        }
        if (request.kind === 'path') {
          if (!duplicate) state.pathClaimed.push(request.id);
          Object.assign(state, rules.normalizeState(state, date));
        } else if (request.kind === 'commission') state.commissionClaimed.push(request.id);
        else state.dailyClaimed.push(request.id);
        tx.update(userRef, patch);
        stateChanged = true;
        awarded = true;
      }
    }
    if (stateChanged) tx.set(stateRef, state);
    return { ok: true, awarded, reward, quests: rules.view(user, state, date, verifiedTrial),
      drawTickets: Math.max(0, Math.floor(Number(user.soulboundDrawTickets) || 0)),
      balances: { gold: Math.max(0, Number(user.stats?.gold) || 0), totalScore: Math.max(0, Number(user.stats?.totalScore) || 0) },
      materials: Object.fromEntries(['raid-refine-key-ii', 'raid-refine-key-iii'].map(id => [id, Math.max(0, Number(user.materialSystem?.inventory?.[id]) || 0)])) };
  });
}
function createHandler({ resolveA = () => playerRepository.resolve(), claim = false, logger = console, now = () => new Date() } = {}) {
  return async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
      if (!bearer) throw error('請先登入後再查看任務', 401);
      const a = resolveA();
      let identity;
      try { identity = await a.auth.verifyIdToken(bearer[1], true); } catch (_) { throw error('登入狀態已失效，請重新登入', 401); }
      if (!identity?.uid || identity.aud !== PROJECT_IDS.A || identity.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) throw error('登入身分驗證失敗', 401);
      const request = claim ? { kind: req.body?.kind, id: req.body?.id, date: req.body?.date } : null;
      return res.json(await questTransaction(a.db, identity.uid, request, now()));
    } catch (e) {
      if (!e.status) logger.error('[Quests]', e.code || e.message);
      return res.status(e.status || 503).json({ ok: false, error: e.status ? e.message : '任務同步尚未完成，請稍後重試' });
    }
  };
}
module.exports = app => {
  app.get('/api/quests', createHandler());
  app.post('/api/quests/claim', createHandler({ claim: true }));
};
module.exports.__test = { questTransaction, createHandler };
