const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function browserModuleToSyntaxCheck(source) {
  return source
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/g, '');
}

test('dongtian browser module has valid JavaScript syntax', () => {
  const source = readFileSync(join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');
  const parseable = browserModuleToSyntaxCheck(source);
  assert.doesNotThrow(() => new Function(parseable));
});

test('dongtian featureReady closes the inner IIFE and outer async initializer cleanly', () => {
  const source = readFileSync(join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');
  assert.match(source, /else boot\(\);\s*\}\)\(\);\s*\}\)\(\);\s*$/);
  assert.doesNotMatch(source, /\}\s+\}\)\(\);\s*\}\)\(\);\s*$/);
});
