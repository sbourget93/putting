/**
 * Lazy loader for the Google Identity Services script.
 *
 * The script is fetched from accounts.google.com, so it only works online — which
 * is fine, since signing in inherently requires connectivity. We load it on
 * demand (not in index.html) so an offline start never blocks on it; the rest of
 * the app, including a remembered session, works without it.
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client'

let loadPromise: Promise<GoogleAccountsId> | null = null

export function loadGis(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google.accounts.id)
  }
  if (loadPromise) return loadPromise

  loadPromise = new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id)
      } else {
        reject(new Error('Google Identity Services loaded but is unavailable'))
      }
    }
    script.onerror = () => {
      loadPromise = null // allow a retry on the next attempt (e.g. back online)
      reject(new Error('Failed to load Google Identity Services'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
