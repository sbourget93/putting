/**
 * Local-first sync engine (snapshot + pending-queue overlay).
 *
 * The server projection is the source of truth for confirmed reads. The client
 * caches each aggregate's snapshot and renders `snapshot folded through the
 * pending queue` (see useAggregateRows) — so the reducer only ever touches the
 * handful of un-acked local writes, never the whole history. That is what keeps
 * client and server from drifting: every successful sync refetches the
 * authoritative snapshots and drops the flushed events, so any optimistic
 * discrepancy is erased on the next round trip.
 *
 * Writes `enqueue` synchronously (local-speed, online or not). A background loop
 * drains the queue to POST /commands as one atomic batch. This app is
 * last-write-wins (no expected_version), so a batch either commits, is
 * permanently rejected (4xx → reset to server + dead-letter for review), or
 * fails transiently (5xx/network → stay queued and retry).
 *
 * `enabled` gates the whole engine on `canWrite`: the data layer runs for any
 * signed-in writer (see StoreProvider), so a logged-out or read-only `public`
 * viewer gets an inert, empty engine that never touches the network or IndexedDB.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as db from './db'
import { postCommands, RejectedError } from './commands'
import { SyncContext, type SyncContextValue } from './SyncContext'
import type { AggregateDescriptor, CommandEvent, DeadLetter, Snapshot, SyncStatus } from './types'

const RETRY_INTERVAL_MS = 15000

interface EngineState {
  snapshots: Record<string, Snapshot>
  queue: CommandEvent[]
  deadLetter: DeadLetter[]
  version: number
  syncStatus: SyncStatus
  loaded: boolean
}

const EMPTY_STATE: EngineState = {
  snapshots: {},
  queue: [],
  deadLetter: [],
  version: 0,
  syncStatus: 'idle',
  loaded: false,
}

export function SyncProvider({
  aggregates,
  enabled,
  children,
}: {
  // Descriptors vary in their Row type; the engine treats rows opaquely, so the
  // heterogeneous array is typed loosely here.
  aggregates: AggregateDescriptor<any>[]
  enabled: boolean
  children: ReactNode
}) {
  const { byName, byType } = useMemo(() => {
    const byName: Record<string, AggregateDescriptor> = {}
    const byType: Record<string, AggregateDescriptor> = {}
    for (const a of aggregates) {
      byName[a.name] = a
      for (const t of a.eventTypes) byType[t] = a
    }
    return { byName, byType }
  }, [aggregates])

  const [state, setState] = useState<EngineState>(EMPTY_STATE)

  // Mirror of committed state for synchronous reads inside async callbacks (so a
  // flush fired right after an enqueue sees the just-added event).
  const ref = useRef(state)
  const flushingRef = useRef(false)
  const flushRef = useRef<() => Promise<void>>(async () => {})

  /** Commit new state and persist the mutable slots. */
  const commit = useCallback((patch: Partial<EngineState>) => {
    const next = { ...ref.current, ...patch }
    ref.current = next
    setState(next)
    if (next.loaded) {
      void db.saveQueue(next.queue)
      void db.saveDeadLetter(next.deadLetter)
      void db.saveVersion(next.version)
    }
  }, [])

  /** Refetch every aggregate's snapshot. Returns the fresh map + version, or null if offline. */
  const fetchSnapshots = useCallback(async (): Promise<{
    snapshots: Record<string, Snapshot>
    version: number
  } | null> => {
    try {
      const results = await Promise.all(
        aggregates.map(async (a) => [a.name, await a.fetch()] as const),
      )
      const snapshots: Record<string, Snapshot> = { ...ref.current.snapshots }
      let version = 0
      for (const [name, snap] of results) {
        snapshots[name] = snap
        version = Math.max(version, snap.version)
        void db.saveSnapshot(name, snap)
      }
      return { snapshots, version }
    } catch {
      return null
    }
  }, [aggregates])

  const flush = useCallback(async () => {
    const s = ref.current
    if (flushingRef.current || !s.loaded) return
    if (s.queue.length === 0) return

    flushingRef.current = true
    const batch = s.queue
    const batchIds = new Set(batch.map((e) => e.event_id))
    commit({ syncStatus: 'syncing' })
    try {
      const res = await postCommands(batch)
      // The POST and this refetch are separate requests: on a flaky connection the
      // write can commit while the refetch fails. If we can't refetch the
      // authoritative snapshot, DON'T drain the batch — dropping it while the stale
      // snapshot lacks its effect would revert the optimistic UI until a later
      // refresh happens to land. Keep it queued; the retry re-posts it, which is
      // idempotent (the backend dedupes by event_id) and drains only once a refetch
      // actually confirms the state.
      const fresh = await fetchSnapshots()
      if (!fresh) {
        commit({ syncStatus: 'offline' })
        return
      }
      const remaining = ref.current.queue.filter((e) => !batchIds.has(e.event_id))
      commit({
        snapshots: fresh.snapshots,
        version: res.version,
        queue: remaining,
        syncStatus: 'idle',
      })
      if (remaining.length > 0) void flushRef.current()
    } catch (err) {
      if (err instanceof RejectedError) {
        // Permanent rejection: reset local to server truth and park the batch for
        // review rather than dropping it silently or retrying forever.
        console.error('command dead-lettered (rejected):', err.detail)
        const fresh = await fetchSnapshots()
        const entry: DeadLetter = {
          id: crypto.randomUUID(),
          events: batch,
          detail: err.detail,
          rejectedAt: new Date().toISOString(),
        }
        const remaining = ref.current.queue.filter((e) => !batchIds.has(e.event_id))
        commit({
          snapshots: fresh?.snapshots ?? ref.current.snapshots,
          version: fresh?.version ?? ref.current.version,
          queue: remaining,
          deadLetter: [...ref.current.deadLetter, entry],
          syncStatus: 'idle',
        })
      } else {
        // Unreachable / 5xx: keep the queue and retry later.
        commit({ syncStatus: 'offline' })
      }
    } finally {
      flushingRef.current = false
    }
  }, [commit, fetchSnapshots])
  flushRef.current = flush

  const refresh = useCallback(async () => {
    const fresh = await fetchSnapshots()
    if (fresh) commit({ snapshots: fresh.snapshots, version: fresh.version })
  }, [commit, fetchSnapshots])

  // Boot: hydrate from IndexedDB (instant, offline-capable), then reconcile with
  // the server and flush anything pending. Only when enabled (admin); otherwise
  // reset to an inert empty engine that never touches network or storage.
  useEffect(() => {
    if (!enabled) {
      ref.current = EMPTY_STATE
      setState(EMPTY_STATE)
      return
    }
    let alive = true
    void (async () => {
      // The cached state is optional — if reading it fails (e.g. a schema change),
      // start empty and let the refresh below repopulate from the server. A bad
      // cache must never wedge the engine or blank the UI.
      let loaded: db.LoadedState
      try {
        loaded = await db.loadState(aggregates.map((a) => a.name))
      } catch {
        loaded = { snapshots: {}, queue: [], deadLetter: [], version: 0 }
      }
      if (!alive) return
      commit({ ...loaded, loaded: true })
      await refresh()
      void flushRef.current()
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Flush on reconnect and on a slow retry timer (covers a flaky connection that
  // never fires a clean `online` event). Only while enabled.
  useEffect(() => {
    if (!enabled) return
    const onOnline = () => void flushRef.current()
    window.addEventListener('online', onOnline)
    const id = window.setInterval(() => {
      if (ref.current.queue.length > 0) void flushRef.current()
    }, RETRY_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(id)
    }
  }, [enabled])

  const enqueue = useCallback(
    (events: CommandEvent[]) => {
      commit({ queue: [...ref.current.queue, ...events] })
      void flushRef.current()
    },
    [commit],
  )

  const dismissDeadLetter = useCallback(
    (id: string) => {
      commit({ deadLetter: ref.current.deadLetter.filter((d) => d.id !== id) })
    },
    [commit],
  )

  const retryDeadLetter = useCallback(
    (id: string) => {
      const entry = ref.current.deadLetter.find((d) => d.id === id)
      if (!entry) return
      commit({
        queue: [...ref.current.queue, ...entry.events],
        deadLetter: ref.current.deadLetter.filter((d) => d.id !== id),
      })
      void flushRef.current()
    },
    [commit],
  )

  const describe = useCallback(
    (event: CommandEvent) => byType[event.type]?.describe(event) ?? event.type,
    [byType],
  )

  const value = useMemo<SyncContextValue>(
    () => ({
      syncStatus: state.syncStatus,
      pendingCount: state.queue.length,
      deadLetter: state.deadLetter,
      enabled,
      enqueue,
      refresh,
      dismissDeadLetter,
      retryDeadLetter,
      describe,
      snapshots: state.snapshots,
      queue: state.queue,
      aggregatesByName: byName,
    }),
    [state, enabled, enqueue, refresh, dismissDeadLetter, retryDeadLetter, describe, byName],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
