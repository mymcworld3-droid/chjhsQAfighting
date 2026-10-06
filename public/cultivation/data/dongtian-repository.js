import {
  collection, doc, getDoc, getDocs, query, where, limit as queryLimit
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getProjectServices, authenticatedMainFetch } from './project-repository.js';

export const DONGTIAN_COLLECTIONS = Object.freeze({
  index:'dongtianIndex', data:'dongtians', plays:'dongtianPlays', reports:'dongtianReports'
});
async function contentServices() { return getProjectServices('BD'); }
async function progressServices() { return getProjectServices('A', { authenticateSecondary:false }); }

export const dongtianRepository = Object.freeze({
  domain:'dongtian', role:'BD', progressRole:'A', collections:DONGTIAN_COLLECTIONS,
  async connect() {
    const [content, progress] = await Promise.all([contentServices(), progressServices()]);
    return { content, progress };
  },
  async getIndex(id) {
    const { db } = await contentServices();
    const snap = await getDoc(doc(db, DONGTIAN_COLLECTIONS.index, String(id || '')));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },
  async getData(id) {
    const { db } = await contentServices();
    const snap = await getDoc(doc(db, DONGTIAN_COLLECTIONS.data, String(id || '')));
    return snap.exists() ? { id:snap.id, ...snap.data() } : null;
  },
  async listIndex(mode = 'owned') {
    const response = await authenticatedMainFetch('/api/dongtian/list-index', {
      method: 'POST',
      body: JSON.stringify({ mode: mode === 'public' ? 'public' : 'owned' })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.items)) {
      throw new Error(payload.error || '洞天名冊暫時無法讀取');
    }
    return payload.items;
  },
  async listOwned(uid, max = 100) {
    const { db } = await contentServices();
    const q = query(collection(db, DONGTIAN_COLLECTIONS.index),
      where('ownerUid','==',String(uid || '')),
      queryLimit(Math.max(1, Math.min(200, Number(max) || 100))));
    const snap = await getDocs(q);
    return snap.docs.map(row => ({ id:row.id, ...row.data() }));
  }
});
