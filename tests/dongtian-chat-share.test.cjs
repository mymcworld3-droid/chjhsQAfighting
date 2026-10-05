'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const caveSource = readFileSync(require.resolve('../public/cultivation/dongtian.js'), 'utf8');
const repositorySource = readFileSync(require.resolve('../public/cultivation/data/player-repository.js'), 'utf8');
const cave = () => ({ id: 'cave12345', ownerUid: 'owner', status: 'active', name: '<知識洞天>', questions: [{ q: '1+1' }] });

function manager(initial = cave(), fresh = initial) {
  const actions = [], sent = [], notices = []; let reads = 0;
  const modal = { querySelector: selector => selector === '.dt-modal-actions' ? { appendChild: b => actions.push(b) } : {}, querySelectorAll: () => [] };
  const source = caveSource.slice(caveSource.indexOf('  async function openOwnerQuestionManager('), caveSource.indexOf('  function openOwnerQuestionRevision('));
  const context = vm.createContext({ state: { moderationBusy: false }, uid: () => 'owner', db: {}, DATA_COLLECTION: 'dongtians',
    doc: (_, collection, id) => ({ collection, id }),
    getDoc: async () => { const data = reads++ === 0 ? initial : fresh; return { id: 'cave12345', exists: () => !!data, data: () => data }; },
    document: { createElement: name => name === 'div' ? modal : { dataset: {}, disabled: false }, body: { appendChild() {} } },
    removeModerationModal() {}, escapeHtml: s => s, difficultyLabel: () => '普通', toast: s => notices.push(s),
    playerRepository: { shareDongtian: async data => { if (data.status !== 'active' || data.ownerUid !== 'owner') throw Error('不可分享'); sent.push(data); } }
  });
  vm.runInContext(source + '\nthis.open = openOwnerQuestionManager;', context);
  return { open: () => context.open('cave12345'), actions, sent, notices, modal };
}

test('share entry exists only inside owner management, and a double click sends once', async () => {
  const game = manager(); await game.open();
  assert.equal(game.actions.length, 1);
  assert.equal(game.actions[0].textContent, '分享到聊天室');
  await Promise.all([game.actions[0].onclick(), game.actions[0].onclick()]);
  assert.equal(game.sent.length, 1);
  assert.equal(game.actions[0].textContent, '已分享到聊天室');
  const list = caveSource.slice(caveSource.indexOf('  function renderOwnDongtians('), caveSource.indexOf('  async function loadOwnDongtians('));
  assert.doesNotMatch(list, /data-dt-share|分享到聊天室/);
  assert.match(list, /洞天管理/);
});

test('nonowners cannot open management; stale deleted or suspended caves cannot be shared', async () => {
  await assert.rejects(manager({ ...cave(), ownerUid: 'other' }).open(), /只有洞天主人/);
  for (const fresh of [null, { ...cave(), status: 'suspended' }, { ...cave(), ownerUid: 'other' }]) {
    const game = manager(cave(), fresh); await game.open(); await game.actions[0].onclick();
    assert.equal(game.sent.length, 0);
    assert.equal(game.actions[0].disabled, false);
    assert.ok(game.notices.length > 0);
  }
});

test('share repository writes a typed chat message in A using the authenticated owner profile', async () => {
  const writes = [];
  const context = vm.createContext({ getMainUser: () => ({ uid: 'owner' }), getProjectServices: async role => { assert.equal(role, 'A'); return { db: {} }; },
    doc: (_, collection, id) => ({ collection, id }), collection: (_, name) => name,
    getDoc: async ref => { assert.equal(ref.id, 'owner'); return { exists: () => true, data: () => ({ displayName: '道友', stats: { totalScore: 30 }, equipped: {} }) }; },
    addDoc: async (collection, data) => { writes.push({ collection, data }); }, serverTimestamp: () => 'server-time' });
  const source = repositorySource.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '').replace('export const playerRepository', 'const playerRepository');
  vm.runInContext(readFileSync(require.resolve('../public/cultivation/profile-avatar.js'), 'utf8').replace(/^export /gm, ''), context);
  vm.runInContext(source + '\nthis.repo = playerRepository;', context);
  await context.repo.shareDongtian(cave());
  assert.equal(writes[0].collection, 'global_chat');
  assert.equal(writes[0].data.type, 'dongtian-share');
  assert.equal(writes[0].data.uid, 'owner');
  assert.equal(writes[0].data.displayName, '道友');
  assert.equal(writes[0].data.dongtianName, '<知識洞天>');
  assert.equal(writes[0].data.timestamp, 'server-time');
  for (const value of [{ ...cave(), ownerUid: 'other' }, { ...cave(), tutorialOnly: true }, { ...cave(), status: 'suspended' }, { ...cave(), id: '../bad' }])
    await assert.rejects(context.repo.shareDongtian(value), /只能分享/);
  assert.equal(writes.length, 1);
});

function visitor(data = cave(), options = {}) {
  const entered = [], notices = []; let reads = 0;
  const source = caveSource.slice(caveSource.indexOf('  let openingSharedDongtian = false;'), caveSource.indexOf('  function boot()'));
  const context = vm.createContext({ window: {}, uid: () => options.uid === undefined ? 'visitor' : options.uid,
    state: { session: options.busy ? {} : null }, toast: s => notices.push(s), db: {}, DATA_COLLECTION: 'dongtians',
    doc: (_, collection, id) => ({ collection, id }),
    getDoc: async () => { reads++; return { id: 'cave12345', exists: () => !!data, data: () => data }; },
    enterDongtian: async (c, opts) => entered.push({ c, opts }) });
  vm.runInContext(source, context);
  return { open: id => context.window.openSharedDongtian(id || 'cave12345'), entered, notices, reads: () => reads };
}

test('chat visitors open the fresh cave once and use existing encounter/reward flow', async () => {
  const game = visitor(); await Promise.all([game.open(), game.open()]);
  assert.equal(game.entered.length, 1);
  assert.equal(game.entered[0].opts.source, 'chat');
  assert.equal(game.entered[0].opts.encountered, true);
  const owner = visitor(cave(), { uid: 'owner' }); await owner.open();
  assert.equal(owner.entered[0].opts.source, 'owner');
  assert.equal(owner.entered[0].opts.encountered, false);
});

test('chat entry rejects deleted, sealed, empty, tutorial caves and busy or signed-out visitors', async () => {
  for (const data of [null, { ...cave(), status: 'suspended' }, { ...cave(), questions: [] }, { ...cave(), tutorialOnly: true }]) {
    const game = visitor(data); await game.open(); assert.equal(game.entered.length, 0); assert.equal(game.notices.length, 1);
  }
  for (const options of [{ busy: true }, { uid: '' }]) {
    const game = visitor(cave(), options); await game.open(); assert.equal(game.reads(), 0); assert.equal(game.entered.length, 0);
  }
  const invalid = visitor(); await invalid.open('../other'); assert.equal(invalid.reads(), 0);
});

test('reentering through chat preserves completed progress and its first-completion reward guard', async () => {
  const source = caveSource.slice(caveSource.indexOf('  async function markEncountered('), caveSource.indexOf('  async function enterDongtian('));
  for (const previous of [null, { completed: true, correct: 10, completedAtMs: 100 }, { completed: false }]) {
    let progress = previous && { ...previous };
    const context = vm.createContext({ uid: () => 'visitor', progressDb: {}, PLAY_COLLECTION: 'dongtianPlays', INDEX_COLLECTION: 'dongtianIndex', db: {},
      doc: (_, collection, id) => ({ collection, id }), serverTimestamp: () => 'server-time', increment: n => n,
      dongtianCache: { markEncountered() {} }, updateDoc: async () => {},
      runTransaction: async (_, worker) => worker({ get: async () => ({ exists: () => !!progress }),
        set(_, data, options) { assert.equal(options.merge, true); progress = { ...progress, ...data }; } }) });
    vm.runInContext(source + '\nthis.mark = markEncountered;', context);
    await context.mark(cave());
    assert.equal(progress.encountered, true);
    assert.equal(progress.completed, previous?.completed ?? false);
    if (previous?.completed) { assert.equal(progress.correct, 10); assert.equal(progress.completedAtMs, 100); }
  }
});
