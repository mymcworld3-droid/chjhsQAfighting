'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

// The service worker trusts module-versions.json for every JS/CSS response.
// A stale hash silently serves an older cached asset even after a successful deploy.
test('Service Worker manifest matches every deployed public file', () => {
  const root = join(__dirname, '..');
  const result = spawnSync(process.execPath,
    [join(root, 'scripts', 'build-module-versions.cjs'), '--check'],
    { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0,
    ['module-versions.json is stale. Rebuild with npm run build:module-versions.',
      result.stdout, result.stderr].filter(Boolean).join('\n'));
});
