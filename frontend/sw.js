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
 *                    fallback in production). The fallback fires not only when the
 *                    network throws (offline) but also when the server answers with
 *                    an error (a reachable proxy whose backend is down, e.g. a 502)
 *                    or stalls past NAV_TIMEOUT_MS — in every "server down" shape
 *                    the SPA still boots from cache instead of showing an error
 *                    page or hanging. React Router then owns client-side routing.
 *  - other GET     -> stale-while-revalidate: serve cache immediately, refresh
 *                    it in the background. Fingerprinted assets are immutable, so
 *                    this is safe and fast.
 *
 * CACHE carries a per-build version stamped in by the vite `app-config` plugin
 * (the __SW_VERSION__ placeholder). Every deploy therefore ships a byte-different
 * worker, so the browser runs install/activate again: precacheShell refreshes the
 * cached shell to the new build and activate sweeps the previous version's cache.
 * Without that stamp an asset-only deploy left the worker unchanged, so a PWA
 * could cold-start the old shell until a manual refresh. Paired with the
 * reload-on-update in src/registerSW.ts, a stale cold start now heals itself.
 */
const CACHE = 'app-shell-__SW_VERSION__'
// Bound a navigation fetch so a reachable-but-stalled server falls back to the
// cached shell quickly instead of leaving the page hanging on a blank load.
const NAV_TIMEOUT_MS = 10000
const SHELL = ['/', '/index.html', '/favicon.png', '/apple-touch-icon.png', '/manifest.webmanifest']

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
      fetch(request, { signal: AbortSignal.timeout(NAV_TIMEOUT_MS) })
        .then((response) => {
          // A reachable-but-broken server (proxy up, backend erroring) answers with
          // an error page. Treat that like being offline: serve the cached shell so
          // the SPA still boots, rather than handing the user the raw error page.
          if (!response.ok) {
            return caches.match('/index.html').then((r) => r || response)
          }
          // Keep the offline shell current: cache each successful navigation as
          // the fallback so a fresh deploy becomes the cold-start shell.
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
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
