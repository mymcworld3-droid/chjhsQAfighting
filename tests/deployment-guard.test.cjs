'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('../deployment-guard.cjs');
const ROOT = path.join(__dirname, '..');

test('HTML entry routes and update control cannot use stale browser cache', () => {
  for (const route of ['/', '/index.html', '/app.html', '/stage.html',
    '/sw.js', '/module-versions.json', '/api/deploy-info']) {
    assert.match(guard.cachePolicy(route), /no-store/);
  }
  for (const asset of ['/main.js', '/main.js?v=old', '/simple-quiz.css',
    '/assets/scene.webp', '/middle_school_unit_name/數學/math.json']) {
    assert.match(guard.cachePolicy(asset), /no-cache/);
  }
  assert.equal(guard.cachePolicy('/api/generate-quiz'), null);
});

test('each HTML entry receives one deploy guard script', () => {
  const source = '<html><head><title>T</title></head><body></body></html>';
  const injected = guard.injectGuard(source);
  assert.equal((injected.match(/src="\/deploy-guard\.js"/g) || []).length, 1);
  assert.equal(guard.injectGuard(injected), injected);
  for (const name of ['index.html', 'stage.html']) {
    const send = guard.sendPage(name);
    const headers = {};
    let payload = '';
    send({}, {
      set(key, value) { headers[key] = value; return this; },
      type(type) { assert.equal(type, 'html'); return this; },
      send(html) { payload = html; return this; }
    });
    assert.match(headers['Cache-Control'], /no-store/);
    assert.match(payload, /src="\/deploy-guard\.js"/);
  }
});

test('branch and exact git commit are exposed by deployment identity', () => {
  const commit = 'a'.repeat(40);
  const info = guard.identity({RENDER_GIT_BRANCH:'main',
    RENDER_GIT_COMMIT:commit,EXPECTED_GIT_BRANCH:'main'});
  assert.equal(info.branch, 'main');
  assert.equal(info.commit, commit);
  assert.equal(info.revision, commit);
  assert.equal(info.branchMatchesExpected, true);
  assert.equal(guard.identity({RENDER_GIT_BRANCH:'wrong',
    RENDER_GIT_COMMIT:commit,EXPECTED_GIT_BRANCH:'main'}).branchMatchesExpected, false);
});

test('every branch wires the guard before the game route and retires stale worker', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const stage = fs.readFileSync(path.join(ROOT, 'game-stage.cjs'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const packageJson = require(path.join(ROOT, 'package.json'));
  assert.ok(server.includes("require('./deployment-guard.cjs')"));
  const first = server.indexOf('registerDeploymentGuard(app);');
  const second = server.indexOf('registerGameStage(app);');
  assert.ok(first >= 0 && second > first, 'cache middleware must precede homepage/static routes');
  assert.match(stage, /sendPage\('index.html'\)/);
  assert.match(sw, /self\.registration\.unregister\(\)/);
  assert.doesNotMatch(sw, /addEventListener\('fetch'/);
  for (const key of ['postinstall', 'prestart', 'predev']) {
    assert.equal(packageJson.scripts[key], 'node scripts/build-module-versions.cjs');
  }
});
