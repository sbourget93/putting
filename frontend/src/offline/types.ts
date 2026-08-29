/**
 * Types for the offline sync engine.
 *
 * The engine is snapshot-based: the server's projection is the source of truth
 * for confirmed reads, and each aggregate contributes a cached snapshot plus a
 * reducer that folds only the *pending* (un-acked) command queue on top. See
 * SyncEngine.tsx for the flow and frontend/AGENTS.md for the rationale.
 */

/** A client-authored command event. Aggregate-agnostic — the backend routes by `type`. */
export interface CommandEvent {
  event_id: string // client-generated UUID; the server's idempotency key
  type: string
  aggregate_id: string // client-generated UUID of the target aggregate
  data?: Record<string, unknown>
  created_at: string // ISO time the write actually happened (offline-safe)
}

/** A cached server projection: the rows and the version they were read at. */
export interface Snapshot<Row = unknown> {
  version: number
  rows: Row[]
}

/** Sync/connectivity state surfaced to the UI. LWW backend, so there is no conflict state. */
export type SyncStatus = 'idle' | 'syncing' | 'offline'

/**
 * A batch the server permanently refused (a 4xx — unknown type, bad payload).
 * Retrying can never succeed, so it's parked here for an admin to review rather
 * than dropped silently or retried forever.
 */
export interface DeadLetter {
  id: string
  events: CommandEvent[]
  detail: string
  rejectedAt: string
}

/**
 * One aggregate's registration with the engine. Adding an aggregate is a new
 * descriptor plus one line in StoreProvider's list — mirrors the backend's
 * per-aggregate projection modules.
 */
export interface AggregateDescriptor<Row = unknown> {
  /** Snapshot key, e.g. 'batches'. Matches the server query it fetches. */
  name: string
  /** Event types this aggregate owns, used to route `describe`. */
  eventTypes: string[]
  /** Fetch the authoritative server projection. */
  fetch: () => Promise<Snapshot<Row>>
  /** Fold one queued event onto the rows (mirror of the backend projection handler). */
  reduce: (rows: Row[], event: CommandEvent) => Row[]
  /** Human-readable label for the dead-letter review UI. */
  describe: (event: CommandEvent) => string
}
