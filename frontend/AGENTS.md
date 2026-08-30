# Frontend Agent Guidelines

Despite instructions indicating that you shouldn;t edit any `.md` files, you own the frontend AGENTS.md file.
You may make changes as you see fit.
Try to match the cadence and verbosity of the backend AGENTS.md file.

A React + TypeScript single-page app built with Vite. Mobile-first, per the root [`AGENTS.md`](../AGENTS.md) design considerations.

## Stack
| Concern | Choice |
| --- | --- |
| UI | React 19 |
| Build/dev server | Vite 8 |
| Routing | `react-router-dom` 7 |
| Linting | oxlint (`npm run lint`) |
| Styling | Plain CSS, one file per component. No framework, no CSS-in-JS. |
| State | React state for UI; app data flows through the local-first sync engine (`src/offline/`, admin-only). |

## Layout
| Path | Holds |
| --- | --- |
| `src/main.tsx` | Root render + `<BrowserRouter>` |
| `src/App.tsx` | Route table |
| `src/components/` | Shared components, incl. `Layout` (app shell) |
| `src/pages/` | One component per route |
| `src/offline/` | Local-first sync engine: cached projections, write queue, dead-letter |
| `src/config.ts` | Repo-root config, re-exported from `virtual:app-config` |
| `src/index.css` | Global base styles and theme variables |
| `sw.js` | PWA service worker (app-shell cache); registered in prod by `src/registerSW.ts`. Lives at the frontend root, not `public/`, so the `app-config` plugin can stamp a per-build version into it and emit it as `/sw.js` (a changed worker every deploy triggers the SW update path). |
| `vite.config.ts` | Build config + the `app-config` plugin (also generates the PWA manifest and emits the version-stamped `sw.js`) |

## Decisions

### Config reaches the app through a virtual module, never `define`
`vite.config.ts` reads the repo-root [`app.config.json`](../app.config.json) and `.is_template`, then serves them as the virtual module `virtual:app-config`, which [`src/config.ts`](./src/config.ts) re-exports as `APP_NAME` and `IS_TEMPLATE`.

**Do not replace this with Vite's `define`.** Vite 8's `vite:define` skips client code in dev and only substitutes at bundle time, so a `define` constant builds fine but reaches the browser unreplaced — a `ReferenceError` that blanks the page in dev only.

Import shared values from `../config`, never by reading the JSON directly. The same plugin also generates `/manifest.webmanifest` and injects the PWA `<head>` tags from `app.config.json`.

### Template-only code is guarded, not deleted
`IS_TEMPLATE` is true only while `.is_template` exists at the repo root. Guarding a route and its navigation link with it means a fork's bundle drops the code entirely, while the file stays on disk as a worked example. See [`src/pages/TemplateTestPage.tsx`](./src/pages/TemplateTestPage.tsx).

### Routing
`Layout` renders the top bar and drawer, and hosts the active page via `<Outlet />`. Adding a page means three edits: a component in `src/pages/`, a `<Route>` in `App.tsx`, and a `<NavLink>` in the drawer.

### Styling
- Brand color comes from `--brand` / `--brand-text` in `index.css`. Change those, not component files.
- Neutrals use CSS system colors (`Canvas`, `CanvasText`) so light and dark work without a maintained palette.
- Mobile rules: 44px minimum touch targets, `env(safe-area-inset-*)` padding on edge-anchored chrome, `100svh` over `100vh`, and honor `prefers-reduced-motion`.
- Google's sign-in button styling is fixed by their branding guidelines and is intentionally not theme-aware.

### Auth is real, and admin-gated
Google Identity Services signs the user in; the backend verifies the token once and keeps the identity in a signed session cookie, so a device stays signed in. `AuthProvider` (`auth.tsx`) exposes `useAuth()` with the current user and a live `isAdmin`, derived server-side from `ADMIN_EMAILS` and never trusted from the client. Every mutation control hides behind `isAdmin`; the backend re-gates writes regardless. See `auth.tsx`, `auth-context.ts`, `GoogleSignInButton.tsx`, `gis.ts`.

## Data layer (local-first)
Admin-only: the event log is admin-gated, so only admins run the engine; non-admins read the online query endpoints directly.

**Offline is scoped to Daily Putts, on purpose.** That page is the only one that must work offline, and we don't want to ship a growing dataset to every device. So the cached aggregates read only the compact, bounded `GET /daily` payload (today's test, today's batches, and the all-time by-distance `baseline`) via the shared `aggregates/daily.ts` (which dedupes their concurrent reads into one request). History / Leaderboard / Compare are online-only, fetched on demand, never cached — they can pull the full log because a person opens them deliberately, not on every visit.

- **Engine (`src/offline/`).** The server projection is the source of truth. The engine caches each aggregate's snapshot in IndexedDB (`db.ts`) and renders `snapshot folded through the pending write queue` (`SyncEngine.tsx`, `useAggregateRows`), so an admin's writes show instantly and reconcile on the next sync.
- **Adding an aggregate.** Add an `AggregateDescriptor` in `src/offline/aggregates/` — a `fetch` (its server query), a `reduce` mirroring the backend projection handler, a `describe` — then register it in `StoreProvider`'s list. Keep `reduce` in step with `backend/projections/<name>.py`. A read-only aggregate that no event changes (e.g. `baseline`, a server-computed view) takes an empty `eventTypes` and an identity `reduce`.
- **Writes.** `enqueue` (via `useSync`) appends to the queue; syncing is automatic (on write, on reconnect, on a retry timer). There is no manual sync and no periodic poll, so a second admin's changes surface only on reload or your next write — acceptable under last-write-wins.
- **Rejections.** A batch the server refuses (4xx) resets local state to the server and is parked in a dead-letter list, reviewed via the `SyncMenu` envelope (re-apply / dismiss).
- **IndexedDB** is a disposable cache; any change to its store layout must bump `DB_VERSION` in `db.ts` (the migration drops and recreates the stores).

## PWA
A web manifest (generated by the `app-config` plugin) and a service worker (`public/sw.js` — app-shell cache, never `/api`) make the app installable and offline-capable. The worker registers in production builds only (`src/registerSW.ts`), since it fights the dev HMR server — exercise it with `npm run build && npm run preview`.

## Local Development
- `npm run dev`, `npm run build`, `npm run lint` from this directory.
- The dev container is the usual path — see [`local/AGENTS.md`](../local/AGENTS.md).
- **After adding a dependency on the host, the container needs `docker compose down -v` and a rebuild.** The `frontend_node_modules` named volume shadows the image's, so a host-side `npm install` is otherwise invisible and surfaces as an unrelated "failed to resolve import".
- The Docker build context is this directory, so repo-root files are not visible by default. The root is bind-mounted read-only at `/repo`, with `APP_REPO_ROOT` pointing at it. Any new root-level file this app needs must go through that mount.
