'use strict';

const { randomUUID } = require('node:crypto');
const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const { migrate } = require('./scripts/migrate-dongtian-to-bd.cjs');

const MIGRATION_ID = 'dongtian-a-to-bd-v1';
const LEASE_MS = 15 * 60 * 1000;
const FAILED_RETRY_MS = 30 * 60 * 1000;

// Shared state lives in A, not in a Render process: simultaneous visitors / instances
// only compete for a Firestore transaction. The first successful lease holder copies.
function createMigrationController({
  env = process.env,
  resolve = role => adminProject(role),
  copy = migrate,
  now = Date.now,
  uuid = randomUUID,
  logger = console
} = {}) {
  let working = null;

  function enabled() { return env.FIREBASE_AUTO_MIGRATE_ON_START === '1'; }
  function markerRef(a) { return a.db.collection('systemMigrations').doc(MIGRATION_ID); }
  function publicState(data) {
    const status = data?.status === 'ready' && data?.verified === true ? 'ready'
      : data?.status === 'running' ? 'running'
      : data?.status === 'failed' ? 'failed' : 'pending';
    return { status, ready: status === 'ready', message: {
      ready: '洞天複製與核對已完成。',
      running: '正在檢查並搬移洞天資料。',
      failed: '洞天搬移失敗，請聯絡管理員檢查 Render 日誌。',
      pending: '正在準備洞天資料搬移。'
    }[status] };
  }

  async function acquire(ref) {
    const owner = uuid();
    const claimed = await ref.firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : {};
      if (current?.status === 'ready' && current?.verified === true) return false;
      if (current?.status === 'running' && Number(current.leaseUntilMs || 0) > now()) return false;
      if (current?.status === 'failed' && Number(current.retryAfterMs || 0) > now()) return false;
      tx.set(ref, {
        status: 'running', verified: false,
        owner, leaseUntilMs: now() + LEASE_MS, updatedAtMs: now(),
        source: PROJECT_IDS.A, destination: PROJECT_IDS.BD, migrationId: MIGRATION_ID
      }, { merge: true });
      return true;
    });
    return claimed ? owner : null;
  }

  async function checkLease(ref, owner) {
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.owner !== owner ||
        snap.data()?.status !== 'running' || Number(snap.data()?.leaseUntilMs || 0) <= now()) {
      throw new Error('Migration lease lost; aborting before another write.');
    }
  }

  async function renew(ref, owner) {
    await ref.firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.owner !== owner || snap.data()?.status !== 'running' ||
          Number(snap.data()?.leaseUntilMs || 0) <= now()) throw new Error('Migration lease lost');
      tx.update(ref, { leaseUntilMs: now() + LEASE_MS, updatedAtMs: now() });
    });
  }

  async function run(ref, owner, a, bd) {
    let lost = false;
    const heartbeat = setInterval(() => {
      if (lost) return;
      renew(ref, owner).catch(error => {
        lost = true;
        logger.warn('[Auto cave migration] lease renewal failed:', error.message);
      });
    }, 30000);
    heartbeat.unref?.();
    try {
      const beforeBatch = async () => {
        if (lost) throw new Error('Migration lease renewal failed');
        await checkLease(ref, owner);
      };
      const report = await copy({ source: a.db, destination: bd.db, action: 'execute', beforeBatch, output: logger });
      await ref.firestore.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data()?.owner !== owner || snap.data()?.status !== 'running') {
          throw new Error('Migration ownership changed before verification was committed');
        }
        tx.update(ref, {
          status: 'ready', verified: true, leaseUntilMs: 0, verifiedAtMs: now(),
          counts: Object.fromEntries(Object.entries(report || {}).map(([name, row]) =>
            [name, { source: row.source, target: row.target, missing: row.missing }])),
          updatedAtMs: now()
        });
      });
      logger.log('[Auto cave migration] A -> BD verified.');
    } catch (error) {
      logger.error('[Auto cave migration] stopped:', error.message);
      try {
        await ref.firestore.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (snap.exists && snap.data()?.owner === owner && snap.data()?.status === 'running') {
            tx.update(ref, {
              status: 'failed', verified: false, leaseUntilMs: 0,
              retryAfterMs: now() + FAILED_RETRY_MS, updatedAtMs: now()
            });
          }
        });
      } catch (updateError) {
        logger.error('[Auto cave migration] could not record failure:', updateError.message);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function status({ trigger = true } = {}) {
    if (!enabled()) return {
      status: 'legacy', ready: true, migrationComplete: false,
      message: '正式遊戲仍使用 A；自動搬移尚未啟用。'
    };
    let a, bd;
    try {
      a = resolve('A');
      bd = resolve('BD');
      if (a.app.options.projectId !== PROJECT_IDS.A || bd.app.options.projectId !== PROJECT_IDS.BD) {
        throw new Error('Firebase project mismatch');
      }
    } catch (error) {
      logger.warn('[Auto cave migration] missing server configuration:', error.message);
      return { status: 'blocked', ready: false, message: '洞天搬移尚未設定完成，請聯絡管理員。' };
    }
    const ref = markerRef(a);
    let existing;
    try { existing = await ref.get(); }
    catch (error) {
      logger.warn('[Auto cave migration] status read failed:', error.message);
      return { status: 'blocked', ready: false, message: '無法確認洞天搬移狀態。' };
    }
    const data = existing.exists ? existing.data() : {};
    if (data.status === 'ready' && data.verified === true) return publicState(data);
    if (data.status === 'running' && Number(data.leaseUntilMs || 0) > now()) return publicState(data);
    if (data.status === 'failed' && Number(data.retryAfterMs || 0) > now()) return publicState(data);
    if (!trigger) return publicState(data);
    try {
      const owner = await acquire(ref);
      if (owner) {
        // This is backend work, never started in the browser. The durable Firestore
        // lease and marker survive a Render restart.
        working = run(ref, owner, a, bd).finally(() => { working = null; });
      }
      const state = await ref.get();
      return publicState(state.exists ? state.data() : {});
    } catch (error) {
      logger.error('[Auto cave migration] acquire failed:', error.message);
      return { status: 'blocked', ready: false, message: '洞天搬移暫時無法啟動。' };
    }
  }

  return { status, enabled, publicState };
}

module.exports = function registerAutoMigrationApi(app, options = {}) {
  const controller = createMigrationController(options);
  app.post('/api/game-startup-migration', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Migration can only be triggered by a logged-in player, after validating
    // the A token. Never trust a UID, project, or destination from the body.
    if (!controller.enabled()) return res.status(200).json(await controller.status());
    const header = String(req.get('authorization') || '');
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
    if (!match) return res.status(401).json({ status: 'blocked', ready: false, message: '請先登入再檢查資料。' });
    let a;
    try { a = (options.resolve || adminProject)('A'); }
    catch (_) { return res.status(503).json({ status: 'blocked', ready: false, message: '尚未設定 A 的驗證憑證。' }); }
    try {
      const token = await a.auth.verifyIdToken(match[1], true);
      if (!token?.uid || token.aud !== PROJECT_IDS.A ||
          token.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) throw new Error('Invalid token');
    } catch (_) {
      return res.status(401).json({ status: 'blocked', ready: false, message: '主專案登入已失效，請重新登入。' });
    }
    const current = await controller.status();
    res.status(current.status === 'blocked' ? 503 : 200).json(current);
  });
  return controller;
};
module.exports.createMigrationController = createMigrationController;
