const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join, relative, extname } = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');

const root = join(__dirname, '..', 'public');
const read = path => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('module-versions.json'));
const worker = read('sw.js');
const index = read('index.html');
const main = read('main.js');

test('every local static resource has an up-to-date independent version', () => {
  const extensions = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
  const found = {};
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile() || (extname(absolute) && !extensions.has(extname(absolute).toLowerCase()))) continue;
      const name = relative(root, absolute).split('\\').join('/');
      if (name === 'sw.js' || name === 'module-versions.json') continue;
      const content = readFileSync(absolute);
      found[name] = createHash('sha1').update(Buffer.from('blob ' + content.length + '\0')).update(content).digest('hex');
    }
  };
  walk(root);
  assert.equal(manifest.schema, 1);
  assert.deepEqual(manifest.files, found, 'Run npm run build:module-versions after editing a local asset');
  assert.equal(manifest.build, found['index.html']);
  assert.ok(Object.keys(found).length >= 150);
});

test('service worker is installed early but preloads only code after all features are ready', () => {
  assert.match(index, /navigator\.serviceWorker\.register\('\.\/sw\.js'/);
  assert.match(index, /xiuxian:features-ready', prefetch/);
  assert.match(index, /XIUXIAN_PREFETCH_MODULES/);
  assert.match(main, /XIUXIAN_FEATURE_BUILD = '20260922-core-layout2'/);
  assert.match(worker, /filter\(path => \/\\\.\(\?:js\|css\)\$\/\.test\(path\)\)/);
  assert.doesNotMatch(worker, /firestore\.googleapis\.com|runTransaction|users\/\$\{/);
});

function mockWorker() {
  const events = new Map();
  const cacheStores = new Map();
  const networkCalls = [];
  const scope = 'https://example.github.io/chjhsQAfighting/';
  const versions = {
    schema: 1, build: 'f'.repeat(40),
    files: { 'index.html': 'a'.repeat(40), 'main.js': 'b'.repeat(40), 'style.css': 'c'.repeat(40), 'assets/portrait.png': 'd'.repeat(40) }
  };
  let offline = false;
  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const store = cacheStores.get(name);
      return {
        async match(key) { return store.get(String(key))?.clone() || undefined; },
        async put(key, response) { store.set(String(key), response.clone()); }
      };
    }
  };
  async function fetch(request, options = {}) {
    if (offline) throw new Error('offline');
    const uri = new URL(typeof request === 'string' ? request : request.url);
    networkCalls.push({ path: uri.pathname.slice(new URL(scope).pathname.length), options });
    if (uri.pathname.endsWith('/module-versions.json')) return new Response(JSON.stringify(versions), { status:200 });
    return new Response('file:' + uri.pathname.slice(new URL(scope).pathname.length), { status:200 });
  }
  const self = {
    registration: { scope },
    addEventListener(type, callback) { events.set(type, callback); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  vm.runInNewContext(worker, { self, caches, fetch, URL, Request, Response, Map, console });
  async function resource(name, mode = 'cors') {
    const event = {
      request: { url: new URL(name, scope).href, method:'GET', mode },
      respondWith(p) { this.result = p; }
    };
    events.get('fetch')(event);
    assert.ok(event.result, 'versioned local asset should be intercepted');
    return (await event.result).text();
  }
  return { events, scope, versions, networkCalls, resource, setOffline(v) { offline = v; } };
}

test('cached version is reused without another asset download, even with a changed query string', async () => {
  const sw = mockWorker();
  assert.equal(await sw.resource('main.js?v=old'), 'file:main.js');
  assert.equal(await sw.resource('main.js?v=new'), 'file:main.js');
  assert.equal(sw.networkCalls.filter(x => x.path === 'main.js').length, 1);
  assert.equal(sw.networkCalls.filter(x => x.path === 'module-versions.json').length, 1);
});

test('navigation checks only the lightweight manifest and changed assets update independently', async () => {
  const sw = mockWorker();
  await sw.resource('main.js');
  await sw.resource('style.css');
  sw.versions.files['main.js'] = 'e'.repeat(40);
  assert.equal(await sw.resource('index.html', 'navigate'), 'file:index.html');
  await sw.resource('style.css');
  await sw.resource('main.js');
  assert.equal(sw.networkCalls.filter(x => x.path === 'style.css').length, 1);
  assert.equal(sw.networkCalls.filter(x => x.path === 'main.js').length, 2);
  assert.equal(sw.networkCalls.filter(x => x.path === 'module-versions.json').length, 2);
});

test('offline navigation uses the previous manifest and local code', async () => {
  const sw = mockWorker();
  await sw.resource('index.html', 'navigate');
  await sw.resource('main.js');
  sw.setOffline(true);
  assert.equal(await sw.resource('index.html', 'navigate'), 'file:index.html');
  assert.equal(await sw.resource('main.js'), 'file:main.js');
});

test('non-versioned URLs and remote Firebase requests are never put in the module cache', () => {
  const sw = mockWorker();
  for (const name of [sw.scope + 'api/quiz', 'https://firestore.googleapis.com/v1/projects/question-learning/']) {
    const event = { request: { url: name, method:'GET', mode:'cors' }, respondWith(p) { this.result = p; } };
    sw.events.get('fetch')(event);
    if (name.includes('firestore.googleapis.com')) assert.equal(event.result, undefined);
  }
});
