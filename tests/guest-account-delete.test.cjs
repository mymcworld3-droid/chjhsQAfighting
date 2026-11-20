'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../public/account-delete.js'), 'utf8');
const arrival = readFileSync(join(__dirname, '../public/cultivation/first-visit.js'), 'utf8');
const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');

function harness({ anonymous = true, linked = false, confirmations = [true, true], failDelete = false } = {}) {
  const calls = [];
  const user = { uid: 'u1', isAnonymous: anonymous,
    providerData: linked ? [{ providerId: 'google.com' }] : [] };
  const firebase = { currentUser: user };
  const pages = Array.from({ length: 2 }, () => ({
    classList: { add(name) { calls.push(['page-hide', name]); }, remove(name) { calls.push(['page-remove', name]); } }
  }));
  const controls = {
    'bottom-nav': { classList: { add(name) { calls.push(['nav-hide', name]); } } },
    'login-screen': { classList: { remove(name) { calls.push(['login-show', name]); } } }
  };
  const window = {
    openConfirm: async message => { calls.push(['confirm', message]); return confirmations.shift() ?? false; },
    alert: message => calls.push(['alert', message]),
    showToast: message => calls.push(['toast', message]),
    dispatchEvent: event => calls.push(['event', event.type]),
    handleFirstVisitAccountDeleted: () => { calls.push(['welcome']); },
    isUnboundGuestAccount: person => Boolean(person?.isAnonymous && !person.providerData?.length)
  };
  const ctx = vm.createContext({
    window, document: {
      readyState: 'loading', addEventListener() {},
      getElementById: id => controls[id] || null,
      querySelectorAll: selector => selector === '.page-section' ? pages : []
    },
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } },
    console: { warn() {}, error() {} },
    getApp: () => ({}), getAuth: () => firebase, getFirestore: () => ({}),
    GoogleAuthProvider: class {},
    reauthenticateWithPopup: async () => { calls.push(['reauth']); },
    collection: (_, name) => ({ name }),
    query: (...parts) => parts,
    where: (...parts) => parts,
    getDocs: async () => ({ docs: [] }),
    doc: (_, name, uid) => ({ name, uid }),
    deleteDoc: async () => calls.push(['delete-doc']),
    writeBatch: () => ({ delete() {}, async commit() {} }),
    deleteUser: async () => {
      calls.push(['delete-auth']);
      if (failDelete) throw Object.assign(new Error('delete blocked'), { code: 'auth/requires-recent-login' });
      firebase.currentUser = null;
    },
    localStorage: { clear: () => calls.push(['clear-local']) },
    sessionStorage: { clear: () => calls.push(['clear-session']) },
    MutationObserver: class {},
  });
  vm.runInContext(source.slice(source.indexOf('(function () {')), ctx);
  return { calls, ctx, user };
}

test('unbound anonymous account requires only a single warning and no Google popup', async () => {
  const h = harness();
  await h.ctx.window.deleteAccountPermanently();
  assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 1);
  assert.match(h.calls[0][1], /未綁定/);
  assert.ok(!h.calls.some(c => c[0] === 'reauth'));
  assert.ok(h.calls.some(c => c[0] === 'delete-auth'));
  assert.ok(h.calls.some(c => c[0] === 'welcome'));
  assert.ok(h.calls.some(c => c[0] === 'login-show'));
  assert.ok(h.calls.some(c => c[0] === 'nav-hide'));
  assert.equal(h.calls.filter(c => c[0] === 'page-hide').length, 2);
  assert.ok(h.calls.some(c => c[0] === 'toast'));
  assert.ok(!h.calls.some(c => c[0] === 'alert'));
});

test('linked identity retains two confirmations and fresh Google reauthentication', async () => {
  for (const anonymous of [false, true]) {
    const h = harness({ anonymous, linked: true });
    await h.ctx.window.deleteAccountPermanently();
    assert.equal(h.calls.filter(c => c[0] === 'confirm').length, 2);
    assert.ok(h.calls.findIndex(c => c[0] === 'reauth') < h.calls.findIndex(c => c[0] === 'delete-doc'));
    assert.ok(h.calls.some(c => c[0] === 'alert' && c[1].includes('帳號已永久刪除')));
  }
});

test('cancelled guest deletion performs no mutations or navigation', async () => {
  const h = harness({ confirmations: [false] });
  await h.ctx.window.deleteAccountPermanently();
  for (const action of ['reauth', 'delete-doc', 'delete-auth', 'welcome']) {
    assert.ok(!h.calls.some(c => c[0] === action), action);
  }
});

test('failed anonymous deletion never claims success or shows signed-out welcome', async () => {
  const h = harness({ failDelete: true });
  await h.ctx.window.deleteAccountPermanently();
  assert.ok(h.calls.some(c => c[0] === 'alert' && c[1].includes('驗證已過期')));
  assert.ok(!h.calls.some(c => c[0] === 'welcome'));
  assert.ok(!h.calls.some(c => c[0] === 'toast'));
});

test('deletion explicitly resets the prior completed-arrival state and offers both sign-in choices', () => {
  assert.match(arrival, /window\.handleFirstVisitAccountDeleted = \(\) => \{/);
  assert.match(arrival, /store\(\{ stage: 'welcome', completed: false, joining: false, guestUid: '' \}\)/);
  assert.match(arrival, /welcome\(\);\s*return true;/);
  assert.match(arrival, /免註冊，開始答題/);
  assert.match(arrival, /<span>綁定帳號<\/span>/);
  assert.match(arrival, /使用 Google 綁定帳號或登入/);
  assert.match(legacy, /window\.isUnboundGuestAccount = user => Boolean/);
  assert.match(legacy, /linkedGoogleIdentity\?\.uid !== user\.uid/);
});
