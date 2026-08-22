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
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed SW registration must never break the app — it just means no
      // offline shell this load.
    })
  })
}
