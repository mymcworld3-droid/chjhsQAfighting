'use strict';
const Growth = require('../../public/cultivation/nascent-growth.js');
const Innate = require('../../public/cultivation/innate-ability.js');
const Access = require('../../public/cultivation/training-access-rules.js');

// Explicit inputs for unit-testing retained legacy battle rules. Active account
// projection deliberately strips these fields; never use that projection to
// arrange a test that needs an old core, soul or innate ability.
module.exports = function legacyRuleFighter(player, uid = 'h') {
  const goldenCore = player.cultivationTraining?.coreEnabled === false
    ? null : player.cultivationTraining?.equippedCore || null;
  const nascentSoul = Growth.bonuses(player, goldenCore);
  const atk = (player.stats?.attack ?? 200) + (nascentSoul?.attackFlat || 0);
  const maxHp = (player.stats?.maxHp ?? 1000) + Access.hpBonus(player) + (nascentSoul?.maxHpFlat || 0);
  return {
    uid, totalScore: player.stats?.totalScore || 0, trainingAccessScore: Access.score(player),
    atk, hp: maxHp, maxHp, goldenCore, nascentSoul,
    innateAbility: Innate.snapshot(player), innateAbilityState: null,
    coreShield: false, coreCorrectStreak: 0,
    artifactBattle: {version: 1, effects: [], openingShield: 0}, artifactShield: 0,
    artifactFirstHitUsed: false, artifactCheatDeathUsed: false
  };
};
