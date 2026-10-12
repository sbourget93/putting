/**
 * The `putts` aggregate for the sync engine.
 *
 * Scoped to Daily Putts: `fetch` reads only *today's* putts from the compact
 * /api/daily payload, so the offline cache stays tiny. `reduce` folds a single
 * queued command onto those rows, mirroring backend/projections/putts.py.
 *
 * These rows are shadow data: nothing renders them yet. The aggregate exists so the
 * record/edit/delete flows can target a batch's putts by their real ids (DailyTest
 * reads it via usePutts, but shows nothing). When a backend putt handler changes,
 * mirror it here and in `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import { fetchDaily, toPutt } from './daily'
import type { MissType, Putt } from '../../lib/putting'

const NAME = 'putts'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

function bool(data: Record<string, unknown> | undefined, key: string): boolean {
  return data?.[key] === true
}

function num(data: Record<string, unknown> | undefined, key: string): number | null {
  const value = data?.[key]
  return typeof value === 'number' ? value : null
}

function miss(data: Record<string, unknown> | undefined): MissType | null {
  const value = data?.['miss_type']
  return typeof value === 'string' ? (value as MissType) : null
}

async function fetchPutts(): Promise<Snapshot<Putt>> {
  const body = await fetchDaily()
  return { version: body.version, rows: body.today_putts.map(toPutt) }
}

function reduce(rows: Putt[], ev: CommandEvent): Putt[] {
  switch (ev.type) {
    case 'PuttRecorded':
      return [
        ...rows,
        {
          putt_id: ev.aggregate_id,
          batch_id: str(ev.data, 'batch_id'),
          number: num(ev.data, 'number'),
          made: bool(ev.data, 'made'),
          miss_type: miss(ev.data),
          created_at: ev.created_at,
        },
      ]
    case 'PuttEdited':
      return rows.map((r) =>
        r.putt_id === ev.aggregate_id
          ? { ...r, number: num(ev.data, 'number'), made: bool(ev.data, 'made'), miss_type: miss(ev.data) }
          : r,
      )
    case 'PuttDeleted':
      // The server snapshot already omits deleted rows; folding a queued delete
      // just removes it optimistically.
      return rows.filter((r) => r.putt_id !== ev.aggregate_id)
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'PuttRecorded':
      return 'Record putt'
    case 'PuttEdited':
      return 'Edit putt'
    case 'PuttDeleted':
      return 'Delete putt'
    default:
      return ev.type
  }
}

export const puttsDescriptor: AggregateDescriptor<Putt> = {
  name: NAME,
  eventTypes: ['PuttRecorded', 'PuttEdited', 'PuttDeleted'],
  fetch: fetchPutts,
  reduce,
  describe,
}

/** This writer's active putts: the server snapshot with pending writes folded on top. */
export function usePutts(): Putt[] {
  return useAggregateRows<Putt>(NAME)
}
