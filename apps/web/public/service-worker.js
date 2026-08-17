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

/**
 * Quoted references to another build artefact, in the two shapes the bundler
 * emits: an absolute `/assets/…` URL, and a relative `./chunk-hash.js` specifier
 * from a dynamic `import()`.
 *
 * The relative half is not decoration. A code-split chunk — the barcode decoder
 * is the first — is only ever named relatively, so matching absolute paths alone
 * precached the decoder's 1 MB wasm and silently left its loader behind. That
 * fails exactly where offline support is supposed to hold.
 *
 * A leading `./` or `../` is required rather than optional, because emscripten
 * glue contains bare strings like `zxing_reader.wasm` that are arguments to a
 * path resolver, not fetchable URLs. Precaching is strict — a miss fails the
 * install rather than shipping a half-cached shell — so a pattern loose enough to
 * catch those would take the whole service worker down with it.
 */
const REFERENCE =
  /["'`](\.{1,2}\/[^"'`\s)]+\.(?:js|css|wasm)|\/(?:assets\/[^"'`\s)]+|[^"'`\s)]+\.(?:js|css|wasm)))["'`]/gu;

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
    for (const match of text.matchAll(REFERENCE)) {
      // Resolved against the file the reference was found in, so `./reader.js`
      // inside /assets/index.js means /assets/reader.js and not /reader.js.
      if (match[1]) pending.push(new URL(match[1], new URL(path, self.location.href)).pathname);
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
