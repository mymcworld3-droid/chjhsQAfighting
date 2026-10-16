// Anonymous arrival is recorded before sign-in; retained players are tracked
// against verified Firebase UID. These events do not include questions or PII.
import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

(function () {
  'use strict';
  const EVENTS = new Set(['question_started', 'answer_completed', 'social_participated', 'question_load_failed', 'app_load_success', 'app_load_failed']);
  const MODES = new Set(['solo', 'raid', 'duel', 'meditation', 'other']);
  const once = new Set();
  let initialVisit = null;
  let authSubscribed = false;
  let tries = 0;
  let subscribedAuth = null;

  function key() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 16);
  }
  function user() {
    try { return getAuth(getApp()).currentUser; } catch (_) { return null; }
  }
  async function send(path, data, token = '') {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Analytics request failed: ' + response.status);
    return response.json();
  }
  function visit(token = '') {
    return send('/api/analytics/visit', {}, token).catch(() => null);
  }
  // Sequential requests guarantee the server-set HttpOnly anonymous cookie
  // survives the transition into Firebase anonymous or Google sign-in.
  initialVisit = visit();
  function installAuthObserver() {
    if (authSubscribed) return;
    try {
      const auth = getAuth(getApp());
      onAuthStateChanged(auth, async loggedIn => {
        if (!loggedIn) return;
        const uid = loggedIn.uid;
        await initialVisit;
        if (auth.currentUser?.uid !== uid) return;
        try {
          const token = await loggedIn.getIdToken();
          if (auth.currentUser?.uid === uid) await visit(token);
        } catch (_) { /* Analytics never blocks login. */ }
      });
      authSubscribed = true;
      subscribedAuth = auth;
    } catch (_) {
      if (++tries < 35) setTimeout(installAuthObserver, 400);
    }
  }
  installAuthObserver();
  window.addEventListener('xiuxian:features-ready', () => {
    void window.trackPlayerAnalytics?.('app_load_success', { mode:'other' });
  });
  window.addEventListener('xiuxian:features-failed', () => {
    void window.trackPlayerAnalytics?.('app_load_failed', { mode:'other' });
  });

  window.newPlayerAnalyticsEventId = key;
  window.trackPlayerAnalytics = async function (type, options = {}) {
    if (!EVENTS.has(type)) return false;
    const mode = MODES.has(options.mode) ? options.mode : 'other';
    const id = String(options.eventId || key());
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) return false;
    const current = user();
    if (!current) return false;
    const dedup = current.uid + ':' + id;
    if (once.has(dedup)) return true;
    once.add(dedup);
    try {
      await initialVisit;
      const token = await current.getIdToken();
      if (user()?.uid !== current.uid) return false;
      await send('/api/analytics/event', { type, mode, eventId: id }, token);
      return true;
    } catch (_) {
      once.delete(dedup); // retry with the SAME event ID is safe on the backend.
      return false;
    }
  };
})();
