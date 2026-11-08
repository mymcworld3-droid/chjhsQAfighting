'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Rules = require('../public/cultivation/cultivation-reboot-rules.js');
const Access = require('../public/cultivation/training-access-rules.js');
const Reboot = require('../cultivation-reboot-api.cjs');
const Tower = require('../martial-trial-api.cjs').__test;
const { questTransaction } = require('../quest-api.cjs').__test;
const { PATH } = require('../public/cultivation/quest-rules.js');
const { setup } = require('./helpers/d1-db.cjs');

function fixture(score = 6) {
  const { db } = setup();
  const player = { uid: 'u1', stats: { totalScore: score, gold: 80, attack: 200, maxHp: 1000 },
    artifactSystem: { inventory: { legacy: 2 }, equipped: { 本命法寶: 'legacy' } },
    materialSystem: { inventory: { 'raid-refine-key-ii': 3, 'nascent-soul-essence': 5 } },
    forgeFragments: 22, soulboundDrawTickets: 4 };
  const user = db.collection('users').doc('u1');
  return { db, player, user, save: () => user.set(player),
    sync: () => Reboot.transact(db, 'u1', { action: 'sync' }),
    move: (state, action, fields = {}) => Reboot.transact(db, 'u1', { ...fields, action, revision: state.revision }) };
}

test('the branch keeps only the live cultivation entrances and retains the shared backend', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const startup = read('public/main.js'), html = read('public/index.html'), server = read('server.js');
  assert.doesNotMatch(startup, /\/(?:raid-mode|artifact-system|soulbound-draw|simple-forge|material-system|inventory-dismantle)\.js/);
  assert.doesNotMatch(html, /<button[^>]*(?:id="sect-raid-entry"|id="nav-contract"|data-training-tab="refinery")|<section[^>]*id="admin-artifact-manager"/);
  assert.match(html, /data-open-cultivation-path aria-haspopup="dialog"/);
  assert.match(startup, /cultivation-reboot-ui\.js/);
  assert.match(server, /registerCultivationReboot\(app\)/);
  assert.doesNotMatch(server, /registerRaidRoomApi|registerSimpleForgeApi|registerSoulboundDrawApi/);
  for (const id of ['meditation', 'vault', 'status', 'rank']) assert.ok(Access.PLACES.some(place => place.id === id));
});

for (const [id, route] of Object.entries(Rules.ROUTES)) {
  test(`${route.name} wins its own five-wave trial, and blindly defending fails`, () => {
    const play = moves => moves.reduce((state, move) =>
      state.status === 'active' ? Rules.playTurn(id, state, move) : state, Rules.newAttempt('test'));
    const won = play(route.waves.map(wave => wave[2]));
    assert.equal(won.status, 'passed');
    assert.equal(won.round, 5);
    assert.equal(won.seals, Rules.TRIAL.seals);
    assert.equal(play(Array(5).fill('guard')).status, 'failed');
    assert.equal(Rules.playTurn(id, { ...Rules.newAttempt('test'), energy: 1 }, 'strike'), null);
  });
}

test('each training path has its own mastery progression and core resonance', () => {
  const bonus = (route, foundation, technique, seal = null, core = false) =>
    Rules.bonuses({ route, training: { foundation, technique }, seal }, core);
  assert.equal(bonus('sword', 4, 0).attack - bonus('sword', 3, 0).attack, 12);
  assert.equal(bonus('body', 2, 0).effects[0].value, 22);
  assert.equal(bonus('spell', 0, 3).effects[0].value, 24);
  assert.equal(bonus('insight', 2, 2).effects[0].value, 0.066);
  assert.equal(bonus('insight', 2, 2, { achievedAtMs: 1 }, true).effects[0].value, 0.096);
});

test('route, training and the last trial turn are transactional across tabs and relogin', async () => {
  const { db, save, user, sync, move, player } = fixture();
  await save();
  await assert.rejects(move({ revision: 0 }, 'choose', { route: 'body' }), /先同步/);
  let { state } = await sync();
  assert.equal(state.legacyAccess, false);
  await assert.rejects(move(state, 'choose', { route: ['body'] }), /未知的修行流派/);
  ({ state } = await move(state, 'choose', { route: 'body' }));
  await assert.rejects(move(state, 'choose', { route: 'sword' }), /已立下流派/);
  const results = await Promise.allSettled([move(state, 'train', { track: 'foundation' }),
    move(state, 'train', { track: 'technique' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  ({ state } = await sync());
  assert.equal(state.training.foundation + state.training.technique, 1);
  await assert.rejects(move(state, 'start'), /金丹修為/);
  await user.update({ 'stats.totalScore': 82, 'stats.rankLevel': 10, trainingAccess: { version: 1, highestRealmScore: 68 } });
  ({ state } = await sync());
  assert.equal(state.legacyAccess, false, 'later shared milestones never bypass the trial');
  assert.equal(Rules.realmScore(82, state), 27);
  assert.equal(Rules.availablePoints(state), 6);
  ({ state } = await move(state, 'start'));
  for (const [round, wave] of Rules.ROUTES.body.waves.entries()) {
    if (round === 2) ({ state } = await sync());
    const fields = { attemptId: state.trial.id, round, move: wave[2] };
    const before = state;
    ({ state } = await move(state, 'turn', fields));
    await assert.rejects(move(before, 'turn', fields), /另一處更新/);
  }
  assert.equal(state.trial.status, 'passed');
  assert.equal(state.seal.attemptId, state.trial.id);
  const stored = (await Reboot.stateRef(db, 'u1').get()).data();
  assert.deepEqual((await sync()).state, stored);
  assert.equal(Rules.realmScore(82, stored), 82);
  const shared = (await user.get()).data();
  assert.deepEqual(shared.stats, { ...player.stats, totalScore: 82, rankLevel: 10 });
  for (const key of ['artifactSystem', 'materialSystem', 'forgeFragments', 'soulboundDrawTickets'])
    assert.deepEqual(shared[key], player[key]);
  await user.update({ 'stats.totalScore': 24 });
  const current = await sync();
  assert.equal(Rules.realmScore(current.score, current.state), 28);
  assert.equal(current.score, 24);
});

test('failed attempts keep overflow and can be retried, and existing Golden Cores are recognized', async () => {
  const { save, user, sync, move } = fixture(22);
  await save();
  let { state } = await sync();
  ({ state } = await move(state, 'choose', { route: 'spell' }));
  await user.update({ 'stats.totalScore': 53 });
  ({ state } = await move(state, 'start'));
  const firstId = state.trial.id;
  while (state.trial.status === 'active') ({ state } = await move(state, 'turn', {
    attemptId: firstId, round: state.trial.round, move: 'guard'
  }));
  assert.equal(state.trial.status, 'failed');
  assert.equal(state.seal, null);
  assert.equal((await user.get()).data().stats.totalScore, 53);
  ({ state } = await move(state, 'start'));
  assert.notEqual(state.trial.id, firstId);
  const legacy = fixture(68);
  await legacy.save();
  assert.equal((await legacy.sync()).state.legacyAccess, true);
  assert.equal(Reboot.initialState({ stats: { totalScore: 24 },
    trainingAccess: { version: 1, highestRealmScore: 28 } }).legacyAccess, true);
});

test('the existing trial tower consumes the branch build and blocks a pending Golden Core', async () => {
  const { db, player, save, user, sync, move } = fixture(22);
  player.cultivationTraining = { announced: true, equippedCore: null };
  await save();
  let { state } = await sync();
  ({ state } = await move(state, 'choose', { route: 'spell' }));
  await user.update({ 'stats.totalScore': 30 });
  await assert.rejects(Tower.start(db, 'u1', { requestId: 'start-pending' }, 12345, true), /金丹境開放/);
  ({ state } = await move(state, 'start'));
  for (const [round, wave] of Rules.ROUTES.spell.waves.entries())
    ({ state } = await move(state, 'turn', { attemptId: state.trial.id, round, move: wave[2] }));
  await user.update({ 'cultivationTraining.equippedCore': { type: 'sword', grade: 4 } });
  const active = await Tower.start(db, 'u1', { requestId: 'start-sealed' }, 12345, true);
  assert.equal(active.challenger.atk, 216);
  assert.equal(active.challenger.maxHp, 1160);
  const run = (await db.collection(Tower.COLLECTION).doc('u1').get()).data().run;
  assert.deepEqual(run.challenger.artifactBattle.effects.map(effect => [effect.type, effect.value]),
    [['equip_true_damage_flat', 18]]);
  assert.equal(run.challenger.goldenCore.grade, 4);
  assert.equal(Rules.bonuses(state, false).effects[0].value, 9);
  assert.equal((await user.get()).data().artifactSystem.inventory.legacy, 2);
});

test('quest progression skips retired milestones and preserves saved loot and shared claim history', async () => {
  const { db, save, sync, user, move } = fixture(120);
  await save();
  let { state } = await sync();
  ({ state } = await move(state, 'choose', { route: 'insight' }));
  const date = new Date('2026-11-08T00:00:00Z');
  const pathClaimed = PATH.slice(0, PATH.findIndex(q => q.id === 'path-raid-one')).map(q => q.id);
  await db.collection('questStates').doc('u1').set({ pathClaimed });
  const before = await questTransaction(db, 'u1', null, date, true);
  assert.equal(before.quests.path.id, 'path-nascent');
  assert.ok(before.quests.path.claimable);
  assert.ok(!before.quests.daily.some(q => q.metric === 'raid'));
  assert.ok(!before.quests.weekly.some(q => q.metric === 'raid'));
  await questTransaction(db, 'u1', { kind: 'path', id: 'path-nascent' }, date, true);
  const player = (await user.get()).data();
  assert.equal(player.stats.gold, 430);
  assert.equal(player.soulboundDrawTickets, 4);
  const claims = (await db.collection('questStates').doc('u1').get()).data().pathClaimed;
  assert.ok(claims.includes('path-nascent'));
  assert.ok(!claims.includes('path-raid-one'));
});
