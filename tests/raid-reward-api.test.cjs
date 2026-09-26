const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = require('../raid-reward-api.cjs').__test;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function wonRoom(overrides = {}) {
  return {
    version: 2,
    bossId: 'shen-qingshuang',
    status: 'won',
    bossHp: 0,
    bossMaxHp: 2000,
    bossActionCount: 5,
    startedAtMs: 1000,
    finishedAtMs: 90000,
    members: {
      u1: { uid:'u1', damage:1200, attempts:6, correct:5 },
      u2: { uid:'u2', damage:800, attempts:5, correct:4 }
    },
    ...overrides
  };
}

test('trusted raid reward validates a real member and complete shared-boss damage', () => {
  const result = api.validateRaidVictory(wonRoom(), 'u1');
  assert.equal(result.ok, true);
  assert.equal(result.totalDamage, 2000);
  assert.equal(result.partySize, 2);
  assert.equal(result.bossMaxHp, 2000);
});

test('trusted raid reward rejects unfinished, forged-damage and non-member rooms', () => {
  assert.equal(api.validateRaidVictory(wonRoom({status:'active'}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom({members:{
    u1:{uid:'u1',damage:100,attempts:1,correct:1}
  }}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom(), 'outsider').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom({bossActionCount:13}), 'u1').ok, true);
});

function fakeDb(initialUser) {
  const docs = new Map([['users/u1', JSON.parse(JSON.stringify(initialUser))]]);
  const ref = (collection, id) => ({
    key: collection + '/' + id,
    async get() {
      const value = docs.get(this.key);
      return { exists:value !== undefined, data:() => JSON.parse(JSON.stringify(value)) };
    }
  });
  return {
    docs,
    collection(name) { return { doc:id => ref(name,id) }; },
    async runTransaction(fn) {
      const tx = {
        async get(target) {
          const value = docs.get(target.key);
          return { exists:value !== undefined, data:() => JSON.parse(JSON.stringify(value)) };
        },
        create(target, value) {
          if (docs.has(target.key)) throw new Error('already-exists');
          docs.set(target.key, JSON.parse(JSON.stringify(value)));
        },
        update(target, patch) {
          const current = docs.get(target.key) || {};
          docs.set(target.key, { ...current, ...JSON.parse(JSON.stringify(patch)) });
        }
      };
      return fn(tx);
    }
  };
}

test('raid reward writes both refinement keys exactly once into A material inventory', async () => {
  const db = fakeDb({ uid:'u1', materialSystem:{ inventory:{'spirit-iron':3} } });
  const validation = api.validateRaidVictory(wonRoom(), 'u1');
  const fieldValue = { serverTimestamp:() => 12345 };
  const first = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(first.status, 'awarded');
  assert.deepEqual(first.rewards, {'raid-refine-key-ii':2,'raid-refine-key-iii':1});
  const inventory = db.docs.get('users/u1').materialSystem.inventory;
  assert.equal(inventory['spirit-iron'], 3);
  assert.equal(inventory['raid-refine-key-ii'], 2);
  assert.equal(inventory['raid-refine-key-iii'], 1);

  const second = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(second.status, 'duplicate');
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-ii'], 2);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-iii'], 1);
});

test('raid reward API is registered and client claims only by room id with A bearer token', () => {
  const server = read('server.js');
  const raid = read('public/cultivation/raid-mode.js');
  assert.match(server, /registerRaidRewardApi\(app\)/);
  assert.match(raid, /fetch\('\/api\/raid\/reward'/);
  assert.match(raid, /Authorization:'Bearer ' \+ token/);
  assert.match(raid, /JSON\.stringify\(\{ roomId: state\.roomId \}\)/);
  assert.doesNotMatch(raid, /JSON\.stringify\(\{[^}]*raid-refine-key/);
});

test('raid refinement keys are exclusive rewards and are consumed outside the eight furnace slots', () => {
  const catalog = read('public/cultivation/material-catalog.js');
  const drops = read('public/cultivation/material-drop-system.js');
  const jobs = read('public/cultivation/refinery-ai-jobs.js');
  const ui = read('public/cultivation/cultivation-refinery-v2.js');
  assert.match(catalog, /id: 'raid-refine-key-ii'/);
  assert.match(catalog, /id: 'raid-refine-key-iii'/);
  assert.match(catalog, /function raidRefinementKeyRequirement\(stage, realm\)/);
  assert.match(catalog, /Math\.ceil\(order \/ 2\)/);
  assert.match(catalog, /Math\.ceil\(order \* 2 \/ 3\)/);
  assert.match(drops, /new Set\(Object\.values\(RAID_REFINEMENT_KEYS\)\)/);
  assert.match(drops, /if \(raidOnly\.has\(material\.id\)\) return \[\]/);
  assert.match(jobs, /consumeRefinementKey\(consumed\.materialSystem, plan\.keyRequirement\)/);
  assert.match(jobs, /refinementStage: plan\.refinementStage/);
  assert.match(ui, /!raidKeyIds\.has\(m\.id\)/);
  assert.match(ui, /請先挑戰團本取得/);
});
