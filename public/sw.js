/* Simple quiz has no offline app shell. Drop the legacy xiuxian Service Worker caches
 * to prevent previously-installed workers from showing old branch pages.
 */
'use strict';
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter(name => name.startsWith('xiuxian-')).map(name => caches.delete(name)));
    await self.clients.claim();
    // The simple-quiz app does not register a replacement worker.
    await self.registration.unregister();
  })());
});
