const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const publicDir = join(__dirname, '../public');

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function cleanSpecifier(specifier) {
  return specifier.split(/[?#]/, 1)[0];
}

test('all relative browser module imports resolve to existing files', () => {
  const jsFiles = walk(publicDir).filter(file => file.endsWith('.js'));
  const failures = [];

  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    const specs = new Set();
    const staticImport = /(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g;
    const literalDynamicImport = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

    for (const regex of [staticImport, literalDynamicImport]) {
      let match;
      while ((match = regex.exec(source))) specs.add(match[1]);
    }

    for (const spec of specs) {
      const target = resolve(dirname(file), cleanSpecifier(spec));
      if (!existsSync(target)) failures.push(`${file.replace(publicDir, 'public')} -> ${spec}`);
    }
  }

  assert.deepEqual(failures, [], `Broken browser module imports:\n${failures.join('\n')}`);
});

test('main optional cultivation module registry only points to existing files', () => {
  const source = readFileSync(join(publicDir, 'main.js'), 'utf8');
  const registry = source.match(/const XIUXIAN_FEATURE_MODULES = \[([\s\S]*?)\];/);
  assert.ok(registry, 'XIUXIAN_FEATURE_MODULES registry exists');

  const paths = [...registry[1].matchAll(/['"](\.\/[^'"]+\.js)['"]/g)].map(match => match[1]);
  assert.ok(paths.length > 0, 'optional module registry is not empty');
  for (const spec of paths) {
    assert.ok(existsSync(resolve(publicDir, cleanSpecifier(spec))), `missing optional module ${spec}`);
  }
});

test('login bootstrap dependencies exist before Google login can be clicked', () => {
  const index = readFileSync(join(publicDir, 'index.html'), 'utf8');
  const main = readFileSync(join(publicDir, 'main.js'), 'utf8');
  const legacy = readFileSync(join(publicDir, 'main-legacy.js'), 'utf8');

  assert.match(index, /onclick="googleLogin\(\)"/);
  assert.match(index, /<script type="module" src="main\.js(?:\?[^\"]+)?"><\/script>/);
  assert.match(main, /^import '\.\/main-legacy\.js(?:\?v=[^']+)?';/m);
  assert.match(legacy, /window\.googleLogin\s*=\s*\(\)\s*=>/);
  assert.ok(existsSync(join(publicDir, 'cultivation-rules.js')), 'legacy cultivation rules compatibility module exists');
});
