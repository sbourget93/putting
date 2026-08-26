/**
 * StoreProvider — mounts the sync engine and registers the app's aggregates.
 *
 * The offline data layer is admin-only: only admins may read the full projection
 * data (private_value) and only admins may write. So the engine runs only when
 * the signed-in user is an admin (`enabled`); a non-admin gets an inert engine
 * that never fetches, syncs, or persists, and reads online instead (see
 * TemplateTestPage). Must sit inside AuthProvider, since it reads `isAdmin`.
 *
 * Register aggregates here, one descriptor per aggregate, mirroring the backend's
 * projection modules. The demo `foo` aggregate is intentionally not registered in
 * this app; its files remain as a worked example (see aggregates/foo.ts).
 */
import { useEffect, type ReactNode } from 'react'
import { useAuth } from '../auth-context'
import { SyncProvider } from './SyncEngine'
import { useSync } from './SyncContext'
import { newEvent } from './commands'
import { batchesDescriptor } from './aggregates/batches'
import { testsDescriptor } from './aggregates/tests'
import { baselineDescriptor } from './aggregates/baseline'
import { usersDescriptor, useUsers } from './aggregates/users'
import type { AggregateDescriptor } from './types'

// Scoped to what Daily Putts needs offline: today's test + batches (foldable
// writes) and the all-time by-distance baseline. History / Leaderboard / Compare
// read the server directly, on demand — they are not cached on the device.
const AGGREGATES: AggregateDescriptor<any>[] = [
  testsDescriptor,
  batchesDescriptor,
  baselineDescriptor,
  usersDescriptor,
]

/**
 * Records the signed-in admin's identity into the users projection.
 *
 * Enqueues a UserSignedIn (keyed by the stable Google `sub`) only when the
 * projection has no matching row yet, or the name/picture has changed — so it
 * fires once on first sign-in and again only when the Google profile actually
 * changes, never on every reload. Runs only for admins (the engine is inert
 * otherwise), which is the only who ever writes.
 */
function RecordIdentity() {
  const { user } = useAuth()
  const { enabled, enqueue, snapshots } = useSync()
  const users = useUsers()

  useEffect(() => {
    if (!enabled || !user?.sub) return
    // Wait until the server snapshot has loaded, so a returning admin whose
    // identity is already recorded doesn't record a duplicate on startup.
    if (!snapshots['users']) return
    const existing = users.find((u) => u.sub === user.sub)
    if (existing && existing.name === user.name && existing.picture === user.picture) return
    enqueue([newEvent('UserSignedIn', user.sub, { name: user.name, picture: user.picture })])
  }, [enabled, user?.sub, user?.name, user?.picture, snapshots, users, enqueue])

  return null
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return (
    <SyncProvider aggregates={AGGREGATES} enabled={isAdmin}>
      <RecordIdentity />
      {children}
    </SyncProvider>
  )
}
