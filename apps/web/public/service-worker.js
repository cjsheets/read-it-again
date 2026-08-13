const CACHE = 'read-it-again-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(precacheApplication());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

async function precacheApplication() {
  const cache = await caches.open(CACHE);
  const pending = [...SHELL];
  const visited = new Set();
  while (pending.length > 0) {
    const path = pending.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not precache ${path}`);
    await cache.put(path, response.clone());
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text|javascript|json/u.test(contentType)) continue;
    const text = await response.text();
    for (const match of text.matchAll(
      /["'`](\/(?:assets\/[^"'`\s)]+|[^"'`\s)]+\.(?:js|css|wasm)))["'`]/gu,
    )) {
      if (match[1]) pending.push(match[1]);
    }
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((response) => response ?? caches.match('/'))),
  );
});
