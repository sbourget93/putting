import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The repo root holds config shared with the backend and infrastructure. It sits
// one level up on the host, but the dev container mounts it elsewhere and points
// APP_REPO_ROOT at it (see local/docker-compose.yml).
const frontendRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = process.env.APP_REPO_ROOT ?? resolve(frontendRoot, '..')

// A version unique to each build, stamped into the service worker so every deploy
// ships a byte-different worker. That is what makes the browser re-run the SW's
// install/activate — refreshing the cached shell and sweeping the old cache —
// instead of leaving an unchanged worker to cold-start the stale shell.
const SW_VERSION = Date.now().toString(36)
const SW_SOURCE = resolve(frontendRoot, 'sw.js')

const appConfigPath = resolve(repoRoot, 'app.config.json')
// Forking the template means deleting this marker, which also drops the
// template-only pages from the build.
const isTemplatePath = resolve(repoRoot, '.is_template')

// The dev server proxies /api to the backend so the browser stays same-origin
// and needs no CORS. This stands in for the gateway, which plays the same role
// in production and likewise strips the /api prefix before proxying — backend
// routes are defined without it. Inside docker compose the backend is reachable
// by service name; running `npm run dev` on the host, it's localhost.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

const VIRTUAL_ID = 'virtual:app-config'
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID

// Served at the origin root in dev and emitted into the build. Keep in sync with
// the SW's SHELL precache list (frontend/sw.js).
const MANIFEST_PATH = '/manifest.webmanifest'
// Should track --brand in src/index.css; the manifest can't read CSS variables.
const THEME_COLOR = '#0273c9'

function readAppConfig(): { name: string } {
  return JSON.parse(readFileSync(appConfigPath, 'utf-8')) as { name: string }
}

// The PWA manifest is generated from app.config.json so the installed app's name
// tracks the rest of the config. Icons are the 192/512 PNGs in public/ (see
// public/icon-*.png) for a polished home-screen install.
function buildManifest(): string {
  const { name } = readAppConfig()
  return JSON.stringify(
    {
      name,
      short_name: name,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: THEME_COLOR,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    null,
    2,
  )
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'app-config',
      // The config is exposed as a virtual module rather than via `define`:
      // Vite only applies `define` to client code in bundled builds, so a
      // `define` constant would be left unreplaced by the dev server.
      resolveId(id) {
        if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
      },
      load(id) {
        if (id !== RESOLVED_VIRTUAL_ID) return
        return [
          `export const APP_NAME = ${JSON.stringify(readAppConfig().name)}`,
          `export const IS_TEMPLATE = ${JSON.stringify(existsSync(isTemplatePath))}`,
        ].join('\n')
      },
      transformIndexHtml(html) {
        // Vite only substitutes %VAR% in index.html for VITE_-prefixed env vars,
        // so the app name is substituted here instead. The PWA head tags are
        // injected here too (rather than hard-coded in index.html) so the app
        // name and manifest link stay derived from app.config.json.
        const { name } = readAppConfig()
        return {
          html: html.replaceAll('%APP_NAME%', name),
          tags: [
            { tag: 'link', attrs: { rel: 'manifest', href: MANIFEST_PATH }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR }, injectTo: 'head' },
            { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: name }, injectTo: 'head' },
          ],
        }
      },
      configureServer(server) {
        // The manifest is generated, not a static file, so serve it in dev.
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== MANIFEST_PATH) return next()
          res.setHeader('Content-Type', 'application/manifest+json')
          res.end(buildManifest())
        })
        // Both files sit outside the project root, so they are neither watched
        // nor able to invalidate the virtual module on their own.
        server.watcher.add([appConfigPath, isTemplatePath])
        server.watcher.on('all', (_event, changedPath) => {
          if (changedPath === appConfigPath || changedPath === isTemplatePath) {
            void server.restart()
          }
        })
      },
      generateBundle() {
        // Emit the generated manifest into the build output next to index.html.
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.webmanifest',
          source: buildManifest(),
        })
        // Emit the service worker with this build's version stamped into CACHE, so
        // a deploy that only changes app assets still ships a changed worker and
        // triggers the SW update path. The source lives at the frontend root (not
        // public/) so it isn't also copied verbatim and this stamped copy wins.
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: readFileSync(SW_SOURCE, 'utf-8').replaceAll('__SW_VERSION__', SW_VERSION),
        })
      },
    },
  ],
})
