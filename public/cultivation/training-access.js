import './training-access-rules.js';
import { getMainUser, getProjectServices } from './data/project-repository.js';
import { doc, runTransaction } from '../data-store.js';

// Keep entrance unlocks across deductions, refreshes and devices. This never
// changes stats.totalScore, battle matchmaking or the cultivation reward curve.
const Rules = globalThis.QATrainingAccessRules;
const accounts = new Map();
const cacheKey = uid => `qa-training-access-v1:${uid}`;
const data = () => window.getCurrentUserData?.();
function account() {
  const uid = getMainUser()?.uid, player = data();
  if (!uid || !player?.stats || (player.uid && player.uid !== uid)) return null;
  if (!accounts.has(uid)) {
    let cached = 0;
    try { cached = Rules.realmScore(localStorage.getItem(cacheKey(uid))); } catch (_) {}
    accounts.set(uid, { uid, highest: cached, confirmed: -1, saving: false, retry: null });
  }
  return accounts.get(uid);
}
function remember(state, highest) {
  state.highest = Math.max(state.highest, Rules.realmScore(highest));
  try { localStorage.setItem(cacheKey(state.uid), String(state.highest)); } catch (_) {}
  if (getMainUser()?.uid === state.uid && data()?.stats && (!data().uid || data().uid === state.uid)) {
    data().trainingAccess = Rules.record(data(), state.highest);
  }
}
async function persist(state) {
  if (state.saving || state.highest <= state.confirmed) return;
  state.saving = true;
  clearTimeout(state.retry);
  state.retry = null;
  const observed = state.highest;
  try {
    const { db } = await getProjectServices('A', { authenticateSecondary: false });
    if (getMainUser()?.uid !== state.uid) return;
    const ref = doc(db, 'users', state.uid);
    const saved = await runTransaction(db, async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('玩家資料尚未準備完成');
      const remote = snapshot.data();
      const next = Rules.record(remote, observed);
      if (remote.trainingAccess?.version !== 1 || Rules.savedScore(remote) < next.highestRealmScore) {
        tx.update(ref, { trainingAccess: next });
      }
      return next;
    });
    state.confirmed = Math.max(state.confirmed, saved.highestRealmScore);
    const previous = state.highest;
    remember(state, saved.highestRealmScore);
    if (getMainUser()?.uid === state.uid && previous < state.highest) {
      window.dispatchEvent(new CustomEvent('xiuxian:training-access-updated'));
    }
  } catch (error) {
    console.warn('[Training access] unlock sync will retry:', error.code || error.message);
    if (getMainUser()?.uid === state.uid) state.retry = setTimeout(sync, 5000);
  } finally {
    state.saving = false;
    if (!state.retry && getMainUser()?.uid === state.uid && state.highest > state.confirmed) void persist(state);
  }
}
function sync() {
  const state = account();
  if (!state) return;
  remember(state, Rules.score(data()));
  void persist(state);
}
window.getTrainingAccessScore = function () {
  const state = account();
  if (!state) return 0;
  return Math.max(Rules.score(data()), state?.highest || 0);
};
window.isTrainingPlaceUnlocked = id => {
  const place = Rules.PLACES.find(place => place.id === id);
  return !!data()?.stats && !!place && window.getTrainingAccessScore() >= place.threshold;
};
['xiuxian:user-ready', 'xiuxian:stats-updated', 'xiuxian:migration-ready', 'xiuxian:features-ready', 'online']
  .forEach(name => window.addEventListener(name, sync));
sync();
