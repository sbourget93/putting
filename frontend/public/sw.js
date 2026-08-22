/**
 * App shell service worker — makes the PWA installable and cold-start capable
 * offline. Hand-rolled (no Workbox) because the strategy is small and the app's
 * real offline data lives in IndexedDB, not in cached HTTP responses.
 *
 * Registered in production only (see src/registerSW.ts). Vite fingerprints built
 * assets, so their names aren't known ahead of time — this worker discovers them
 * at install time by reading the shell HTML, then caches them.
 *
 * Strategy, same-origin GET only:
 *  - /api/*        -> network only, never cached. The offline data layer is the
 *                    store's IndexedDB; caching API responses would serve stale
 *                    data and fight it. Offline, these simply fail and the app
 *                    copes.
 *  - navigations   -> network first, falling back to the cached shell. Each
 *                    successful navigation refreshes the cached shell so a new
 *                    deploy becomes the cold-start fallback. This is what lets a
 *                    deep link cold-start offline (paired with the nginx SPA
 *                    fallback in production).
 *  - other GET     -> stale-while-revalidate: serve cache immediately, refresh
 *                    it in the background. Fingerprinted assets are immutable, so
 *                    this is safe and fast.
 *
 * Bump CACHE to force a clean sweep of old entries on the next activate.
 */
const CACHE = 'app-shell-v2'
const SHELL = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest']

// The entry JS/CSS have fingerprinted names we can't hard-code. The first page
// load fetches them *before* this worker controls the page, so they'd never be
// cached and a cold offline start would fail to boot. Read the shell HTML at
// install and precache the /assets/* it references, closing that gap.
async function precacheShell() {
  const cache = await caches.open(CACHE)
  // Best-effort per entry so one missing/renamed asset can't abort the install
  // and leave the app with no offline shell at all.
  await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
  try {
    const res = await fetch('/index.html', { cache: 'reload' })
    if (res.ok) {
      const html = await res.text()
      const assets = new Set(html.match(/\/assets\/[^"')\s]+/g) ?? [])
      await Promise.all([...assets].map((url) => cache.add(url).catch(() => {})))
    }
  } catch {
    // Offline at install (unlikely — install follows a network load). The shell
    // precache above is best-effort and runtime caching fills in the rest.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only same-origin GETs are cacheable; everything else goes straight to network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Never cache the API — the store's IndexedDB is the source of offline truth.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the offline shell current: cache each successful navigation as
          // the fallback so a fresh deploy becomes the cold-start shell.
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone())
            return response
          })
          .catch(() => cached || Response.error())
        return cached || network
      }),
    ),
  )
})
