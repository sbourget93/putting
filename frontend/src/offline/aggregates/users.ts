/**
 * The `users` aggregate for the sync engine (user identities).
 *
 * `fetch` reads the public server projection (GET /users), which returns only
 * sub/name/picture — never an email. `reduce` folds a queued UserSignedIn onto
 * the rows, upserting by `sub`, mirroring backend/projections/users.py. The
 * identity write itself is enqueued right after login (see StoreProvider's
 * RecordIdentity). When the backend handler changes, mirror it here and in
 * `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import type { AppUser } from '../../lib/putting'

const NAME = 'users'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

function pic(data: Record<string, unknown> | undefined): string | null {
  const value = data?.['picture']
  return typeof value === 'string' ? value : null
}

async function fetchUsers(): Promise<Snapshot<AppUser>> {
  const res = await fetch('/api/users')
  if (!res.ok) throw new Error(`fetch users failed: ${res.status}`)
  const body = (await res.json()) as { version: number; users: AppUser[] }
  return {
    version: body.version,
    rows: body.users.map((u) => ({ sub: u.sub, name: u.name, picture: u.picture ?? null })),
  }
}

function reduce(rows: AppUser[], ev: CommandEvent): AppUser[] {
  switch (ev.type) {
    case 'UserSignedIn': {
      const next: AppUser = {
        sub: ev.aggregate_id,
        name: str(ev.data, 'name'),
        picture: pic(ev.data),
      }
      const i = rows.findIndex((r) => r.sub === next.sub)
      if (i === -1) return [...rows, next]
      const copy = rows.slice()
      copy[i] = next
      return copy
    }
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'UserSignedIn':
      return `Record identity ${str(ev.data, 'name')}`
    default:
      return ev.type
  }
}

export const usersDescriptor: AggregateDescriptor<AppUser> = {
  name: NAME,
  eventTypes: ['UserSignedIn'],
  fetch: fetchUsers,
  reduce,
  describe,
}

/** All known user identities: the server snapshot with pending writes folded on top. */
export function useUsers(): AppUser[] {
  return useAggregateRows<AppUser>(NAME)
}
