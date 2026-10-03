// Shared browser/server rules. Entries describe answers, never client-selected payouts.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XianxiaBattleCultivationRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1, MAX_ROUNDS = 15;
  function roundLimit(room) {
    return Math.min(MAX_ROUNDS, Math.max(0, Math.floor(Number(room?.round) || 0)),
      Math.max(0, Math.floor(Number(room?.maxRounds) || MAX_ROUNDS)));
  }
  function answerCultivation(player) {
    const score = Number(player?.totalScore);
    return Number.isFinite(score) && score >= 28 ? 2 : 1;
  }
  function recordAnswer(room, role, correct) {
    const ledger = { ...(room?.battleCultivationLedger || {}) };
    const round = Number(room?.round);
    if (Number(room?.battleCultivationVersion) !== VERSION || !['host', 'guest'].includes(role) ||
        typeof correct !== 'boolean' || !Number.isInteger(round) || round < 1 || round > roundLimit(room)) return ledger;
    const entry = { ...(ledger[round] || {}) };
    if (typeof entry[role] !== 'boolean') entry[role] = correct;
    ledger[round] = entry;
    return ledger;
  }
  function summary(room) {
    let host = 0, guest = 0;
    if (Number(room?.battleCultivationVersion) !== VERSION) return { host, guest, pool: 0 };
    const ledger = room.battleCultivationLedger || {};
    for (let round = 1; round <= roundLimit(room); round++) {
      for (const role of ['host', 'guest']) {
        const player = room[role], stored = ledger[round]?.[role];
        // A forfeit can end the current round after submission but before combat settlement.
        const correct = typeof stored === 'boolean' ? stored :
          round === Number(room.round) && Number(player?.answerRound) === round &&
          player?.answerCorrect === true && player?.timedOut !== true;
        if (correct) {
          if (role === 'host') host += answerCultivation(player);
          else guest += answerCultivation(player);
        }
      }
    }
    return { host, guest, pool: host + guest };
  }
  function battleReward(room, uid) {
    if (!room || Number(room.modeVersion) !== 2 || room.status !== 'finished' || !uid) return null;
    const h = String(room.host?.uid || ''), g = String(room.guest?.uid || '');
    const role = uid === h ? 'host' : uid === g ? 'guest' : '';
    if (!h || !g || h === g || !role) return null;
    const outcome = room.winner === uid ? 'win' : room.winner === h || room.winner === g ? 'loss' :
      room.winner === 'draw' || !room.winner ? 'draw' : null;
    if (!outcome) return null;
    const gold = outcome === 'win' ? 500 : outcome === 'loss' ? 200 : 0;
    // Already-running legacy rooms retain their original reward agreement.
    if (Number(room.battleCultivationVersion) !== VERSION) return { role, outcome, gold, cultivation: outcome === 'win' ? 5 : 0 };
    const totals = summary(room);
    return { role, outcome, gold, cultivation: outcome === 'win' ? totals.pool : totals.pool / 2,
      cultivationPool: totals.pool, hostCultivation: totals.host, guestCultivation: totals.guest };
  }
  return Object.freeze({ VERSION, MAX_ROUNDS, answerCultivation, recordAnswer, summary, battleReward });
});
