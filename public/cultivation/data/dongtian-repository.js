import {
  collection, doc, getDoc, getDocs, query, where, limit as queryLimit
} from '../../data-store.js';
import { getProjectServices, authenticatedMainFetch, getMainUser } from './project-repository.js';

export const DONGTIAN_COLLECTIONS = Object.freeze({
  index:'dongtianIndex', data:'dongtians', plays:'dongtianPlays', reports:'dongtianReports'
});
async function contentServices() { return getProjectServices('BD'); }
async function progressServices() { return getProjectServices('A', { authenticateSecondary:false }); }

async function entryRequest(id, action = 'read', owned = false) {
  const owner = getMainUser()?.uid;
  if (!owner) throw new Error('請先登入再進入洞天');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await authenticatedMainFetch('/api/dongtian/entry', {
      method:'POST', signal:controller.signal,
      body:JSON.stringify({dongtianId:String(id || ''),action,owned})
    });
    const payload = await response.json().catch(() => ({}));
    if (getMainUser()?.uid !== owner) throw new Error('登入狀態已改變，請重新進入');
    if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.error || '洞天讀取失敗'), {
      code:payload.code || 'http-' + response.status, phase:payload.phase || 'content-read'
    });
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('洞天讀取逾時，請稍後再試'), {code:'deadline-exceeded',phase:'content-read'});
    throw error;
  } finally { clearTimeout(timer); }
}

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
  async getData(id, {owned = false} = {}) {
    const payload = await entryRequest(id, 'read', owned);
    if (!payload.cave?.questions?.length) throw new Error('洞天題目尚未準備完成');
    return payload.cave;
  },
  async markEncountered(id) { return entryRequest(id, 'encounter'); },
  async recordVisit(id) { return entryRequest(id, 'visit'); },
  async deleteOwned(dongtianId) {
    const response = await authenticatedMainFetch('/api/dongtian/delete', {
      method: 'POST',
      body: JSON.stringify({ dongtianId: String(dongtianId || '') })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || '洞天刪除失敗');
    }
    return payload;
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
