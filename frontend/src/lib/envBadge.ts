/**
 * envBadge — brand non-production tabs so a QA window is never mistaken for prod.
 *
 * The same frontend bundle is built for every environment (the EC2 box clones and
 * builds the same repo), so there is no build-time env flag to key off. Instead we
 * read the environment from the hostname: prod is `putting.stephengb.com`, and any
 * other environment is `putting-<env>.stephengb.com` (e.g. `putting-qa`). When an
 * env label is present we stamp it — big and red — over the favicon and prefix the
 * tab title, so the browser tab and any bookmark are obviously not production.
 *
 * Only the tab favicon can be rebranded at runtime; the installed PWA icon is
 * fixed by the static manifest at install time and is intentionally left alone.
 */

/** Non-prod environment label from the hostname, or null on prod / local dev. */
export const ENV_LABEL: string | null = (() => {
  const match = window.location.hostname.match(/^putting-([a-z0-9]+)\./i)
  return match ? match[1].toUpperCase() : null
})()

export function applyEnvBadge(): void {
  if (!ENV_LABEL) return
  document.title = `[${ENV_LABEL}] ${document.title}`
  brandFavicon(ENV_LABEL)
}

function brandFavicon(label: string): void {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  const src = existing?.href || '/favicon.png'

  const img = new Image()
  img.onload = () => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(img, 0, 0, size, size)

    // Scale the label to fill ~90% of the icon width, whatever its length.
    ctx.font = 'bold 100px sans-serif'
    const scale = (size * 0.9) / ctx.measureText(label).width
    ctx.font = `bold ${100 * scale}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // White outline first so the red reads against any icon color.
    ctx.lineWidth = size * 0.08
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText(label, size / 2, size / 2)
    ctx.fillStyle = '#e01010'
    ctx.fillText(label, size / 2, size / 2)

    const link = existing ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    link.type = 'image/png'
    link.href = canvas.toDataURL('image/png')
  }
  img.src = src
}
