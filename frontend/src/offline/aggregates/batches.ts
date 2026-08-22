/**
 * The `batches` aggregate for the sync engine.
 *
 * `fetch` reads the authoritative, owner-scoped server projection (GET /batches).
 * `reduce` folds a single queued command onto the rows, mirroring the backend
 * handlers in backend/projections/batches.py. It runs only over the small pending
 * queue, so its job is the optimistic view of un-acked writes; the next refetch
 * replaces it with server truth. When a backend batch handler changes, mirror it
 * here and in `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import type { Batch } from '../../lib/putting'

const NAME = 'batches'

function num(data: Record<string, unknown> | undefined, key: string): number {
  const value = data?.[key]
  return typeof value === 'number' ? value : 0
}

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

/** Normalize one server row into a Batch (guards the loosely-typed JSON). */
function toBatch(raw: Batch): Batch {
  return {
    batch_id: raw.batch_id,
    kind: raw.kind === 'test' ? 'test' : 'free',
    test_id: raw.test_id ?? null,
    distance: raw.distance,
    batch_size: raw.batch_size,
    made: raw.made,
    created_at: raw.created_at,
  }
}

async function fetchBatches(): Promise<Snapshot<Batch>> {
  const res = await fetch('/api/batches')
  if (!res.ok) throw new Error(`fetch batches failed: ${res.status}`)
  const body = (await res.json()) as { version: number; batches: Batch[] }
  return { version: body.version, rows: body.batches.map(toBatch) }
}

function reduce(rows: Batch[], ev: CommandEvent): Batch[] {
  switch (ev.type) {
    case 'BatchRecorded':
      return [
        ...rows,
        {
          batch_id: ev.aggregate_id,
          kind: str(ev.data, 'kind') === 'test' ? 'test' : 'free',
          test_id: str(ev.data, 'test_id') || null,
          distance: num(ev.data, 'distance'),
          batch_size: num(ev.data, 'batch_size'),
          made: num(ev.data, 'made'),
          created_at: ev.created_at,
        },
      ]
    case 'BatchEdited':
      return rows.map((r) =>
        r.batch_id === ev.aggregate_id
          ? {
              ...r,
              distance: num(ev.data, 'distance'),
              batch_size: num(ev.data, 'batch_size'),
              made: num(ev.data, 'made'),
            }
          : r,
      )
    case 'BatchDeleted':
      // The server snapshot already omits deleted rows; folding a queued delete
      // just removes it optimistically.
      return rows.filter((r) => r.batch_id !== ev.aggregate_id)
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'BatchRecorded':
      return `Record ${num(ev.data, 'made')}/${num(ev.data, 'batch_size')} from ${num(ev.data, 'distance')} ft`
    case 'BatchEdited':
      return 'Edit putt batch'
    case 'BatchDeleted':
      return 'Delete putt batch'
    default:
      return ev.type
  }
}

export const batchesDescriptor: AggregateDescriptor<Batch> = {
  name: NAME,
  eventTypes: ['BatchRecorded', 'BatchEdited', 'BatchDeleted'],
  fetch: fetchBatches,
  reduce,
  describe,
}

/** This admin's active batches: the server snapshot with pending writes folded on top. */
export function useBatches(): Batch[] {
  return useAggregateRows<Batch>(NAME)
}
