import {
  collection, doc, getDoc, getDocs, query, where, limit as queryLimit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices } from './project-repository.js';

export const DONGTIAN_COLLECTIONS = Object.freeze({
  index: 'dongtianIndex',
  data: 'dongtians',
  reports: 'dongtianReports'
});

async function services() {
  return getProjectServices('BD');
}

export const dongtianRepository = Object.freeze({
  domain: 'dongtian',
  role: 'BD',
  collections: DONGTIAN_COLLECTIONS,

  async getIndex(id) {
    const { db } = await services();
    const snap = await getDoc(doc(db, DONGTIAN_COLLECTIONS.index, String(id || '')));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },

  async getData(id) {
    const { db } = await services();
    const snap = await getDoc(doc(db, DONGTIAN_COLLECTIONS.data, String(id || '')));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },

  async listOwned(uid, max = 100) {
    const { db } = await services();
    const q = query(
      collection(db, DONGTIAN_COLLECTIONS.index),
      where('ownerUid', '==', String(uid || '')),
      queryLimit(Math.max(1, Math.min(200, Number(max) || 100)))
    );
    const snap = await getDocs(q);
    return snap.docs.map(row => ({ id:row.id, ...row.data() }));
  }
});
