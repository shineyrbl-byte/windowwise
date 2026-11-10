// WindowWise service worker.
// - Shows reminders and opens the app when one is tapped.
// - Keeps the app working offline: pages load from the network first (so a
//   new version shows up right away) and fall back to the cache; built files
//   have unique names, so they are served from the cache once stored.
const CACHE = 'windowwise-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files; weather API calls go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  // Built files under /assets/ have a content hash in their name, so a cached
  // copy is always correct. Everything else (icons, manifest, dev files) goes
  // to the network first and only falls back to the cache when offline.
  const hashed = url.pathname.includes('/assets/');
  const fromNetwork = () =>
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
  event.respondWith(
    hashed
      ? caches.match(req).then((hit) => hit || fromNetwork())
      : fromNetwork().catch(() => caches.match(req)),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});
