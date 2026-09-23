'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');
const src = source.slice(source.indexOf('  function currentPracticeSubjects()'), source.indexOf('  function offerDongtianEncounter('));
const levels = source.match(/const LEVELS = [^\n]+;/)?.[0];
const levelOrder = source.slice(source.indexOf('  function levelOrder('), source.indexOf('  function difficultyLabel('));
assert.ok(levels && levelOrder && src.includes('async function findEncounter'));

function scenario(options = {}) {
  const player = { profile: { educationLevel: options.level || '高中職' },
    gameSettings: options.settings || { sourceMode: 'random', source: 'ai', focusedUnits: [] } };
  const cave = { id: 'cave-1', ownerUid: 'owner-1', levelOrder: 5,
    status: 'active', subject: options.subject || '數學', questions: [{ q: '1 + 1' }] };
  const state = { session: null, encounterBusy: false, publicListPending: null };
  const attempts = [];
  const math = Object.create(Math);
  math.random = () => options.random ?? 0.01;
  const ctx = vm.createContext({
    state, Math: math, Promise, console, ENCOUNTER_CHANCE: 0.20, db: {},
    INDEX_COLLECTION: 'dongtianIndex', PLAY_COLLECTION: 'dongtianPlays', DATA_COLLECTION: 'dongtians',
    uid: () => 'visitor-2', userData: () => player,
    document: { getElementById: () => null },
    dongtianCache: {
      getPublicList: () => [cave],
      hasEncountered: () => options.seen === true,
      markEncountered() {}, setPublicList() {}
    },
    shuffle: (items) => items,
    doc: (_db, collection, id) => ({ collection, id }),
    getDoc: async (ref) => ref.collection === 'dongtianPlays'
      ? { exists: () => options.seen === true }
      : { exists: () => true, data: () => cave, id: cave.id },
    markEncountered: async (found) => { attempts.push('mark:' + found.id); },
    offerDongtianEncounter: async (found) => {
      attempts.push('offer:' + found.id);
      return options.accept !== false;
    },
    enterDongtian: async (found) => { attempts.push('enter:' + found.id); },
    toast() {}, getDocs: async () => { throw Error('cached list should be used'); }
  });
  vm.runInContext(levels + '\n' + levelOrder + '\n' + src + '\nthis.roll = maybeEncounterBeforeQuiz;', ctx);
  return { roll: () => ctx.roll(), attempts, state };
}

test('a successful 20% roll can search while the caller owns the encounter lock', async () => {
  const game = scenario();
  assert.equal(await game.roll(), true, 'same-grade visitor and matching cave should be offered');
  assert.deepEqual(game.attempts, ['mark:cave-1', 'offer:cave-1', 'enter:cave-1']);
  assert.equal(game.state.encounterBusy, false, 'encounter lock is always released');
});

test('range selection matches a comprehensive visitor with single-subject caves', async () => {
  const game = scenario({ settings: { sourceMode: 'random', source: 'ai', focusedUnits: [
    { path: '英文/高中一年級/第一學期', detail: 'does not apply in random mode' }
  ] } });
  assert.equal(await game.roll(), true);
});

test('focused subjects exclude unrelated single-subject caves but never a comprehensive cave', async () => {
  const settings = { sourceMode: 'focused', focusedUnits: [{ path: '英文/高中一年級/第一學期', detail: '句型' }] };
  const unrelated = scenario({ settings, subject: '數學' });
  assert.equal(await unrelated.roll(), false);
  assert.deepEqual(unrelated.attempts, []);
  const comprehensive = scenario({ settings, subject: '綜合' });
  assert.equal(await comprehensive.roll(), true);
});

test('failed chance or already-encountered cave does not re-offer it', async () => {
  const miss = scenario({ random: 0.8 });
  assert.equal(await miss.roll(), false);
  assert.deepEqual(miss.attempts, []);
  const seen = scenario({ seen: true });
  assert.equal(await seen.roll(), false);
  assert.deepEqual(seen.attempts, []);
});
