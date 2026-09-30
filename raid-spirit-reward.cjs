'use strict';

const { createHash } = require('node:crypto');
const COLLECTION = 'raidSpiritClaims';
function count(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function eligibleCorrect(member) {
  return count(member?.totalScore) >= 68
    ? Math.min(count(member?.spiritCorrect), count(member?.correct), count(member?.attempts)) : 0;
}

// C records accepted answers; A applies only the unsettled cumulative difference.
// A/C cannot share a transaction. This receipt makes retries and out-of-order
// requests safe even if A commits and the response is lost or the server restarts.
async function awardRaidSpirit(db, uid, roomId, member) {
  const target = eligibleCorrect(member);
  if (!target) return { uid, status:'ineligible', awarded:0, settledCorrect:0 };
  const receiptId = createHash('sha256').update(roomId + '\n' + uid).digest('hex');
  const receiptRef = db.collection(COLLECTION).doc(receiptId);
  const userRef = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const receiptSnap = await tx.get(receiptRef);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('玩家資料不存在');
    const user = userSnap.data() || {};
    if (user.uid && user.uid !== uid) throw new Error('玩家資料 UID 不符');
    const prior = count(receiptSnap.data()?.settledCorrect);
    const awarded = Math.max(0, target - prior);
    const totalSpirit = count(user.stats?.nascentSoulSpirit) + awarded;
    if (awarded) {
      tx.update(userRef, { 'stats.nascentSoulSpirit': totalSpirit });
      tx.set(receiptRef, { uid, roomId, settledCorrect:target });
    }
    return { uid, status:awarded ? 'awarded' : 'duplicate', awarded,
      totalSpirit, settledCorrect:Math.max(prior, target) };
  });
}

module.exports = { COLLECTION, eligibleCorrect, awardRaidSpirit };
