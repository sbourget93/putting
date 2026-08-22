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
import { type ReactNode } from 'react'
import { useAuth } from '../auth-context'
import { SyncProvider } from './SyncEngine'
import { batchesDescriptor } from './aggregates/batches'
import { testsDescriptor } from './aggregates/tests'
import type { AggregateDescriptor } from './types'

const AGGREGATES: AggregateDescriptor<any>[] = [testsDescriptor, batchesDescriptor]

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return (
    <SyncProvider aggregates={AGGREGATES} enabled={isAdmin}>
      {children}
    </SyncProvider>
  )
}
