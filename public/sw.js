/* 青雲問道本機模組快取。
 * 每次導覽只向同源站台檢查 module-versions.json；版本相同直接使用 CacheStorage。
 * 版本不同只重新取得被修改的檔案，不攔截 Firebase、API 或其他使用者資料。
 */
'use strict';

const SCOPE = self.registration.scope;
const MANIFEST_URL = new URL('module-versions.json', SCOPE).href;
const STATIC_CACHE = 'xiuxian-static-versioned-v1';
const META_CACHE = 'xiuxian-static-meta-v1';
const KEY = '__xiuxian_asset_sha';
let currentManifest = null;
let manifestCheck = null;
const pendingAssets = new Map();

function relativePath(url) {
  const resource = new URL(url);
  const base = new URL(SCOPE);
  if (resource.origin !== base.origin || !resource.pathname.startsWith(base.pathname)) return null;
  try { return decodeURI(resource.pathname.slice(base.pathname.length)) || 'index.html'; }
  catch (_) { return null; }
}

function validManifest(raw) {
  return raw && raw.schema === 1 && raw.files && typeof raw.files === 'object' &&
    !Array.isArray(raw.files) && typeof raw.build === 'string' &&
    Object.keys(raw.files).every(path => typeof raw.files[path] === 'string' && /^[a-f0-9]{40}$/.test(raw.files[path]) &&
      !path.startsWith('/') && !path.split('/').includes('..'));
}

async function readStoredManifest() {
  const meta = await caches.open(META_CACHE);
  const saved = await meta.match(MANIFEST_URL);
  if (!saved) return null;
  try {
    const json = await saved.json();
    return validManifest(json) ? json : null;
  } catch (_) { return null; }
}

async function loadManifest(checkNetwork = false) {
  if (manifestCheck) return manifestCheck;
  if (!checkNetwork && currentManifest) return currentManifest;

  manifestCheck = (async () => {
    if (checkNetwork || !currentManifest) {
      try {
        // no-store 保證版本檢查不會被 HTTP 快取吃掉，亦不會動到 Firestore。
        const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (response.ok) {
          const candidate = await response.json();
          if (validManifest(candidate)) {
            const meta = await caches.open(META_CACHE);
            await meta.put(MANIFEST_URL, new Response(JSON.stringify(candidate), {
              headers: { 'Content-Type': 'application/json' }
            }));
            currentManifest = candidate;
          }
        }
      } catch (_) { /* 離線時保留最後已下載的版本 */ }
    }
    if (!currentManifest) currentManifest = await readStoredManifest();
    return currentManifest;
  })();

  try { return await manifestCheck; }
  finally { manifestCheck = null; }
}

function cacheKey(path, version) {
  const key = new URL(path, SCOPE);
  key.search = '';
  key.searchParams.set(KEY, version);
  return key.href;
}

async function serveStatic(request, path, manifest) {
  const version = manifest?.files?.[path];
  if (!version) return fetch(request);
  const storage = await caches.open(STATIC_CACHE);
  const key = cacheKey(path, version);
  const saved = await storage.match(key);
  if (saved) return saved;

  const pendingKey = path + ':' + version;
  if (!pendingAssets.has(pendingKey)) {
    const pending = (async () => {
      // 已知版本不同時，讀取原始同源 URL 並略過舊 HTTP 快取。
      const network = await fetch(new URL(path, SCOPE).href, { cache: 'no-store' });
      if (!network.ok || network.type === 'opaque') throw new Error('Static asset unavailable: ' + path);
      await storage.put(key, network.clone());
      return network;
    })();
    pendingAssets.set(pendingKey, pending);
    pending.finally(() => pendingAssets.delete(pendingKey)).catch(() => {});
  }
  try { return (await pendingAssets.get(pendingKey)).clone(); }
  catch (_) {
    // 更新中斷時，不把錯誤頁當成 JS/JSON 存入快取；舊版本保留供下次重試。
    return fetch(request);
  }
}

async function precacheModules() {
  const manifest = await loadManifest(false);
  if (!manifest) return;
  const modules = Object.keys(manifest.files).filter(path => /\.(?:js|css)$/.test(path));
  let cursor = 0;
  const runners = Array.from({ length: 3 }, async () => {
    while (cursor < modules.length) {
      const path = modules[cursor++];
      try { await serveStatic(new Request(new URL(path, SCOPE)), path, manifest); }
      catch (_) { /* 下次使用或下次預載會再嘗試 */ }
    }
  });
  await Promise.all(runners);
}

self.addEventListener('install', event => {
  // 不阻塞首次遊戲載入；主要模組會在遊戲腳本完成後低併發預先快取。
  event.waitUntil(loadManifest(true).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'XIUXIAN_PREFETCH_MODULES') event.waitUntil(precacheModules());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const path = relativePath(event.request.url);
  if (!path || path === 'module-versions.json' || path === 'sw.js') return;
  if (event.request.mode === 'navigate') {
    // 頁面導覽時只核對小型版本表，其後資源皆按各自 hash 命中本機。
    if (path !== 'index.html') return;
    event.respondWith((async () => {
      const manifest = await loadManifest(true);
      return serveStatic(event.request, 'index.html', manifest);
    })());
    return;
  }
  event.respondWith((async () => {
    const manifest = await loadManifest(false);
    if (!manifest?.files?.[path]) return fetch(event.request);
    return serveStatic(event.request, path, manifest);
  })());
});
