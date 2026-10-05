const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const legacy = read('public/main-legacy.js');
const resolver = read('public/cultivation/profile-avatar.js').replace(/^export /gm, '');
const photo = 'https://example.test/account.jpg';

function harness({ fail = false, deferred = false } = {}) {
  const writes = [], events = [], notices = [];
  const player = { uid: 'me', equipped: { avatar: 'assets/custom.png', frame: 'assets/frame.png' }, inventory: ['avatar', 'frame'], stats: { gold: 88 } };
  const button = { disabled: false };
  let complete;
  const context = vm.createContext({
    auth: { currentUser: { uid: 'me', photoURL: photo } }, currentUserData: player, db: {},
    document: { getElementById: id => id === 'store-avatar-reset' ? button : null },
    doc: (_, collection, uid) => ({ collection, uid }),
    updateDoc: async (ref, patch) => {
      writes.push({ ref, patch: JSON.parse(JSON.stringify(patch)) });
      if (deferred) await new Promise(resolve => { complete = resolve; });
      if (fail) throw Error('write failed');
    },
    window: { dispatchEvent: e => events.push(e.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    updateUserAvatarDisplay() {}, invalidateLeaderboardCache() {}, refreshVisibleLeaderboard() {}, loadStoreItems() {},
    console: { error() {} }, alert: message => notices.push(message)
  });
  vm.runInContext(resolver, context);
  const start = legacy.indexOf('let cosmeticEquipBusy = false;');
  vm.runInContext(legacy.slice(start, legacy.indexOf('window.filterStore =', start)), context);
  return { context, player, writes, events, notices, button, complete: () => complete() };
}

test('unequip saves account photo and preserves the frame, inventory and currency; re-equipping restores the chosen avatar', async () => {
  const h = harness();
  await h.context.window.unequipAvatar();
  assert.deepEqual(h.writes[0], { ref: { collection: 'users', uid: 'me' }, patch: { 'equipped.avatar': '', photoURL: photo } });
  assert.equal(h.player.equipped.avatar, '');
  assert.equal(h.player.equipped.frame, 'assets/frame.png');
  assert.deepEqual(h.player.inventory, ['avatar', 'frame']);
  assert.equal(h.player.stats.gold, 88);
  assert.equal(h.context.resolvePlayerAvatar(h.player), photo);
  assert.deepEqual(h.events, ['xiuxian:appearance-updated']);
  await h.context.window.equipItem('avatar', 'avatar', 'assets/custom.png');
  assert.equal(h.context.resolvePlayerAvatar(h.player), 'assets/custom.png');
  await h.context.window.equipItem('avatar', 'avatar', 'assets/custom.png');
  assert.equal(h.context.resolvePlayerAvatar(h.player), photo, 'clicking the equipped avatar removes it');
});

test('failed saves retain the current avatar and restore the controls', async () => {
  const h = harness({ fail: true });
  await h.context.window.unequipAvatar();
  assert.equal(h.player.equipped.avatar, 'assets/custom.png');
  assert.deepEqual(h.events, []);
  assert.equal(h.button.disabled, false);
  assert.equal(h.notices.length, 1);
});

test('duplicate clicks write once and an account change cannot update the next player UI', async () => {
  const h = harness({ deferred: true });
  const pending = h.context.window.unequipAvatar();
  await h.context.window.unequipAvatar();
  assert.equal(h.writes.length, 1);
  assert.equal(h.button.disabled, true);
  h.context.auth.currentUser = { uid: 'other' };
  h.context.currentUserData = { uid: 'other', equipped: { avatar: 'assets/other.png' } };
  h.complete(); await pending;
  assert.equal(h.context.currentUserData.equipped.avatar, 'assets/other.png');
  assert.deepEqual(h.events, []);
  assert.equal(h.button.disabled, false);
});

test('remote account avatars work without borrowing the viewer photo; accounts without photos retain the default icon', () => {
  const resolve = harness().context.resolvePlayerAvatar;
  assert.equal(resolve({ photoURL: photo, equipped: { avatar: '' } }), photo);
  assert.equal(resolve({ equipped: { avatar: '' } }), '');
  assert.equal(resolve(null), '');
  assert.equal(resolve({}, { photoURL: photo }), photo);
});

test('matchmaking carries the account photo after unequipping without changing combat stats', () => {
  const battle = read('public/cultivation/battle-mode-v2.js');
  const player = { photoURL: photo, equipped: { avatar: '' }, stats: {} };
  const context = vm.createContext({ me: () => ({ uid: 'me' }), userData: () => player,
    baseCombatSnapshot: () => ({ attack: 200, maxHp: 1000 }), combatSnapshot: () => ({ attack: 200, maxHp: 1000 }),
    window: {}, snapshotBattleKnowledge: () => ({}), nowMs: () => 100 });
  vm.runInContext(resolver, context);
  vm.runInContext(battle.slice(battle.indexOf('  function playerSnapshot() {'), battle.indexOf('  function normalizeQuestion(')), context);
  assert.equal(context.playerSnapshot().avatar, photo);
  assert.equal(context.playerSnapshot().atk, 200);
  assert.equal(context.playerSnapshot().maxHp, 1000);
  player.equipped.avatar = 'assets/custom.png';
  assert.equal(context.playerSnapshot().avatar, 'assets/custom.png');
});
