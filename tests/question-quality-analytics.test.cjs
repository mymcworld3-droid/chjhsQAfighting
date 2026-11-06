'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../question-quality-analytics.cjs');

function memoryDB() {
  const docs = new Map();
  const snap = value => ({ exists: value !== undefined, data: () => value && structuredClone(value) });
  const db = {
    collection(name) { return { doc(id) { const path = name + '/' + id; return { path, get: async () => snap(docs.get(path)) }; } }; },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: ref => ref.get(),
        create: (ref, data) => writes.push(() => { if (docs.has(ref.path)) throw Error('duplicate'); docs.set(ref.path, data); }),
        update: (ref, data) => writes.push(() => docs.set(ref.path, {...docs.get(ref.path), ...data})),
        set: (ref, data, opts) => writes.push(() => docs.set(ref.path, opts?.merge ? {...docs.get(ref.path), ...data} : data))
      };
      const result = await fn(tx); writes.forEach(write => write()); return result;
    }
  };
  return {db, docs};
}

test('only newly delivered unique questions form the denominator; confirmed reports count once', async () => {
  const {db, docs} = memoryDB();
  assert.deepEqual((await quality.summary(db)).byDifficulty.easy, {generated:0, confirmed:0, rate:null});
  assert.equal(await quality.recordConfirmed(db, '尚未生成的歷史題目'), false);
  assert.equal(await quality.recordGenerated(db, '  這是一道    題目  '), true);
  assert.equal(await quality.recordGenerated(db, '這是一道 題目'), false);
  assert.equal(await quality.recordGenerated(db, '另外一道新的測驗題'), true);
  assert.equal(await quality.recordConfirmed(db, '這是一道 題目'), true);
  assert.equal(await quality.recordConfirmed(db, '  這是一道    題目  '), false);
  const total = await quality.summary(db);
  assert.deepEqual({generated:total.generated, confirmed:total.confirmed, rate:total.rate}, {generated:2, confirmed:1, rate:50});
  assert.deepEqual(total.byDifficulty.unknown, {generated:2, confirmed:1, rate:50});
  assert.ok([...docs.keys()].every(key => !key.includes('題目')));
  assert.ok([...docs.values()].every(value => !JSON.stringify(value).includes('題目')));
});

test('question normalization matches the existing report limit and Unicode rules', () => {
  assert.equal(quality.questionKey('ABCDE\n FG'), quality.questionKey('abcde fg'));
  assert.equal(quality.questionKey('é'.repeat(1500) + 'x'), quality.questionKey('é'.repeat(1500) + 'y'));
  assert.throws(() => quality.questionKey('短題'));
});


test('difficulty groups use the original delivered difficulty, retain legacy totals, and count confirmation once', async () => {
  const {db, docs} = memoryDB();
  // Existing data has no difficulty field, as before this feature was deployed.
  await quality.recordGenerated(db, '先前已生成但未記錄難度的舊題');
  const legacy = docs.get('questionQualityQuestions/' + quality.questionKey('先前已生成但未記錄難度的舊題'));
  delete legacy.difficulty;
  await quality.recordGenerated(db, '簡單程度的第一道測驗題', 'easy');
  await quality.recordGenerated(db, '簡單程度的第二道測驗題', 'easy');
  await quality.recordGenerated(db, '中等程度的第一道測驗題', 'medium');
  await quality.recordGenerated(db, '困難程度的第一道測驗題', 'hard');
  assert.equal(await quality.recordGenerated(db, '簡單程度的第一道測驗題', 'hard'), false);
  await quality.recordConfirmed(db, '簡單程度的第一道測驗題');
  assert.equal(await quality.recordConfirmed(db, '簡單程度的第一道測驗題'), false);
  await quality.recordConfirmed(db, '中等程度的第一道測驗題');
  await quality.recordConfirmed(db, '先前已生成但未記錄難度的舊題');
  const data = await quality.summary(db);
  assert.deepEqual(data.byDifficulty.easy, {generated:2, confirmed:1, rate:50});
  assert.deepEqual(data.byDifficulty.medium, {generated:1, confirmed:1, rate:100});
  assert.deepEqual(data.byDifficulty.hard, {generated:1, confirmed:0, rate:0});
  assert.deepEqual(data.byDifficulty.unknown, {generated:1, confirmed:1, rate:100});
  assert.deepEqual({generated:data.generated, confirmed:data.confirmed, rate:data.rate}, {generated:5, confirmed:3, rate:60});
});
