/**
 * StoreProvider — mounts the sync engine and registers the app's aggregates.
 *
 * The offline data layer is admin-only: only admins may read the full projection
 * data (private_value) and only admins may write. So the engine runs only when
 * the signed-in user is an admin (`enabled`); a non-admin gets an inert engine
 * that never fetches, syncs, or persists, and reads online instead (see
 * TemplateTestPage). Must sit inside AuthProvider, since it reads `isAdmin`.
 *
 * Register aggregates here — one descriptor per aggregate, mirroring the backend's
 * projection modules. Drop `fooDescriptor` once the demo aggregate is deleted.
 */
import { type ReactNode } from 'react'
import { useAuth } from '../auth-context'
import { SyncProvider } from './SyncEngine'
import { fooDescriptor } from './aggregates/foo'
import type { AggregateDescriptor } from './types'

const AGGREGATES: AggregateDescriptor<any>[] = [fooDescriptor]

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return (
    <SyncProvider aggregates={AGGREGATES} enabled={isAdmin}>
      {children}
    </SyncProvider>
  )
}
