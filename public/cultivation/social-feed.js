import { collection, query, orderBy, limit, startAfter, getDocs, onSnapshot } from '../data-store.js';

const PAGE_SIZE = 50;
export const socialFeedKind = message => message?.type === 'curriculum-share' ? 'shares' : 'chat';
function timestamp(doc) {
  const value = doc.data()?.timestamp;
  if (Number.isFinite(value?.seconds)) return [value.seconds, value.nanoseconds || 0];
  const ms = value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);
  return [Math.floor(ms / 1000), (ms % 1000) * 1000000];
}
function newestFirst(a, b) {
  const x = timestamp(a), y = timestamp(b);
  return y[0] - x[0] || y[1] - x[1] || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

// Keep the existing message records, including shares created by older clients.
// Fill each channel independently so a busy channel cannot hide the other one.
export function subscribeSocialFeed(db, kind, maximum, next, error = () => {}) {
  if (!['chat', 'shares'].includes(kind)) throw Error('未知的仙盟分頁');
  maximum = Math.max(1, Math.min(50, Number(maximum) || 25));
  const liveSize = maximum === 1 ? 1 : PAGE_SIZE;
  const base = collection(db, 'global_chat');
  const matches = doc => socialFeedKind(doc.data()) === kind;
  let active = true, revision = 0, cached = [], previous = new Set(), exhausted = false;
  const stop = onSnapshot(query(base, orderBy('timestamp', 'desc'), limit(liveSize)), snapshot => {
    const epoch = ++revision;
    void (async () => {
      const docs = snapshot.docs, ids = new Set(docs.map(doc => doc.id)), boundary = docs.at(-1);
      // A full window can move older rows out of view; keep those cached rows.
      // Rows removed from inside the window have been deleted and must disappear.
      const older = docs.length < liveSize ? [] : cached.filter(doc => !ids.has(doc.id) &&
        (!previous.has(doc.id) || newestFirst(doc, boundary) > 0));
      const found = new Map(older.map(doc => [doc.id, doc]));
      for (const doc of docs.filter(matches)) found.set(doc.id, doc);
      let ended = docs.length < liveSize || exhausted;
      let cursor = [...found.values()].sort(newestFirst).at(-1) || boundary;
      const visited = new Set();
      while (found.size < maximum && !ended && cursor) {
        if (!active || epoch !== revision) return;
        if (visited.has(cursor.id)) throw Error('訊息分頁游標重複，請重新開啟分頁');
        visited.add(cursor.id);
        const page = await getDocs(query(base, orderBy('timestamp', 'desc'), startAfter(cursor), limit(PAGE_SIZE)));
        if (!active || epoch !== revision) return;
        for (const doc of page.docs.filter(matches)) found.set(doc.id, doc);
        ended = page.docs.length < PAGE_SIZE && found.size < maximum;
        if (!page.docs.length) break;
        cursor = page.docs.at(-1);
      }
      if (!active || epoch !== revision) return;
      cached = [...found.values()].sort(newestFirst).slice(0, maximum);
      previous = ids;
      exhausted = ended && found.size < maximum;
      next(cached);
    })().catch(reason => { if (active && epoch === revision) error(reason); });
  }, reason => { if (active) error(reason); });
  return () => { active = false; revision++; stop(); };
}
