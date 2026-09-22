'use strict';

// Server-only. Never expose these values to public/ or client-side JavaScript.
const PROJECT_IDS = Object.freeze({
  A: 'question-learning',
  BD: 'xiuxian-dongtian-bd',
  C: 'xiuxian-battle'
});
const ENV_KEYS = Object.freeze({
  A: 'FIREBASE_A_SERVICE_ACCOUNT_JSON',
  BD: 'FIREBASE_BD_SERVICE_ACCOUNT_JSON',
  C: 'FIREBASE_C_SERVICE_ACCOUNT_JSON'
});
const APP_NAMES = Object.freeze({ A: 'xiuxian-admin-a', BD: 'xiuxian-admin-bd', C: 'xiuxian-admin-c' });

function parseServiceAccount(role, env = process.env) {
  if (!Object.hasOwn(PROJECT_IDS, role)) throw new Error('Unknown Firebase role');
  const encoded = String(env[ENV_KEYS[role]] || '').trim();
  if (!encoded) throw new Error('Missing server credential for Firebase ' + role + ' (' + ENV_KEYS[role] + ')');
  let account;
  try { account = JSON.parse(encoded); }
  catch (_) { throw new Error('Invalid service account JSON for Firebase ' + role); }
  if (!account || account.type !== 'service_account' || account.project_id !== PROJECT_IDS[role] ||
      typeof account.private_key !== 'string' || !account.private_key.includes('PRIVATE KEY') ||
      typeof account.client_email !== 'string') {
    throw new Error('Firebase ' + role + ' requires a service account for project ' + PROJECT_IDS[role]);
  }
  return account;
}

function adminProject(role, { env = process.env, admin = require('firebase-admin') } = {}) {
  const credentials = parseServiceAccount(role, env);
  const named = admin.apps.find(app => app?.name === APP_NAMES[role]);
  const app = named || admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: PROJECT_IDS[role]
  }, APP_NAMES[role]);
  if (app.options.projectId !== PROJECT_IDS[role]) throw new Error('Firebase ' + role + ' Admin app project mismatch');
  return { app, auth: app.auth(), db: app.firestore() };
}

module.exports = { PROJECT_IDS, ENV_KEYS, parseServiceAccount, adminProject };
