'use strict';

// Only delivered questions are tracked. No question text or player identifiers
// are stored; the same normalized stem is counted once across reports and modes.
const crypto = require('node:crypto');
const SHARDS = 32;
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
async function recordGenerated(db, question, now = new Date()) {
  const ref = refs(db, question);
  return db.runTransaction(async tx => {
    const [item, total] = await Promise.all([tx.get(ref.question), tx.get(ref.shard)]);
    if (item.exists) return false;
    const data = total.data() || {};
    tx.create(ref.question, { createdAt: now, confirmed: false });
    tx.set(ref.shard, { generated: (Number(data.generated) || 0) + 1, confirmed: Number(data.confirmed) || 0 }, { merge: true });
    return true;
  });
}
async function recordConfirmed(db, question) {
  const ref = refs(db, question);
  return db.runTransaction(async tx => {
    const [item, total] = await Promise.all([tx.get(ref.question), tx.get(ref.shard)]);
    if (!item.exists || item.data().confirmed) return false;
    const data = total.data() || {};
    tx.update(ref.question, { confirmed: true });
    tx.set(ref.shard, { generated: Number(data.generated) || 0, confirmed: (Number(data.confirmed) || 0) + 1 }, { merge: true });
    return true;
  });
}
async function summary(db) {
  const snapshots = await Promise.all(Array.from({length: SHARDS}, (_, i) => db.collection('questionQualityTotals').doc(String(i)).get()));
  const counts = snapshots.reduce((acc, snapshot) => {
    const data = snapshot.data() || {};
    acc.generated += Number(data.generated) || 0;
    acc.confirmed += Number(data.confirmed) || 0;
    return acc;
  }, { generated: 0, confirmed: 0 });
  return { ...counts, rate: counts.generated ? Math.round(counts.confirmed * 1000 / counts.generated) / 10 : null };
}
module.exports = { questionKey, recordGenerated, recordConfirmed, summary };
