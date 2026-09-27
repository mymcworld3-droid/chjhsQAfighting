import {
  collection, doc, getDoc, getDocs, query, where, limit as queryLimit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices } from './project-repository.js';

const COLLECTION = 'rooms';
async function services() { return getProjectServices('C'); }

export const battleRepository = Object.freeze({
  domain:'battle', role:'C', collection:COLLECTION,
  async connect() { return services(); },
  async getRoom(roomId) {
    const { db } = await services();
    const snap = await getDoc(doc(db, COLLECTION, String(roomId || '')));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },
  async listWaiting(max = 80) {
    const { db } = await services();
    const q = query(collection(db, COLLECTION), where('status','==','waiting'),
      queryLimit(Math.max(1, Math.min(100, Number(max) || 80))));
    const snap = await getDocs(q);
    return snap.docs.map(row => ({ id:row.id, ...row.data() }));
  },
  async subscribeRoom(roomId, next, error) {
    const { db } = await services();
    return onSnapshot(doc(db, COLLECTION, String(roomId || '')),
      snap => next?.(snap.exists() ? { id:snap.id, ...snap.data() } : null), error);
  }
});
