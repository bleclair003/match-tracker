// sw.js — lets the app open without signal (e.g. at a range) and keeps it current.
// Strategy: always try the network first, so updates show up right away; if the
// network fails or takes more than 4 seconds, use the last saved copy.
// It only handles this app's own files. Your match data lives in the browser's
// storage, not here.
//
// If you add a new file the app needs offline, add it to SHELL and bump VERSION.

const VERSION = 'v1';
const CACHE = `match-tracker-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/model.js',
  './js/store.js',
  './js/reminders.js',
  './js/stats.js',
  './js/sources.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('match-tracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(handle(req));
});

async function handle(req) {
  // 'no-cache' makes the browser check the server for a newer copy every time.
  const netReq = req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-cache' });

  const network = fetch(netReq).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy));
    }
    return res;
  });
  network.catch(() => {}); // handled below; avoids an "unhandled rejection" warning

  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), NETWORK_TIMEOUT_MS)),
    ]);
  } catch {
    const cached = (await caches.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await caches.match('./index.html') : undefined);
    return cached || network; // nothing saved: keep waiting for the network (or fail)
  }
}
