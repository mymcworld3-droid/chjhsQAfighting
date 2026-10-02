const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../public/cultivation', name), 'utf8');
const context = {};
vm.runInNewContext(read('battle-match-cooldown.js').replace(/^export /gm, ''), context);

function fixture() {
  let time = 10000, uid = 'first', offline = false;
  const profiles = new Map([['first', {}], ['second', {}]]);
  const stored = new Map();
  const options = {
    currentUser: () => ({ uid }), userData: () => profiles.get(uid), now: () => time,
    storage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    repository: {
      get: async id => profiles.get(id),
      patch: async (id, patch) => { if (offline) throw Error('offline'); Object.assign(profiles.get(id), patch); }
    }
  };
  return { options, profiles, setTime: value => { time = value; }, setUid: value => { uid = value; }, setOffline: value => { offline = value; } };
}

test('exit applies exactly five minutes immediately and expires at the deadline', async () => {
  const f = fixture();
  const cooldown = context.createBattleMatchCooldown(f.options);
  const write = cooldown.start();
  assert.equal(cooldown.remaining(), 300000);
  await write;
  assert.equal(f.profiles.get('first').battleMatchCooldownUntilMs, 310000);
  f.setTime(309999);
  assert.equal(cooldown.remaining(), 1);
  assert.equal(context.battleCooldownLabel(cooldown.remaining()), '0:01');
  f.setTime(310000);
  assert.equal(cooldown.remaining(), 0);
});

test('refresh preserves remaining time and isolates a different account', async () => {
  const f = fixture();
  await context.createBattleMatchCooldown(f.options).start();
  f.setTime(70000);
  const reloaded = context.createBattleMatchCooldown(f.options);
  assert.equal(await reloaded.refresh(), 240000);
  assert.equal(context.battleCooldownLabel(reloaded.remaining()), '4:00');
  f.setUid('second');
  assert.equal(reloaded.remaining(), 0);
  f.setUid('first');
  assert.equal(reloaded.remaining(), 240000);
});

test('another device reads the persisted deadline before matching', async () => {
  const f = fixture();
  await context.createBattleMatchCooldown(f.options).start();
  f.setTime(100000);
  const other = context.createBattleMatchCooldown({ ...f.options, storage: null, userData: () => ({}) });
  assert.equal(await other.refresh(), 210000);
});

test('failed persistence retains cooldown and retries without restarting its deadline', async () => {
  const f = fixture();
  const cooldown = context.createBattleMatchCooldown({ ...f.options, userData: () => null });
  f.setOffline(true);
  await assert.rejects(cooldown.start(), /offline/);
  assert.equal(cooldown.remaining(), 300000);
  f.setOffline(false);
  f.setTime(70000);
  assert.equal(await cooldown.refresh(), 240000);
  assert.equal(f.profiles.get('first').battleMatchCooldownUntilMs, 310000);
});

const battle = read('battle-mode-v2.js');
test('only canceling matchmaking or leaving an unfinished room applies a penalty', async () => {
  for (const [status, starting, forfeit, expected] of [
    ['waiting', false, true, 1], ['playing', false, true, 1],
    ['idle', true, true, 1], ['finished', false, true, 0],
    ['finished', false, false, 0], ['idle', false, true, 0]
  ]) {
    let penalties = 0;
    const state = { leaving: false, starting, roomId: status === 'idle' ? null : 'room', room: { status } };
    const ctx = {
      state, matchCooldown: { async start() { penalties++; } }, updateMatchCooldownLabel() {},
      forfeitCurrentRoom: async () => {}, recordBattleResult: async () => {},
      resetRuntime() {}, window: { dispatchEvent() {}, switchToPage() {} },
      CustomEvent: function() {}, console
    };
    vm.runInNewContext(battle.slice(battle.indexOf('  async function exitBattle('), battle.indexOf('  async function joinSpecificRoom(')), ctx);
    await ctx.exitBattle({ forfeit });
    assert.equal(penalties, expected, `${status} starting=${starting} forfeit=${forfeit}`);
  }
});

test('cooldown blocks random matchmaking and invitation joins before creating or claiming a room', async () => {
  const ctx = {
    window: {}, state: { starting: false, roomId: null, leaving: false },
    score: () => 10, FOUNDATION_SCORE: 10, me: () => ({ uid: 'first' }),
    storyOrTutorialOpen: () => false, cooldownBlocksMatch: () => true
  };
  const start = battle.slice(battle.indexOf('  async function startMatchmaking('), battle.indexOf('  async function forfeitCurrentRoom('));
  const join = battle.slice(battle.indexOf('  async function joinSpecificRoom('), battle.indexOf('  async function recoverBattleSession('));
  vm.runInNewContext(start + join, ctx);
  await ctx.startMatchmaking();
  assert.equal(await ctx.joinSpecificRoom('invited-room'), false);
  assert.equal(ctx.state.starting, false);
});

test('canceling during an in-flight match cleans up the late room instead of entering it', async () => {
  let resolveMatch, remaining = 0;
  const cleaned = [];
  const ctx = {
    window: { switchToPage() {}, ensureCombatStats: async () => {} },
    state: { starting: false, roomId: null, leaving: false },
    score: () => 10, FOUNDATION_SCORE: 10, me: () => ({ uid: 'first' }),
    storyOrTutorialOpen: () => false, cooldownBlocksMatch: () => remaining > 0,
    matchCooldown: { refresh: async () => 0, remaining: () => remaining },
    resetRuntime() {}, ensurePage() {}, showSection() {}, renderLobby() {},
    playerSnapshot: () => ({ uid: 'first', name: '修士' }), setPlayerAvatar() {}, setText() {},
    playerCoreLabel: () => '', playerPowerLabel: () => '', playerNascentSealLabel: () => '',
    findAndClaimRoom: () => new Promise(resolve => { resolveMatch = resolve; }),
    forfeitCurrentRoom: async (...args) => cleaned.push(args),
    subscribeRoom() { assert.fail('canceled matchmaking must not reopen'); }
  };
  vm.runInNewContext(battle.slice(battle.indexOf('  async function startMatchmaking('), battle.indexOf('  async function forfeitCurrentRoom(')), ctx);
  const job = ctx.startMatchmaking();
  await new Promise(resolve => setImmediate(resolve));
  ctx.state.starting = false;
  remaining = 300000;
  resolveMatch('late-room');
  await job;
  assert.deepEqual(cleaned, [['late-room', 'guest', 'first']]);
});
