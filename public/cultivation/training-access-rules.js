// Shared permanent entrance gates. Current cultivation still drives realm/rewards.
(function (root) {
  'use strict';
  const REALMS = Object.freeze([0, 6, 28, 68, 188, 428, 788, 1268, 1868]);
  const PLACES = Object.freeze([
    { id: 'meditation', name: '修煉室', threshold: 28, realm: '金丹境', tab: 'core' },
    { id: 'forge', name: '鍛造坊', threshold: 6, realm: '築基初期', tab: 'refinery' },
    { id: 'contract', name: '尋器', threshold: 6, realm: '築基期', tab: 'contract' },
    { id: 'vault', name: '寶庫', threshold: 6, realm: '築基初期', tab: 'bag' },
    { id: 'secret', name: '秘境', threshold: 6, realm: '築基期', page: 'page-raid' },
    { id: 'status', name: '狀態', threshold: 0, realm: '', tab: 'status' },
    { id: 'rank', name: '仙榜', threshold: 0, realm: '', page: 'page-rank' }
  ].map(Object.freeze));
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  function realmScore(value) {
    const score = number(value);
    return REALMS.findLast(threshold => score >= threshold) || 0;
  }
  function savedScore(player) {
    return player?.trainingAccess?.version === 1 ? realmScore(player.trainingAccess.highestRealmScore) : 0;
  }
  function legacyScore(player) {
    // A remotely saved core or invested soul branches proves earlier access.
    // Empty default/local preview objects do not unlock a new account.
    const training = player?.cultivationTraining;
    const core = training?.announced === true && (training?.equippedCore?.type || training?.core?.type);
    const soul = Object.values(player?.nascentSoulGrowth?.branches || {}).some(value => number(value) > 0);
    return core ? (soul ? 68 : 28) : 0;
  }
  function score(player) {
    return Math.max(number(player?.stats?.totalScore), savedScore(player), legacyScore(player));
  }
  // Realm breakthroughs permanently add 100 max HP each after Foundation Establishment.
  // Use attained-realm access (including saved highest realm) so correcting an answer
  // cannot remove health already earned. This is a combat projection, not a DB write.
  function hpBonus(player) {
    const attained = score(player);
    return 100 * REALMS.filter(threshold => threshold >= 28 && threshold <= attained).length;
  }
  function record(player, previous = 0) {
    return { version: 1, highestRealmScore: realmScore(Math.max(score(player), number(previous))) };
  }
  function allows(player, threshold) { return score(player) >= number(threshold); }
  const api = Object.freeze({ REALMS, PLACES, number, realmScore, savedScore, legacyScore, score, hpBonus, record, allows });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QATrainingAccessRules = api;
})(globalThis);
