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
  assert.deepEqual(await quality.summary(db), {generated:0, confirmed:0, rate:null});
  assert.equal(await quality.recordConfirmed(db, '尚未生成的歷史題目'), false);
  assert.equal(await quality.recordGenerated(db, '  這是一道    題目  '), true);
  assert.equal(await quality.recordGenerated(db, '這是一道 題目'), false);
  assert.equal(await quality.recordGenerated(db, '另外一道新的測驗題'), true);
  assert.equal(await quality.recordConfirmed(db, '這是一道 題目'), true);
  assert.equal(await quality.recordConfirmed(db, '  這是一道    題目  '), false);
  assert.deepEqual(await quality.summary(db), {generated:2, confirmed:1, rate:50});
  assert.ok([...docs.keys()].every(key => !key.includes('題目')));
  assert.ok([...docs.values()].every(value => !JSON.stringify(value).includes('題目')));
});

test('question normalization matches the existing report limit and Unicode rules', () => {
  assert.equal(quality.questionKey('ABCDE\n FG'), quality.questionKey('abcde fg'));
  assert.equal(quality.questionKey('é'.repeat(1500) + 'x'), quality.questionKey('é'.repeat(1500) + 'y'));
  assert.throws(() => quality.questionKey('短題'));
});
