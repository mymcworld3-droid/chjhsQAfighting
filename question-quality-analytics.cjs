'use strict';

// Only delivered questions are tracked. No question text or player identifiers
// are stored; the same normalized stem is counted once across reports and modes.
const crypto = require('node:crypto');
const SHARDS = 32;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const knownDifficulty = value => DIFFICULTIES.includes(value) ? value : null;
function questionKey(question) {
  const stem = String(question || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 1500).toLocaleLowerCase('en');
  if (stem.length < 5) throw new Error('Invalid question stem');
  return crypto.createHash('sha256').update(stem).digest('hex');
}
function refs(db, question) {
  const key = questionKey(question);
  return {
    question: db.collection('questionQualityQuestions').doc(key),
    shard: db.collection('questionQualityTotals').doc(String(parseInt(key.slice(0, 2), 16) % SHARDS))
  };
}
async function recordGenerated(db, question, difficulty, now = new Date()) {
  difficulty = knownDifficulty(difficulty);
  const ref = refs(db, question);
  return db.runTransaction(async tx => {
    const [item, total] = await Promise.all([tx.get(ref.question), tx.get(ref.shard)]);
    if (item.exists) return false;
    const data = total.data() || {};
    tx.create(ref.question, { createdAt: now, confirmed: false, difficulty });
    const patch = { generated: (Number(data.generated) || 0) + 1, confirmed: Number(data.confirmed) || 0 };
    if (difficulty) patch['generated_' + difficulty] = (Number(data['generated_' + difficulty]) || 0) + 1;
    tx.set(ref.shard, patch, { merge: true });
    return true;
  });
}
async function recordConfirmed(db, question) {
  const ref = refs(db, question);
  return db.runTransaction(async tx => {
    const [item, total] = await Promise.all([tx.get(ref.question), tx.get(ref.shard)]);
    if (!item.exists || item.data().confirmed) return false;
    const data = total.data() || {};
    const difficulty = knownDifficulty(item.data().difficulty);
    tx.update(ref.question, { confirmed: true });
    const patch = { generated: Number(data.generated) || 0, confirmed: (Number(data.confirmed) || 0) + 1 };
    if (difficulty) patch['confirmed_' + difficulty] = (Number(data['confirmed_' + difficulty]) || 0) + 1;
    tx.set(ref.shard, patch, { merge: true });
    return true;
  });
}
async function summary(db) {
  const snapshots = await Promise.all(Array.from({length: SHARDS}, (_, i) => db.collection('questionQualityTotals').doc(String(i)).get()));
  const totals = { generated: 0, confirmed: 0 };
  const byDifficulty = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, { generated: 0, confirmed: 0 }]));
  for (const snapshot of snapshots) {
    const data = snapshot.data() || {};
    totals.generated += Number(data.generated) || 0;
    totals.confirmed += Number(data.confirmed) || 0;
    for (const difficulty of DIFFICULTIES) {
      byDifficulty[difficulty].generated += Number(data['generated_' + difficulty]) || 0;
      byDifficulty[difficulty].confirmed += Number(data['confirmed_' + difficulty]) || 0;
    }
  }
  const withRate = counts => ({ ...counts, rate: counts.generated ? Math.round(counts.confirmed * 1000 / counts.generated) / 10 : null });
  const classified = DIFFICULTIES.reduce((acc, difficulty) => {
    acc.generated += byDifficulty[difficulty].generated;
    acc.confirmed += byDifficulty[difficulty].confirmed;
    return acc;
  }, {generated: 0, confirmed: 0});
  for (const difficulty of DIFFICULTIES) byDifficulty[difficulty] = withRate(byDifficulty[difficulty]);
  byDifficulty.unknown = withRate({generated: totals.generated - classified.generated, confirmed: totals.confirmed - classified.confirmed});
  return { ...withRate(totals), byDifficulty };
}
module.exports = { questionKey, recordGenerated, recordConfirmed, summary };
