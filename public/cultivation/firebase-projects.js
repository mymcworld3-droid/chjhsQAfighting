import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithCustomToken, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
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

const secondaryLoginPromises = new Map();
const secondaryAuthQueues = new Map();
let mainAuthUnsubscribe = null;

function queueSecondaryAuthOperation(role, task) {
  const previous = secondaryAuthQueues.get(role) || Promise.resolve();
  const pending = previous.catch(() => {}).then(task);
  secondaryAuthQueues.set(role, pending);
  pending.finally(() => {
    if (secondaryAuthQueues.get(role) === pending) secondaryAuthQueues.delete(role);
  }).catch(() => {});
  return pending;
}

function watchMainAccount() {
  if (mainAuthUnsubscribe) return;
  mainAuthUnsubscribe = onAuthStateChanged(getAuth(getApp()), () => {
    // Never call signOut while the same secondary Auth instance is signing in.
    // Re-check the latest A UID inside the serialized operation because this
    // callback may have been queued before a new BD/C login completed.
    for (const role of ['BD', 'C']) {
      const app = getApps().find(item => item.name === APP_NAMES[role]);
      if (!app) continue;
      void queueSecondaryAuthOperation(role, async () => {
        const latestMainUid = getAuth(getApp()).currentUser?.uid || '';
        const secondaryAuth = getAuth(app);
        const secondaryUid = secondaryAuth.currentUser?.uid || '';
        if (secondaryUid && secondaryUid !== latestMainUid) {
          await signOut(secondaryAuth);
        }
      }).catch((error) => {
        console.warn('[Firebase secondary auth cleanup]', role, error?.message || error);
      });
    }
  });
}

/**
 * Authenticate the same A user into exactly one secondary project.
 * A's ID token goes only to our backend, where its audience, issuer, expiry
 * and revocation are verified before the server creates a short-lived custom
 * token signed for the requested secondary project.
 */
export async function ensureSecondaryFirebaseAuth(role) {
  if (role !== 'BD' && role !== 'C') throw new Error('只接受 BD 或 C 身分連線');
  const mainAuth = getAuth(getApp());
  const mainUser = mainAuth.currentUser;
  if (!mainUser) throw new Error('主專案尚未登入');

  const mainUid = mainUser.uid;
  const services = getFirebaseProjectServices(role);
  watchMainAccount();
  const key = role + ':' + mainUid;
  if (secondaryLoginPromises.has(key)) return secondaryLoginPromises.get(key);

  const pending = (async () => {
    // If a cleanup operation was already queued, let it settle before trusting
    // currentUser. This prevents a stale signOut from firing after a fast return.
    const queued = secondaryAuthQueues.get(role);
    if (queued) await queued.catch(() => {});
    if (mainAuth.currentUser?.uid !== mainUid) throw new Error('玩家已切換帳號');
    if (services.auth.currentUser?.uid === mainUid) return services;

    const idToken = await mainUser.getIdToken();
    const response = await fetch('/api/firebase-project-tokens', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ roles: [role] })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.uid !== mainUid || typeof payload.tokens?.[role] !== 'string') {
      throw new Error(payload.error || '跨專案身分交換尚未準備完成');
    }

    return queueSecondaryAuthOperation(role, async () => {
      if (mainAuth.currentUser?.uid !== mainUid) throw new Error('玩家已切換帳號');

      const currentSecondaryUid = services.auth.currentUser?.uid || '';
      if (currentSecondaryUid === mainUid) return services;
      if (currentSecondaryUid) await signOut(services.auth);

      const credential = await signInWithCustomToken(services.auth, payload.tokens[role]);
      if (mainAuth.currentUser?.uid !== mainUid || credential.user.uid !== mainUid) {
        if (services.auth.currentUser) await signOut(services.auth).catch(() => {});
        throw new Error('跨專案玩家身分不符');
      }
      return services;
    });
  })();

  secondaryLoginPromises.set(key, pending);
  try {
    return await pending;
  } finally {
    if (secondaryLoginPromises.get(key) === pending) secondaryLoginPromises.delete(key);
  }
}
