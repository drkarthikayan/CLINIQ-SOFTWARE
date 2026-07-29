// CLINIQ app-shell service worker.
//
// Firestore's IndexedDB cache keeps the DATA available offline; this keeps the
// APP itself openable offline. Deliberately small and hand-written so the
// caching rules are auditable.
//
// Rules:
//   • Never touch anything cross-origin — Firestore/Auth traffic must reach the
//     network (or fail) on its own terms, never through a cache.
//   • Navigations are network-first so a deploy is picked up immediately, with
//     the cached shell as the offline fallback.
//   • /assets/* are content-hashed by Vite and therefore immutable → cache-first.
const CACHE = 'cliniq-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // Firestore, Auth, fonts

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/index.html', res.clone())); return res })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()))
        return res
      })),
    )
    return
  }

  e.respondWith(
    fetch(req)
      .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res })
      .catch(() => caches.match(req)),
  )
})
