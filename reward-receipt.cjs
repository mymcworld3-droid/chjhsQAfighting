'use strict';

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(label + ' is required');
  return text;
}

async function runRewardReceipt({
  db,
  collection,
  receiptId,
  onFirstClaim,
  createReceipt = {},
  fieldValue = require('firebase-admin/firestore').FieldValue
} = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Firestore db is required');
  const collectionName = requiredText(collection, 'receipt collection');
  const id = requiredText(receiptId, 'receipt id');
  if (typeof onFirstClaim !== 'function') throw new Error('onFirstClaim is required');

  const receiptRef = db.collection(collectionName).doc(id);
  return db.runTransaction(async tx => {
    const snap = await tx.get(receiptRef);
    if (snap.exists) {
      return { duplicate:true, receipt:snap.data() || {}, result:null };
    }

    const result = await onFirstClaim({ tx, receiptRef });
    const payload = typeof createReceipt === 'function' ? createReceipt(result) : createReceipt;
    const receipt = { ...(payload || {}), createdAt:fieldValue.serverTimestamp() };
    tx.create(receiptRef, receipt);
    return { duplicate:false, receipt, result };
  });
}

module.exports = { runRewardReceipt };
