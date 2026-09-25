'use strict';

const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');

const MAX_UID = 128;
const SENSITIVE_KEY = /password|secret|token|credential|private.?key|authorization|api.?key/i;

function tokenFrom(req) {
  const header = String(req.get?.('authorization') || '');
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  return match ? match[1] : '';
}

function validUid(value) {
  const uid = String(value || '').trim();
  return uid && uid.length <= MAX_UID && !uid.includes('/') ? uid : '';
}

function timeMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return Number(value.toDate()?.getTime?.()) || 0;
  if (value.seconds !== undefined) return (Number(value.seconds) || 0) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicTime(value) {
  const ms = timeMs(value);
  return ms ? new Date(ms).toISOString() : null;
}

function redact(value, depth = 0) {
  if (depth > 12) return '[資料過深，已省略]';
  if (value === null || value === undefined || typeof value === 'string' ||
      typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value.toDate === 'function' || typeof value.toMillis === 'function') return publicTime(value);
  if (Array.isArray(value)) return value.slice(0, 500).map(item => redact(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) out[key] = '[已遮蔽]';
    else out[key] = redact(item, depth + 1);
  }
  return out;
}

function summary(docSnap) {
  const data = docSnap.data() || {};
  return {
    uid: docSnap.id,
    data: {
      displayName: data.displayName || '',
      name: data.name || '',
      email: data.email || '',
      friendCode: data.friendCode || '',
      isAdmin: data.isAdmin === true,
      createdAt: publicTime(data.createdAt),
      lastActive: publicTime(data.lastActive)
    }
  };
}

async function verifiedAdmin(req, resolve) {
  const token = tokenFrom(req);
  if (!token) {
    const error = new Error('請先登入管理員帳號。');
    error.status = 401;
    throw error;
  }
  let a;
  try { a = resolve('A'); }
  catch (cause) {
    const error = new Error('管理員後端尚未設定 Firebase A 服務帳戶。');
    error.status = 503;
    error.cause = cause;
    throw error;
  }
  let decoded;
  try { decoded = await a.auth.verifyIdToken(token, true); }
  catch (_) {
    const error = new Error('登入已失效，請重新登入。');
    error.status = 401;
    throw error;
  }
  if (!decoded?.uid || decoded.aud !== PROJECT_IDS.A ||
      decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
    const error = new Error('主專案身分驗證失敗。');
    error.status = 401;
    throw error;
  }
  const adminSnap = await a.db.collection('users').doc(decoded.uid).get();
  if (!adminSnap.exists || adminSnap.data()?.isAdmin !== true) {
    const error = new Error('此帳號沒有管理員權限。');
    error.status = 403;
    throw error;
  }
  return { a, uid: decoded.uid };
}

function createAdminAccountHandler({ resolve = role => adminProject(role), logger = console } = {}) {
  return async function adminAccountHandler(req, res) {
    res.set?.('Cache-Control', 'no-store');
    try {
      const { a } = await verifiedAdmin(req, resolve);
      const action = String(req.body?.action || 'list');
      if (action === 'list') {
        const snapshot = await a.db.collection('users').get();
        const entries = snapshot.docs.map(summary).sort((left, right) => {
          const l = timeMs(left.data.lastActive || left.data.createdAt);
          const r = timeMs(right.data.lastActive || right.data.createdAt);
          return r - l || String(left.data.displayName || left.data.name || '')
            .localeCompare(String(right.data.displayName || right.data.name || ''), 'zh-TW');
        });
        return res.status(200).json({ count: entries.length, entries });
      }
      if (action === 'detail') {
        const uid = validUid(req.body?.uid);
        if (!uid) return res.status(400).json({ error: '玩家 UID 無效。' });
        const snapshot = await a.db.collection('users').doc(uid).get();
        if (!snapshot.exists) return res.status(404).json({ error: '帳號不存在，可能已被刪除。' });
        return res.status(200).json({ uid, data: redact(snapshot.data()) });
      }
      return res.status(400).json({ error: '未知的帳號管理操作。' });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) logger.error('[Admin Accounts API]', error?.cause?.message || error?.message || error);
      else logger.warn('[Admin Accounts API]', error?.message || error);
      return res.status(status).json({ error: status >= 500 ? '帳號管理服務暫時無法使用。' : error.message });
    }
  };
}

module.exports = function registerAdminAccountApi(app, options = {}) {
  app.post('/api/admin/accounts', createAdminAccountHandler(options));
};
module.exports.__test = { createAdminAccountHandler, validUid, redact, timeMs, publicTime };
