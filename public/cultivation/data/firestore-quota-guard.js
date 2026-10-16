// Share one circuit across all room reads/writes. A quota failure in one task
// must also stop the other timers, rather than each starting its own retry loop.
export function createFirestoreQuotaGuard({ now = Date.now, onExhausted = () => {} } = {}) {
  let retryAt = 0, failures = 0;
  const blocked = () => now() < retryAt;
  function failure(error) {
    if (String(error?.code || '').replace(/^firestore\//, '') !== 'resource-exhausted') return;
    // Concurrent requests failing in the same outage share the same deadline.
    if (blocked()) return;
    retryAt = now() + Math.min(30 * 60 * 1000, 60000 * 2 ** Math.min(failures++, 5));
    onExhausted(error, retryAt);
  }
  return Object.freeze({
    blocked, failure,
    retryAt: () => retryAt,
    success() { failures = 0; },
    async run(operation) {
      if (blocked()) {
        const error = new Error('鬥法資料庫額度受限，正在等待重連。');
        error.code = 'resource-exhausted';
        throw error;
      }
      try { return await operation(); }
      catch (error) { failure(error); throw error; }
    }
  });
}
