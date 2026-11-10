/*
 * Cache migration worker. Previous versions cached full pages, mapped
 * index.html to stage.html and saved JS/CSS under a stale manifest.
 * This replacement intentionally intercepts no requests and removes
 * only caches created by the old xiuxian worker.
 */
'use strict';
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('xiuxian-'))
      .map(name => caches.delete(name)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
