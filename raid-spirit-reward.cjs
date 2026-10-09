'use strict';

const { createHash } = require('node:crypto');
const Growth = require('./public/cultivation/nascent-growth.js');
const COLLECTION = 'raidSpiritClaims';
function count(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function eligibleCorrect(member) {
  return count(member?.totalScore) >= 68
    ? Math.min(count(member?.spiritCorrect), count(member?.correct), count(member?.attempts)) : 0;
}

// C records accepted answers; A applies only the unsettled cumulative difference.
// A/C cannot share a transaction. This receipt makes retries and out-of-order
// requests safe even if A commits and the response is lost or the server restarts.
function learningCorrect(member) {
  return Math.min(count(member?.learningCorrect), count(member?.correct), count(member?.attempts));
}

async function awardRaidSpirit(db, uid, roomId, member) {
  const target = eligibleCorrect(member);
  const learningTarget = learningCorrect(member);
  if (!target && !learningTarget) return { uid, status:'ineligible', awarded:0, settledCorrect:0 };
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
    const priorLearning = count(receiptSnap.data()?.settledLearningCorrect);
    const learningAwarded = Math.max(0, learningTarget - priorLearning);
    const cultivationAdded = learningAwarded * (1 + Growth.cultivation(user,'raid'));
    const growthState = Growth.award(user,awarded);
    const learningTotals = {
      cultivation: count(user.raidLearningRewards?.cultivation) + cultivationAdded,
      gold: count(user.raidLearningRewards?.gold) + learningAwarded * 20,
      fragments: count(user.raidLearningRewards?.fragments) + awarded
    };
    const totalFragments = growthState.fragments;
    if (awarded || learningAwarded) {
      const patch = { ...Growth.patch(growthState), raidLearningRewards: learningTotals };
      if (learningAwarded) Object.assign(patch, {
        'stats.totalScore': count(user.stats?.totalScore) + cultivationAdded,
        'stats.gold': count(user.stats?.gold) + learningAwarded * 20,
        raidLearningRewards: learningTotals
      });
      tx.update(userRef, patch);
      tx.set(receiptRef, { uid, roomId, settledCorrect:Math.max(prior,target),
        settledLearningCorrect:Math.max(priorLearning,learningTarget),
        roomCultivation:count(receiptSnap.data()?.roomCultivation ?? priorLearning)+cultivationAdded });
    }
    return { uid, status:(awarded || learningAwarded) ? 'awarded' : 'duplicate', awarded,
      totalFragments, cultivationAdded, roomCultivation:count(receiptSnap.data()?.roomCultivation ?? priorLearning)+cultivationAdded, learningAwarded, learningTotals,
      settledLearningCorrect:Math.max(priorLearning,learningTarget), settledCorrect:Math.max(prior, target) };
  });
}

module.exports = { COLLECTION, eligibleCorrect, learningCorrect, awardRaidSpirit };
