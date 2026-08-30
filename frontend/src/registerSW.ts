/**
 * Service worker registration.
 *
 * Registered in production builds only. In dev the Vite HMR server and a caching
 * service worker fight each other (stale modules, missed updates), so the PWA
 * shell is a production concern; the IndexedDB data layer works in dev regardless.
 * To exercise the SW locally, run `npm run build && npm run preview`.
 *
 * The worker itself lives at public/sw.js so it's served from the origin root
 * with the widest possible scope. See that file for the caching strategy.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    // Whether an old worker already controls this page. A controllerchange only
    // means "a newer deploy just activated" when there was already a controller;
    // on the very first install the change is null -> first worker, not an update.
    const hadController = !!navigator.serviceWorker.controller
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      // A PWA can cold-start from the cached (stale) shell when the network isn't
      // ready at launch. Each deploy ships a byte-different worker (its CACHE
      // carries a build version), so the browser installs and activates it in the
      // background; reloading here once swaps the stale UI for the new build
      // instead of leaving the old nav on screen until a manual refresh.
      reloading = true
      window.location.reload()
    })
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Check for a newer worker on every load so a stale cold start updates
        // promptly rather than only on the browser's own periodic check.
        void registration.update()
      })
      .catch(() => {
        // A failed SW registration must never break the app — it just means no
        // offline shell this load.
      })
  })
}
