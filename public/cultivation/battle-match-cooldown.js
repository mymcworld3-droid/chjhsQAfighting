// Account-scoped deadline survives refreshing and switching accounts.
export const BATTLE_EXIT_COOLDOWN_MS = 5 * 60 * 1000;

export function createBattleMatchCooldown({ repository, currentUser, userData, storage, now = Date.now }) {
  const deadlines = new Map();
  const key = uid => 'xiuxian:battle-exit-cooldown:' + uid;
  const value = input => Number.isFinite(Number(input)) ? Math.max(0, Number(input)) : 0;

  function deadline(uid = currentUser()?.uid) {
    if (!uid) return 0;
    let saved = 0;
    try { saved = value(storage?.getItem(key(uid))); } catch (_) {}
    const profile = currentUser()?.uid === uid ? value(userData()?.battleMatchCooldownUntilMs) : 0;
    return Math.max(saved, deadlines.get(uid) || 0, profile);
  }

  function remember(uid, until) {
    deadlines.set(uid, until);
    try { storage?.setItem(key(uid), String(until)); } catch (_) {}
    if (currentUser()?.uid === uid && userData()) userData().battleMatchCooldownUntilMs = until;
  }

  function remaining() { return Math.max(0, deadline() - now()); }

  async function start() {
    const uid = currentUser()?.uid;
    if (!uid) return;
    const until = Math.max(deadline(uid), now() + BATTLE_EXIT_COOLDOWN_MS);
    // Apply immediately, even while the profile write is pending or offline.
    remember(uid, until);
    await repository.patch(uid, { battleMatchCooldownUntilMs: until });
  }

  async function refresh() {
    const uid = currentUser()?.uid;
    if (!uid) throw new Error('請先登入');
    const profile = await repository.get(uid);
    if (currentUser()?.uid !== uid) throw new Error('登入帳號已變更');
    const remote = value(profile?.battleMatchCooldownUntilMs);
    const until = Math.max(deadline(uid), remote);
    remember(uid, until);
    // Retry an offline write without restarting the five-minute period.
    if (until > remote && until > now()) await repository.patch(uid, { battleMatchCooldownUntilMs: until });
    return remaining();
  }

  return { remaining, start, refresh };
}

export function battleCooldownLabel(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
