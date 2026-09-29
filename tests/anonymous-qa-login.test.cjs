const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const index = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
const legacy = readFileSync(join(__dirname, '../public/main-legacy.js'), 'utf8');

test('anonymous QA entry stays hidden in normal play and uses Firebase Auth', () => {
  assert.match(index, /id="btn-anonymous-login"[^>]+class="hidden /);
  assert.match(legacy, /new URLSearchParams\(location\.search\)\.get\('qa'\) === '1'/);
  assert.match(legacy, /signInAnonymously\(auth\)/);
  assert.match(legacy, /isAdmin: false/);
  assert.match(legacy, /email: user\.email \|\| ''/);
});
