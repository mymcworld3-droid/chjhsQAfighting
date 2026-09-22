'use strict';

const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const SCHEMA_VERSION = 1;
const PROFILE_COLLECTION = 'playerProfiles';

function safeText(input, length = 80) {
  return typeof input === 'string' ? input.trim().slice(0, length) : '';
}

function projectPlayerData(role, uid, user) {
  if (role !== 'BD' && role !== 'C') throw new Error('Unknown profile destination');
  const shared = {
    uid,
    displayName: safeText(user.displayName, 64) || '無名修士',
    avatar: safeText(user.equipped?.avatar, 512),
    sourceProject: PROJECT_IDS.A,
    schemaVersion: SCHEMA_VERSION
  };
  if (role === 'BD') return shared;
  return {
    ...shared,
    frame: safeText(user.equipped?.frame, 512),
    gender: user.storyProgressV1?.gender === 'female' ? 'female' : 'male'
  };
}

async function createPlayerProfile(db, uid, data, { now = Date.now } = {}) {
  const ref = db.collection(PROFILE_COLLECTION).doc(uid);
  let created = false;
  // The destination itself arbitrates concurrent first visits; failures in
  // the other project can be retried without replacing an existing profile.
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      if (snap.data()?.uid !== uid || snap.data()?.sourceProject !== PROJECT_IDS.A ||
          snap.data()?.schemaVersion !== SCHEMA_VERSION) {
        throw new Error('Existing secondary player profile is inconsistent');
      }
      return;
    }
    tx.create(ref, { ...data, firstSyncedAtMs: now() });
    created = true;
  });
  return created ? 'created' : 'existing';
}

function createPlayerProvisionHandler({
  resolve = role => adminProject(role),
  migrationStatus,
  project = projectPlayerData,
  create = createPlayerProfile,
  logger = console
} = {}) {
  if (typeof migrationStatus !== 'function') throw new Error('Migration state reader is required');
  return async function playerProvisionHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.get?.('authorization') || ''));
    if (!bearer) return res.status(401).json({ ready: false, message: '請先登入 A 專案。' });
    let a, bd, c;
    try {
      a = resolve('A');
      bd = resolve('BD');
      c = resolve('C');
      if (a.app.options.projectId !== PROJECT_IDS.A || bd.app.options.projectId !== PROJECT_IDS.BD ||
          c.app.options.projectId !== PROJECT_IDS.C) throw new Error('Firebase project mismatch');
    } catch (error) {
      logger.error('[Player provisioning] project setup:', error.message);
      return res.status(503).json({ ready: false, message: '跨專案服務尚未設定完成。' });
    }

    let verified;
    try {
      verified = await a.auth.verifyIdToken(bearer[1], true);
      if (!verified.uid || verified.aud !== PROJECT_IDS.A ||
          verified.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) throw new Error('Invalid A identity');
    } catch (_) {
      return res.status(401).json({ ready: false, message: '登入已失效，請重新登入。' });
    }

    let status;
    try { status = await migrationStatus({ trigger: false }); }
    catch (error) {
      logger.error('[Player provisioning] migration check:', error.message);
      return res.status(503).json({ ready: false, message: '目前無法核對洞天搬移狀態。' });
    }
    if (status?.status !== 'ready' || status?.ready !== true) {
      return res.status(503).json({ ready: false, message: '洞天尚未完成搬移及核對。' });
    }

    const uid = verified.uid;
    try {
      const userSnap = await a.db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        return res.status(404).json({ ready: false, message: 'A 專案沒有這位玩家的正式資料。' });
      }
      const profile = userSnap.data();
      if (profile.uid && profile.uid !== uid) throw new Error('Main user record UID mismatch');
      const bdResult = await create(bd.db, uid, project('BD', uid, profile));
      const cResult = await create(c.db, uid, project('C', uid, profile));
      return res.status(200).json({
        ready: true, uid,
        profiles: { BD: bdResult, C: cResult }
      });
    } catch (error) {
      logger.error('[Player provisioning] incomplete, safe to retry:', error.message);
      return res.status(503).json({ ready: false, message: '同步玩家資料未完成，請重新整理後重試。' });
    }
  };
}

module.exports = function registerPlayerProvisionApi(app, { migrationController, ...options } = {}) {
  if (!migrationController) throw new Error('Player provisioning requires the shared migration controller');
  app.post('/api/game-startup-player', createPlayerProvisionHandler({
    ...options,
    migrationStatus: params => migrationController.status(params)
  }));
};
module.exports.createPlayerProvisionHandler = createPlayerProvisionHandler;
module.exports.createPlayerProfile = createPlayerProfile;
module.exports.projectPlayerData = projectPlayerData;
