import {
  doc, getDoc, setDoc, updateDoc, runTransaction, onSnapshot,
  collection, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices, getMainUser } from './project-repository.js';

const COLLECTION = 'users';

function uidValue(uid) {
  const value = String(uid || '').trim();
  if (!value) throw new Error('玩家 UID 不可為空');
  return value;
}

async function services() {
  return getProjectServices('A', { authenticateSecondary:false });
}

export const playerRepository = Object.freeze({
  domain: 'player',
  role: 'A',
  collection: COLLECTION,

  currentUser() {
    return getMainUser();
  },

  async get(uid) {
    const { db } = await services();
    const snap = await getDoc(doc(db, COLLECTION, uidValue(uid)));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },

  async merge(uid, value) {
    const { db } = await services();
    await setDoc(doc(db, COLLECTION, uidValue(uid)), value || {}, { merge:true });
  },

  async patch(uid, value) {
    const { db } = await services();
    await updateDoc(doc(db, COLLECTION, uidValue(uid)), value || {});
  },

  async transaction(uid, worker) {
    if (typeof worker !== 'function') throw new Error('playerRepository.transaction 需要 worker');
    const { db } = await services();
    const ref = doc(db, COLLECTION, uidValue(uid));
    return runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      return worker({ tx, ref, snapshot:snap, data:snap.exists() ? snap.data() : null });
    });
  },

  async subscribe(uid, next, error) {
    const { db } = await services();
    return onSnapshot(
      doc(db, COLLECTION, uidValue(uid)),
      snap => next?.(snap.exists() ? { id:snap.id, ...snap.data() } : null),
      error
    );
  },

  async sendRaidInvitations({ friendUids = [], activeAfterMs = 0, invitation = {} } = {}) {
    const { db } = await services();
    const currentUid = getMainUser()?.uid || '';
    const unique = [...new Set(friendUids
      .map(value => String(value || '').trim())
      .filter(value => value && value !== currentUid))].slice(0, 30);
    if (!unique.length) return [];

    const records = await Promise.all(unique.map(uid =>
      getDoc(doc(db, COLLECTION, uid)).catch(() => null)
    ));
    const cutoff = Math.max(0, Number(activeAfterMs) || 0);
    const online = records.filter(snap => {
      if (!snap?.exists()) return false;
      const active = snap.data()?.lastActive;
      const at = active?.toMillis?.() || Number(active) || 0;
      return at > cutoff;
    });

    await Promise.all(online.map(async snap => {
      try {
        await addDoc(collection(db, COLLECTION, snap.id, 'invitations'), {
          ...invitation,
          timestamp: serverTimestamp()
        });
      } catch (error) {
        console.warn('[PlayerRepository] raid invitation skipped:', snap.id, error);
      }
    }));
    return online.map(snap => snap.id);
  }
});
