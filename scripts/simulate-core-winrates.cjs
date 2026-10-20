'use strict';
// Use the production duel, artifact and current nascent-growth rules. No legacy tree bonuses.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const Growth = require('../public/cultivation/nascent-growth.js');
const Talents = require('../public/cultivation/soul-talents.js');
const Combo = require('../public/cultivation/combat-combo.js');
const clean = source => source.replace(/^import \{\} from .*;\n/gm, '').replace(/^export /gm, '');
const context = { window: {}, QACombatCombo: Combo, QASoulTalents: Talents };
vm.createContext(context);
for (const file of ['artifact-battle-effects.js', 'battle-engine-v2.js']) {
  vm.runInContext(clean(fs.readFileSync(path.join(root, 'public/cultivation', file), 'utf8')) +
    (file.startsWith('battle-engine') ? '\nthis.settle = settleBattleRound;' : ''), context);
}
const accuracy = Number(process.argv[2] ?? .7);
const samples = Number(process.argv[3] ?? 5000);
if (!(accuracy >= 0 && accuracy <= 1) || !Number.isInteger(samples) || samples < 2 || samples % 2) {
  throw Error('Usage: node scripts/simulate-core-winrates.cjs [accuracy 0..1] [positive even samples]');
}
const names = Object.keys(Talents.TYPES);
const totals = Object.fromEntries(names.map(type => [type, { wins: 0, draws: 0, games: 0 }]));
const rows = [];
function player(type, uid) {
  const core = { type, grade: 1 };
  const nascentSoul = Growth.bonuses({ stats: { totalScore: 180 }, cultivationTraining: { equippedCore: core },
    nascentSoulGrowth: { version: 1,
      branches: Object.fromEntries(Growth.branches(core).map(branch => [branch.id, 10])) } }, core);
  return { uid, totalScore: 180, atk: 200 + nascentSoul.attackFlat,
    hp: 1000 + nascentSoul.maxHpFlat, maxHp: 1000 + nascentSoul.maxHpFlat,
    goldenCore: core, nascentSoul, coreCorrectStreak: 0, coreShield: false, artifactBattle: { effects: [] } };
}
const rand = key => crypto.createHash('sha256').update(key).digest().readUInt32LE(0) / 4294967296;
// Pair each seed with a host/guest swap, so each core receives identical answer and initiative trials.
const trials = Array.from({ length: samples / 2 }, (_, n) => Array.from({ length: 15 }, (_, r) => {
  const round = r + 1, first = rand('order:' + n + ':' + round) < .5;
  return [{ correct: rand('host-correct:' + n + ':' + round) < accuracy, atMs: first ? 1000 : 1200 },
    { correct: rand('guest-correct:' + n + ':' + round) < accuracy, atMs: first ? 1200 : 1000 }];
}));
for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
  const result = { a: names[a], b: names[b], winsA: 0, winsB: 0, draws: 0 };
  for (let n = 0; n < samples; n++) {
    const swapped = n % 2 === 1, seed = Math.floor(n / 2);
    let host = player(names[swapped ? b : a], 'h'), guest = player(names[swapped ? a : b], 'g');
    for (let round = 1; round <= 15; round++) {
      [host.answer, guest.answer] = trials[seed][round - 1];
      const r = context.settle({ roomId: 'balanced-' + seed, round, host, guest,
        soulTalents: Talents, resolveEquipmentHit: context.window.resolveArtifactBattleHit,
        resolveGuardedFollowup: context.window.resolveArtifactGuardedFollowup,
        resolveTalentDefense: context.window.resolveArtifactBattleDefense });
      for (const [p, role] of [[host, 'host'], [guest, 'guest']]) {
        p.hp = r[role + 'Hp']; p.coreCorrectStreak = r[role + 'CoreStreak'];
        p.coreShield = r[role + 'CoreShield']; p.soulStarCorrectWindow = r[role + 'StarCorrectWindow'];
        Object.assign(p, r[role + 'ArtifactState']);
      }
      if (r.finished) {
        if (r.winnerUid === 'draw') result.draws++;
        else {
          const winner = r.winnerUid === 'h' ? host : guest;
          if (winner.goldenCore.type === names[a]) result.winsA++; else result.winsB++;
        }
        break;
      }
    }
  }
  if (result.winsA + result.winsB + result.draws !== samples) throw Error('Unfinished simulations');
  for (const [type, wins] of [[names[a], result.winsA], [names[b], result.winsB]]) {
    totals[type].wins += wins; totals[type].draws += result.draws; totals[type].games += samples;
  }
  rows.push(result);
}
const summary = Object.fromEntries(names.map(type => [type, {
  ...totals[type], meanWinPercent: 100 * (totals[type].wins + totals[type].draws / 2) / totals[type].games
}]));
console.log(JSON.stringify({ accuracy, grade: 1, samplesPerPair: samples, totalMatches: rows.length * samples,
  atk: 235, maxHp: 1250, equipment: 'none', breakthroughActive: true, maxRounds: 15,
  initiative: 'paired host/guest swaps with identical deterministic answer and initiative trials', summary, rows }, null, 2));
