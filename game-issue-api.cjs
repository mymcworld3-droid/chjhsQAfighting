'use strict';
const { createHash } = require('node:crypto');
const { playerRepository } = require('./server-repositories.cjs');
const { verifyRequest } = require('./invitation-api.cjs');
const { clean } = require('./public/cultivation/refinery-errors.js');
const COLLECTION = 'gameIssueReports';
const STATES = ['open', 'investigating', 'resolved'];
const CATEGORIES = ['功能異常', '畫面與操作', '資料與獎勵', '其他問題'];
const DAY = 86400000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max) => clean(typeof value === 'string' ? value.trim().replace(/("(?:api[_-]?key|access[_-]?token|authorization|secret|password)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"') : '', max);
const validId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

function normalize(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('回報格式無效。');
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(body.requestId || '')) throw fail('回報識別碼無效，請重新開啟回報。');
  const description = text(body.description, 3000);
  if (description.length < 5) throw fail('請至少用五個字說明遇到的問題。');
  if (typeof body.description !== 'string' || body.description.length > 3000) throw fail('問題說明最多 3000 字。');
  const context = body.context || {};
  return {
    description,
    category: CATEGORIES.includes(body.category) ? body.category : '其他問題',
    context: {
      page: text(context.page, 100), version: text(context.version, 100),
      viewport: text(context.viewport, 60), browser: text(context.browser, 400),
      // Only explicit, bounded diagnostics are accepted; never upload player profiles or tokens.
      diagnostics: text(context.diagnostics, 6000)
    }
  };
}
async function submit(db, uid, body, now = Date.now()) {
  const report = normalize(body);
  const id = createHash('sha256').update(uid + '\n' + body.requestId).digest('hex').slice(0, 40);
  const ref = db.collection(COLLECTION).doc(id);
  const limiter = db.collection('gameIssueLimits').doc(uid);
  return db.runTransaction(async tx => {
    const [existing, quota, player] = await Promise.all([tx.get(ref), tx.get(limiter), tx.get(db.collection('users').doc(uid))]);
    if (existing.exists) return { reportId: id, duplicate: true };
    if (!player.exists) throw fail('找不到玩家資料，請重新登入。', 404);
    const sent = (Array.isArray(quota.data()?.sent) ? quota.data().sent : []).filter(t => Number.isFinite(t) && t > now - DAY);
    if (sent.length >= 20 || sent.filter(t => t > now - 3600000).length >= 5) throw fail('每小時最多回報 5 次、每日 20 次，請稍後再試。', 429);
    tx.set(ref, { ...report, reporterUid: uid, reporterName: text(player.data().displayName || player.data().name, 80),
      status: 'open', createdAtMs: now, updatedAtMs: now, adminNote: '' });
    tx.set(limiter, { sent: [...sent, now] });
    return { reportId: id, duplicate: false };
  });
}
async function list(db, body = {}) {
  let query = db.collection(COLLECTION).orderBy('createdAtMs', 'desc').orderBy('__name__', 'desc');
  if (body.cursor != null) {
    if (!Number.isSafeInteger(body.cursor?.at) || body.cursor.at < 0 || !validId(body.cursor?.id)) throw fail('回報分頁游標無效。');
    query = query.startAfter(body.cursor.at, body.cursor.id);
  }
  const snapshot = await query.limit(21).get();
  const docs = snapshot.docs.slice(0, 20), last = docs.at(-1);
  return { entries: docs.map(doc => ({ id: doc.id, ...doc.data() })),
    nextCursor: snapshot.docs.length > 20 ? { at: last.data().createdAtMs, id: last.id } : null };
}
async function update(db, uid, body, now = Date.now()) {
  if (!validId(body.reportId) || !STATES.includes(body.status)) throw fail('回報或處理狀態無效。');
  const ref = db.collection(COLLECTION).doc(body.reportId);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw fail('找不到這筆回報。', 404);
    const fields = { status: body.status, adminNote: text(body.adminNote, 1000), updatedAtMs: now, handledBy: uid };
    tx.update(ref, fields);
    return { entry: { id: snapshot.id, ...snapshot.data(), ...fields } };
  });
}
function createHandlers({ resolveA = () => playerRepository.resolve(), now = Date.now, logger = console } = {}) {
  const route = admin => async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      if (!req.get?.('authorization')) throw fail('請先登入後再回報問題。', 401);
      const { uid, a } = await verifyRequest(req, resolveA);
      let result;
      if (admin) {
        const profile = await a.db.collection('users').doc(uid).get();
        if (!profile.exists || profile.data()?.isAdmin !== true) throw fail('此帳號沒有管理員權限。', 403);
        if (req.body?.action === 'list') result = await list(a.db, req.body);
        else if (req.body?.action === 'update') result = await update(a.db, uid, req.body, now());
        else throw fail('未知的回報管理操作。');
      } else result = await submit(a.db, uid, req.body, now());
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (!error.status || error.status >= 500) logger.warn('[Game issue report]', error.code || 'unavailable');
      return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : '回報服務暫時無法使用，內容已保留，請稍後重試。' });
    }
  };
  return { submit: route(false), admin: route(true) };
}
module.exports = function registerGameIssueApi(app, options) {
  const handlers = createHandlers(options);
  app.post('/api/game-issues', handlers.submit);
  app.post('/api/admin/game-issues', handlers.admin);
};
module.exports.__test = { normalize, submit, list, update, createHandlers };
