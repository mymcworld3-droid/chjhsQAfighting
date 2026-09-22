'use strict';

const { adminProject, PROJECT_IDS } = require('./firebase-admin-projects.cjs');
const TOKEN_ROLES = Object.freeze(['BD', 'C']);

function createProjectTokenHandler({ resolve = role => adminProject(role) } = {}) {
  return async function projectTokenHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    const header = String(req.get?.('authorization') || '');
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
    if (!match) return res.status(401).json({ error: '請先登入主專案 A' });
    const roles = req.body?.roles;
    if (!Array.isArray(roles) || !roles.length || roles.length > TOKEN_ROLES.length ||
        new Set(roles).size !== roles.length || roles.some(role => !TOKEN_ROLES.includes(role))) {
      return res.status(400).json({ error: 'Firebase 專案代號無效' });
    }

    let a;
    const secondary = {};
    try {
      // Fail closed before verifying the user: all requested server credentials
      // must be present, and each Admin app must point to the expected project.
      a = resolve('A');
      for (const role of roles) secondary[role] = resolve(role);
    } catch (error) {
      console.error('[Firebase project tokens] server configuration unavailable:', error.message);
      return res.status(503).json({ error: '跨專案登入尚未啟用，請使用原有資料庫' });
    }

    let decoded;
    try {
      decoded = await a.auth.verifyIdToken(match[1], true);
    } catch (_) {
      return res.status(401).json({ error: '主專案登入已失效，請重新登入' });
    }
    if (!decoded?.uid || decoded.aud !== PROJECT_IDS.A || decoded.iss !== 'https://securetoken.google.com/' + PROJECT_IDS.A) {
      return res.status(401).json({ error: '主專案身分驗證失敗' });
    }

    // A token must never be reused as a token for BD/C. The service accounts
    // mint distinct custom tokens; the browser exchanges each with its own Auth.
    try {
      const tokens = {};
      for (const role of roles) {
        tokens[role] = await secondary[role].auth.createCustomToken(decoded.uid, {
          originProject: PROJECT_IDS.A
        });
      }
      return res.status(200).json({ uid: decoded.uid, tokens });
    } catch (error) {
      console.error('[Firebase project tokens] signing failed:', error.message);
      return res.status(503).json({ error: '跨專案登入暫時無法使用' });
    }
  };
}

module.exports = function registerFirebaseProjectAuthApi(app, options = {}) {
  app.post('/api/firebase-project-tokens', createProjectTokenHandler(options));
};
module.exports.createProjectTokenHandler = createProjectTokenHandler;
