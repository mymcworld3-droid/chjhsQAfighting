import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseProjectConfigs } from '../firebase-projects-config.js';

const APP_NAMES = Object.freeze({ BD: 'xiuxian-bd', C: 'xiuxian-battle' });
const REQUIRED_WEB_FIELDS = Object.freeze(['apiKey', 'authDomain', 'projectId', 'appId']);

export function firebaseProjectStatus() {
  const mainId = getApps().find(app => app.name === '[DEFAULT]')?.options?.projectId || '';
  const bdId = String(firebaseProjectConfigs.BD?.projectId || '').trim();
  const cId = String(firebaseProjectConfigs.C?.projectId || '').trim();
  return {
    A: { configured: Boolean(mainId), projectId: mainId },
    BD: { configured: hasWebConfig('BD') && bdId !== mainId && bdId !== cId, projectId: bdId },
    C: { configured: hasWebConfig('C') && cId !== mainId && cId !== bdId, projectId: cId },
  };
}

function hasWebConfig(role) {
  const config = firebaseProjectConfigs[role];
  return !!config && REQUIRED_WEB_FIELDS.every(key => {
    const value = String(config[key] || '').trim();
    return value.length > 0 && !/^(YOUR_|YOUR-|請填|PLACEHOLDER)/i.test(value);
  });
}

/**
 * Prepare a named Firebase App for A / BD / C without altering the existing default App.
 * This does NOT migrate Firestore data or sign the A user in to BD/C.
 * Never route privileged reads/writes to BD or C until token exchange, security rules,
 * and data migration have been completed.
 */
export function getFirebaseProjectServices(role) {
  if (role === 'A') {
    const app = getApp();
    return { role, app, auth: getAuth(app), db: getFirestore(app) };
  }
  if (!Object.hasOwn(APP_NAMES, role)) throw new Error('未知的 Firebase 專案代號');
  if (!hasWebConfig(role)) {
    throw new Error('Firebase ' + role + ' 尚未設定：請填 public/firebase-projects-config.js');
  }

  const config = firebaseProjectConfigs[role];
  const mainProjectId = getApp().options.projectId;
  const otherRole = role === 'BD' ? 'C' : 'BD';
  if (config.projectId === mainProjectId || (hasWebConfig(otherRole) && config.projectId === firebaseProjectConfigs[otherRole].projectId)) {
    throw new Error('Firebase A、BD、C 必須使用三個不同的 projectId');
  }

  const name = APP_NAMES[role];
  const already = getApps().find(app => app.name === name);
  if (already && already.options.projectId !== config.projectId) {
    throw new Error('Firebase ' + role + ' 專案設定已更動，請重新載入頁面');
  }
  const app = already || initializeApp(config, name);
  return { role, app, auth: getAuth(app), db: getFirestore(app) };
}
