'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join, relative, extname } = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');

const root = join(__dirname, '..', 'public');
const read = file => readFileSync(join(root, file), 'utf8');
const manifest = JSON.parse(read('module-versions.json'));
const worker = read('sw.js');
const index = read('index.html');

test('every local static resource has an up-to-date independent version', () => {
  const extensions = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg',
    '.jpeg', '.webp', '.gif', '.svg', '.mp3']);
  const found = {};
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes:true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile() ||
          (extname(absolute) && !extensions.has(extname(absolute).toLowerCase()))) continue;
      const name = relative(root, absolute).split('\\').join('/');
      if (name === 'sw.js' || name === 'module-versions.json') continue;
      const content = readFileSync(absolute);
      found[name] = createHash('sha1').update(Buffer.from('blob ' + content.length + '\0'))
        .update(content).digest('hex');
    }
  };
  walk(root);
  assert.equal(manifest.schema, 1);
  assert.deepEqual(manifest.files, found,
    'Run npm run build:module-versions after editing a local asset');
  assert.equal(manifest.build, found['index.html']);
  assert.ok(Object.keys(found).length >= 150);
});

test('legacy registration is removed from every game homepage', () => {
  assert.doesNotMatch(index, /navigator\.serviceWorker\.register\(['"]\.\/sw\.js/);
  assert.match(worker, /self\.registration\.unregister\(\)/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
});

test('new Service Worker never intercepts any HTTP resources', () => {
  const handlers = new Map();
  const context = {
    self:{
      registration:{unregister: async()=>true},
      skipWaiting: async()=>{},
      clients:{claim:async()=>{}},
      addEventListener:(type,handler)=>handlers.set(type,handler)
    },
    caches:{ keys:async()=>[], delete:async()=>true },
    Promise
  };
  vm.runInNewContext(worker, context);
  assert.equal(handlers.has('fetch'), false,
    'Workers must never serve stale HTML, JavaScript, images or API data');
  assert.equal(typeof handlers.get('install'), 'function');
  assert.equal(typeof handlers.get('activate'), 'function');
});

test('worker activation removes only obsolete xiuxian caches and unregisters', async () => {
  const handlers = new Map();
  const removed = [];
  let registrationRemoved = false;
  const context = {
    self:{
      registration:{unregister:async()=>{registrationRemoved=true;return true;}},
      skipWaiting:async()=>{},
      clients:{claim:async()=>{}},
      addEventListener:(type,handler)=>handlers.set(type,handler)
    },
    caches:{
      keys:async()=>['xiuxian-static-versioned-v1','xiuxian-stage-documents-v1',
        'xiuxian-item-images-v1','unrelated-cache'],
      delete:async(name)=>{removed.push(name);return true;}
    },
    Promise
  };
  vm.runInNewContext(worker, context);
  let pending;
  handlers.get('activate')({waitUntil(promise){pending=promise;}});
  await pending;
  assert.deepEqual(removed.sort(), [
    'xiuxian-item-images-v1','xiuxian-stage-documents-v1','xiuxian-static-versioned-v1'
  ]);
  assert.equal(registrationRemoved,true);
});
