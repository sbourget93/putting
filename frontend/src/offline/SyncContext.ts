/**
 * Sync engine context and hooks — the non-component half of the engine.
 *
 * Split from SyncProvider (the component, in SyncEngine.tsx) so each file exports
 * one kind of thing, which React Fast Refresh needs. Components read the engine
 * through `useSync`; individual aggregates read their rows through
 * `useAggregateRows`.
 */
import { createContext, useContext, useMemo } from 'react'
import type { AggregateDescriptor, CommandEvent, DeadLetter, Snapshot, SyncStatus } from './types'

export interface SyncContextValue {
  syncStatus: SyncStatus
  pendingCount: number
  deadLetter: DeadLetter[]
  /** Whether the engine is active (admin). False for non-admins. */
  enabled: boolean
  enqueue: (events: CommandEvent[]) => void
  /** Refetch every aggregate snapshot from the server. */
  refresh: () => Promise<void>
  dismissDeadLetter: (id: string) => void
  retryDeadLetter: (id: string) => void
  describe: (event: CommandEvent) => string
  // Internal: consumed by useAggregateRows.
  snapshots: Record<string, Snapshot>
  queue: CommandEvent[]
  aggregatesByName: Record<string, AggregateDescriptor>
}

export const SyncContext = createContext<SyncContextValue | undefined>(undefined)

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (ctx === undefined) throw new Error('useSync must be used within a SyncProvider')
  return ctx
}

/** The rendered rows for an aggregate: its server snapshot with the pending queue folded on top. */
export function useAggregateRows<Row>(name: string): Row[] {
  const { snapshots, queue, aggregatesByName } = useSync()
  return useMemo(() => {
    const snap = snapshots[name]
    if (!snap) return []
    const desc = aggregatesByName[name]
    if (!desc) return snap.rows as Row[]
    return queue.reduce((rows, ev) => desc.reduce(rows, ev), snap.rows) as Row[]
  }, [snapshots, queue, name, aggregatesByName])
}
