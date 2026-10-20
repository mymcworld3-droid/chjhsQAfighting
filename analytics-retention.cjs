'use strict';

const HOUR = 60 * 60 * 1000;
const gates = new WeakMap();

// Called after the authenticated arrival response is sent. No timer, browser
// request or per-player database lease: every A-store in this process shares a gate.
function queueAnalyticsCleanup(db, { now = Date.now(), logger = console } = {}) {
  if (!db?.isD1 || db.role !== 'A' || typeof db.gateway !== 'function') return false;
  const gate = gates.get(db) || { pending: null, retryAt: 0 };
  if (gate.pending || now < gate.retryAt) return false;
  gates.set(db, gate);
  gate.retryAt = now + HOUR; // Reserve before loading SQL, so simultaneous logins coalesce.
  const task = import('./cloudflare/d1/src/analytics-retention.mjs')
    .then(({ cleanupStatements }) => db.gateway(cleanupStatements(now)))
    .then(result => {
      // D1 reports actual affected rows. An empty indexed sweep needs no further
      // check for 12 hours; missing metadata conservatively keeps the hourly gate.
      if (result[1]?.meta?.changes === 0) gate.retryAt = now + 12 * HOUR;
      return true;
    })
    .catch(() => {
      logger.warn?.('[Analytics retention] Background cleanup deferred; retry after cooldown.');
      return false;
    })
    .finally(() => { gate.pending = null; });
  gate.pending = task;
  return task;
}

module.exports = { queueAnalyticsCleanup };
