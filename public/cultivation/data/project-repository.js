import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirebaseProjectServices, ensureSecondaryFirebaseAuth } from '../firebase-projects.js';

export const DOMAIN_PROJECT_ROLES = Object.freeze({
  player: 'A',
  economy: 'A',
  market: 'A',
  settlement: 'A',
  dongtian: 'BD',
  battle: 'C',
  raid: 'C'
});

const VALID_ROLES = new Set(['A', 'BD', 'C']);

export function projectRoleFor(domain) {
  const role = DOMAIN_PROJECT_ROLES[String(domain || '')];
  if (!role) throw new Error('未知的資料領域：' + String(domain || ''));
  return role;
}

export function getMainUser() {
  try { return getAuth(getApp()).currentUser || null; }
  catch (_) { return null; }
}

export async function getProjectServices(role, { authenticateSecondary = true } = {}) {
  if (!VALID_ROLES.has(role)) throw new Error('未知的 Firebase 專案代號');
  if (role === 'A') return getFirebaseProjectServices('A');
  return authenticateSecondary ? ensureSecondaryFirebaseAuth(role) : getFirebaseProjectServices(role);
}

export async function getDomainServices(domain, options) {
  return getProjectServices(projectRoleFor(domain), options);
}

export async function authenticatedMainFetch(input, init = {}) {
  const user = getMainUser();
  if (!user) throw new Error('主專案尚未登入');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', 'Bearer ' + token);
  if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, cache: init.cache || 'no-store', headers });
}
