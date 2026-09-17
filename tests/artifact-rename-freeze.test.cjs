const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cultivation', 'artifact-system.js'), 'utf8');

test('artifact question tools avoid MutationObserver innerHTML feedback loops after rename', () => {
  assert.match(source, /const renderKey = JSON\.stringify\(/);
  assert.match(source, /if \(bar\.dataset\.artifactRenderKey === renderKey\) return;/);
  assert.match(source, /bar\.dataset\.artifactRenderKey = renderKey;\s*bar\.innerHTML =/s);
});

test('empty artifact availability removes stale question toolbar', () => {
  assert.match(source, /if \(!available\.length\) \{[\s\S]*?artifact-question-tools[\s\S]*?\.remove\(\);[\s\S]*?return;/);
});
