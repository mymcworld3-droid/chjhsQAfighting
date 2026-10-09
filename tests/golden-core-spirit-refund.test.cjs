globalThis.QACombatCombo = require('../public/cultivation/combat-combo.js');
globalThis.QANascentGrowth = require('../public/cultivation/nascent-growth.js');
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const read = path => readFileSync(require.resolve('../public/' + path), 'utf8');
const training = read('cultivation/cultivation-training-v4.js');
const rules = vm.runInNewContext(read('cultivation/nascent-soul-rules.js').replace(/^import \{\} from .*;\n/gm,'').replace(/^export /gm, '') +
  '\n({normalizeSpirit, resetSoulTree, soulAvailableSpirit})');
const clone = value => JSON.parse(JSON.stringify(value));
const oldCore = { type: 'sword', grade: 3, createdAt: 100 };
const newCore = { type: 'ocean', grade: 5, createdAt: 200 };
const initialTree = () => ({ version: 4, paths: {
  sword: { nodes: { leftMain: 5, leftTop: 2, rightMain: 5 }, baselineNodes: {}, legacySpent: 0 },
  ocean: { nodes: { rightMain: 2 }, baselineNodes: {}, legacySpent: 0 }
} });

function runtime({ remote, candidate = newCore, fail = false, retry = false, switchAccount = false } = {}) {
  remote ||= { cultivationTraining: { core: clone(candidate), equippedCore: clone(oldCore), equipped: false,
    coreEnabled: false, counters: { correct: 17 }, items: ['saved-item'] },
    nascentSoulTree: initialTree(), stats: { totalScore: 68, nascentSoulSpirit: 30, gold: 900 } };
  const local = clone(remote), original = clone(remote), writes = [], events = [], messages = [];
  let uid = 'player';
  const context = vm.createContext({
    ...rules, Growth:globalThis.QANascentGrowth, state: clone(remote.cultivationTraining), busy: false, soulBusy: false,
    selectedSoulNodeId: 'leftMain', selectedSoulType: 'sword', GOLDEN_CORE_SCORE: 28,
    REMOTE_FIELD: 'cultivationTraining', getApp: () => ({}), getFirestore: () => ({}),
    getAuth: () => ({ currentUser: uid ? { uid } : null }), doc: (_, collection, id) => ({ collection, id }),
    clampGrade: n => Math.min(9, Math.max(1, Number(n) || 9)), isUnlocked: () => true,
    migrate: clone, coreType: type => ({ name: type }), saveLocal() {}, renderTrainingPage() {}, restoreRemoteTraining() {},
    toast: message => messages.push(message), console: { error() {}, warn() {} },
    window: { getCurrentUserData: () => local, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    runTransaction: async (_, worker) => {
      const execute = async () => {
        const staged = [];
        const result = await worker({
          get: async () => { if (switchAccount) uid = 'other'; return { exists: () => true, data: () => clone(remote) }; },
          update: (ref, patch) => { assert.equal(ref.id, 'player'); staged.push(patch); }
        });
        return { result, staged };
      };
      if (retry) {
        await execute(); // Simulate Firestore discarding a conflicted attempt.
        remote.nascentSoulTree.paths.sword.nodes.leftMain = 6;
      }
      const { result, staged } = await execute();
      if (fail) throw Error('offline');
      for (const patch of staged) { writes.push(patch); for(const [key,value] of Object.entries(patch)){const path=key.split('.');let target=remote;for(const part of path.slice(0,-1))target=target[part]||={};target[path.at(-1)]=value;} }
      return result;
    }
  });
  context.state.core = clone(candidate);
  context.state.equipped = false;
  const helper = training.slice(training.indexOf('  function sameGoldenCore('), training.indexOf('  function starterCore()'));
  const start = training.indexOf('  async function equipCore()');
  const end = training.indexOf('  function ensureUnlockedUI()', start);
  vm.runInContext(helper + training.slice(start, end) + '\nthis.equip = equipCore;', context);
  return { context, remote, local, original, writes, events, messages };
}

test('switching core atomically migrates old currency and resets branches without losing training data',async()=>{
 const r=runtime();await r.context.equip();assert.equal(r.writes.length,1);assert.equal(r.remote.stats.nascentSoulSpirit,0);assert.equal(r.remote.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID],30);assert.equal(r.local.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID],30);assert.equal(Object.keys(r.remote.nascentSoulTree.paths).length,0);assert.equal(r.remote.stats.gold,900);assert.equal(r.remote.cultivationTraining.coreEnabled,false);assert.deepEqual(r.remote.cultivationTraining.counters,{correct:17});
});


test('a newly washed core of the same type and grade still refunds, while repeated clicks refund only once', async () => {
  const r = runtime({ candidate: { ...oldCore, createdAt: 200 } });
  await Promise.all([r.context.equip(), r.context.equip()]);
  await r.context.equip();
  assert.equal(r.writes.length, 1);
  assert.equal(r.remote.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID],30);
});

test('stale core switch cannot refund again or erase newer branch upgrades',async()=>{
 const first=runtime(),second=runtime({remote:first.remote});await first.context.equip();first.remote.nascentSoulGrowth.branches.attack=1;first.remote.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID]-=1;await second.context.equip();assert.equal(second.writes.length,0);assert.equal(first.remote.nascentSoulGrowth.branches.attack,1);assert.equal(second.local.nascentSoulGrowth.branches.attack,1);assert.equal(first.remote.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID],29);
});


test('transaction retries refund the latest investment exactly once without adding to lifetime earnings', async () => {
  const r = runtime({ retry: true });
  await r.context.equip();
  assert.equal(r.writes.length, 1);
  assert.equal(r.remote.stats.nascentSoulSpirit, 0);
  assert.equal(r.remote.materialSystem.inventory[globalThis.QANascentGrowth.ITEM_ID],30);
});

test('failed commits leave both the equipped core and investments unchanged locally and remotely', async () => {
  const r = runtime({ fail: true });
  const state = clone(r.context.state);
  await r.context.equip();
  assert.deepEqual(r.remote, r.original);
  assert.deepEqual(r.local, r.original);
  assert.deepEqual(clone(r.context.state), state);
  assert.equal(r.events.length, 0);
  assert.equal(r.context.busy, false);
  assert.match(r.messages[0], /調御未完成/);
});

test('a different candidate saved by another tab blocks an outdated switch without resetting points', async () => {
  const r = runtime();
  r.remote.cultivationTraining.core.createdAt = 300;
  await r.context.equip();
  assert.equal(r.writes.length, 0);
  assert.deepEqual(r.remote.nascentSoulTree, r.original.nascentSoulTree);
  assert.match(r.messages[0], /候選金丹已變更/);
});

test('account changes and concurrent node saves cannot start a core-switch refund', async () => {
  const changed = runtime({ switchAccount: true });
  await changed.context.equip();
  assert.equal(changed.writes.length, 0);
  assert.deepEqual(changed.local, changed.original);
  const allocating = runtime();
  allocating.context.soulBusy = true;
  await allocating.context.equip();
  assert.equal(allocating.writes.length, 0);
});

test('washing and activating the stored core do not reset any investment', () => {
  for (const name of ['washCore', 'toggleGoldenCore']) {
    const start = training.indexOf('  async function ' + name + '()');
    const end = training.indexOf('\n  }', start);
    assert.doesNotMatch(training.slice(start, end), /resetSoulTree|nascentSoulTree:/);
  }
});
