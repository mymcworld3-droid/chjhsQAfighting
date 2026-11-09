'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const Access = require('../public/cultivation/training-access-rules.js');
const Raid = require('../raid-authority.cjs');
const Immortal = require('../immortal-avatar-combat.cjs');

test('every realm and an older high-water save project the same base max HP', () => {
  for (const totalScore of [...Access.REALMS, 99999]) {
    const player = { stats: { totalScore, attack: 200, maxHp: 1020 },
      trainingAccess: { version: 1, highestRealmScore: 1868 } };
    assert.equal(Raid.trustedRaidPlayerSnapshot(player, 'h').baseMaxHp, 1020);
    assert.equal(Immortal.snapshot('h', player).baseMaxHp, 1020);
  }
});

test('browser stats use the saved base plus path and previously earned soul bonuses', () => {
  const user = { stats: { attack: 200, hp: 900, maxHp: 1000, totalScore: 188 } };
  const window = { getCurrentUserData: () => user, getNascentSoulBattleSnapshot: () => null,
    addEventListener() {} };
  const document = { readyState: 'loading', addEventListener() {} };
  const source = read('public/cultivation/cultivation-combat-stats.js').replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, { window, document });
  const stats = () => JSON.parse(JSON.stringify(window.getCombatStats()));
  assert.deepEqual(stats(), { attack: 200, maxHp: 1000, hp: 900 });
  window.QACultivationRebootClient = { bonuses: () => ({ attack: 4, maxHp: 20 }) };
  window.getNascentSoulBattleSnapshot = () => ({ attackFlat: 35, maxHpFlat: 250 });
  assert.deepEqual(stats(), { attack: 239, maxHp: 1270, hp: 1143 });
  assert.equal(user.stats.maxHp, 1000);
  user.stats.totalScore = 27;
  assert.equal(stats().maxHp, 1270);
});

test('trusted raid and immortal snapshots keep existing invested soul HP', () => {
  const user = { stats: { attack: 200, maxHp: 1000, totalScore: 188 },
    cultivationTraining: { coreEnabled: true, equippedCore: { type: 'ocean', grade: 1 } },
    nascentSoulGrowth: { version: 1, branches: { attack: 10, vitality: 10, core: 10, cultivation: 10 } } };
  const builds = [Raid.trustedRaidPlayerSnapshot(user, 'h'), Immortal.snapshot('h', user)];
  for (const build of builds) {
    assert.equal(build.baseMaxHp, 1000);
    assert.equal(build.maxHp, 1250);
    assert.equal(build.atk, 235);
  }
});

test('combat power displays path HP and has no automatic realm contribution', () => {
  const user = { stats: { attack: 200, maxHp: 1000, totalScore: 188 } };
  const window = { getCurrentUserData: () => user };
  const context = { window, ARTIFACT_EQUIP_SLOTS: [], getArtifactById: () => null, realmOrderByName: () => 0 };
  const source = read('public/cultivation/combat-power.js').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(source + '\nthis.calculate=getCurrentCombatPower;', context);
  assert.equal(context.calculate().base, 600);
  window.QACultivationRebootClient = { bonuses: () => ({ attack: 4, maxHp: 20 }) };
  assert.equal(context.calculate().base, 612);
  assert.equal(context.calculate().equipment, 0);
});
