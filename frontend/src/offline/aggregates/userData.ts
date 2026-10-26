/**
 * The `user_data` aggregate for the sync engine (per-user free-form values).
 *
 * `fetch` reads the signed-in user's own values (GET /user-data), the sparse set of
 * keys they have written. `reduce` folds a queued UserDataChanged onto those rows,
 * upserting by `key`, mirroring backend/projections/user_data.py — so an edit shows
 * instantly and reconciles on the next sync. Every row belongs to the current user
 * (the fetch is scoped), so `key` alone identifies a value here. When the backend
 * handler changes, mirror it here and in `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import type { UserDatum } from '../../lib/putting'

const NAME = 'user_data'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

async function fetchUserData(): Promise<Snapshot<UserDatum>> {
  const res = await fetch('/api/user-data')
  if (!res.ok) throw new Error(`fetch user-data failed: ${res.status}`)
  const body = (await res.json()) as { version: number; data: UserDatum[] }
  return {
    version: body.version,
    rows: body.data.map((d) => ({
      user_data_id: d.user_data_id,
      key: d.key,
      value: d.value,
    })),
  }
}

function reduce(rows: UserDatum[], ev: CommandEvent): UserDatum[] {
  switch (ev.type) {
    case 'UserDataChanged': {
      const key = str(ev.data, 'key')
      const value = str(ev.data, 'value')
      const i = rows.findIndex((r) => r.key === key)
      // Updating keeps the existing record's id; a first write inserts a new row under
      // the event's aggregate id, mirroring the backend upsert on (owner, key).
      if (i === -1) return [...rows, { user_data_id: ev.aggregate_id, key, value }]
      const copy = rows.slice()
      copy[i] = { ...copy[i], value }
      return copy
    }
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'UserDataChanged':
      return `Set ${str(ev.data, 'key')}`
    default:
      return ev.type
  }
}

export const userDataDescriptor: AggregateDescriptor<UserDatum> = {
  name: NAME,
  eventTypes: ['UserDataChanged'],
  fetch: fetchUserData,
  reduce,
  describe,
}

/** This user's stored data values: the server snapshot with pending writes folded on top. */
export function useUserData(): UserDatum[] {
  return useAggregateRows<UserDatum>(NAME)
}
