// Per-browser, per-account cave snapshots. Only UI data is cached; Firestore owns rewards and settlement.
// Storage may be unavailable (private browsing, quota); the in-memory layer still prevents duplicate reads.
const PREFIX = 'xiuxian:dongtian:v1:';
const memory = new Map();

function read(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + key) || 'null');
    if (value !== null) memory.set(key, value);
    return value;
  } catch (_) { return null; }
}

function write(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
  catch (_) { /* storage full or disabled; retain the in-memory copy */ }
}

function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch (_) {}
}

const ownerKey = owner => 'owner:' + owner;
const fullKey = (owner, caveId) => 'full:' + owner + ':' + caveId;
const seenKey = owner => 'seen:' + owner;

export const dongtianCache = {
  getOwnedList(owner) {
    if (!owner) return null;
    const items = read(ownerKey(owner));
    return Array.isArray(items) && items.every(item => item?.id && item?.ownerUid === owner) ? items : null;
  },
  setOwnedList(owner, items) {
    if (owner && Array.isArray(items)) write(ownerKey(owner), items);
  },
  getPublicList() {
    const items = read('public');
    return Array.isArray(items) && items.every(item => item?.id && item?.status === 'active') ? items : null;
  },
  setPublicList(items) {
    if (Array.isArray(items)) write('public', items);
  },
  clearPublicList() { remove('public'); },
  getFull(owner, caveId) {
    if (!owner || !caveId) return null;
    const cave = read(fullKey(owner, caveId));
    return cave?.id === caveId && cave?.ownerUid === owner &&
      Array.isArray(cave.questions) && cave.questions.length ? cave : null;
  },
  setFull(owner, caveId, cave) {
    if (owner && caveId && cave?.ownerUid === owner && cave.id === caveId &&
      Array.isArray(cave.questions) && cave.questions.length) write(fullKey(owner, caveId), cave);
  },
  removeFull(owner, caveId) { if (owner && caveId) remove(fullKey(owner, caveId)); },
  clearOwnerFull(owner) {
    for (const item of this.getOwnedList(owner) || []) this.removeFull(owner, item.id);
  },
  hasEncountered(owner, caveId) {
    const seen = owner ? read(seenKey(owner)) : null;
    return Array.isArray(seen) && seen.includes(caveId);
  },
  markEncountered(owner, caveId) {
    if (!owner || !caveId) return;
    const seen = read(seenKey(owner));
    const ids = Array.isArray(seen) ? seen : [];
    if (!ids.includes(caveId)) write(seenKey(owner), [...ids, caveId]);
  }
};
