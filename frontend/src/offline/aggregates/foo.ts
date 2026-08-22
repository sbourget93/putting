/**
 * Template-only `foo` aggregate for the sync engine — the worked example of
 * registering an aggregate. Delete alongside TemplateTestPage and
 * backend/projections/foo.py once the app has an aggregate of its own.
 *
 * `fetch` reads the authoritative server projection (`GET /foos`, which returns
 * public_value to everyone and private_value only to admins). `reduce` folds a
 * single queued command onto the rows — it must mirror the backend projection
 * handlers, but only ever runs over the small pending queue, so a bug here
 * affects the optimistic view of un-acked writes and is erased on the next
 * refetch (never persisted truth). When you change a backend foo handler, mirror
 * it here and in `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'

/** A foo as the server projection returns it. private_value is '' for non-admins. */
export interface Foo {
  foo_id: string
  public_value: string
  private_value: string
}

const NAME = 'foos'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

async function fetchFoos(): Promise<Snapshot<Foo>> {
  const res = await fetch('/api/foos')
  if (!res.ok) throw new Error(`fetch foos failed: ${res.status}`)
  const body = (await res.json()) as { version: number; foos: Foo[] }
  return {
    version: body.version,
    rows: body.foos.map((f) => ({
      foo_id: f.foo_id,
      public_value: f.public_value,
      private_value: f.private_value ?? '',
    })),
  }
}

function reduce(rows: Foo[], ev: CommandEvent): Foo[] {
  switch (ev.type) {
    case 'FooCreated':
      return [
        ...rows,
        {
          foo_id: ev.aggregate_id,
          public_value: str(ev.data, 'public_value'),
          private_value: str(ev.data, 'private_value'),
        },
      ]
    case 'FooPublicValueChanged':
      return rows.map((r) =>
        r.foo_id === ev.aggregate_id ? { ...r, public_value: str(ev.data, 'public_value') } : r,
      )
    case 'FooPrivateValueChanged':
      return rows.map((r) =>
        r.foo_id === ev.aggregate_id ? { ...r, private_value: str(ev.data, 'private_value') } : r,
      )
    case 'FooDeleted':
      // The server snapshot already omits deleted rows; folding a queued delete
      // just removes it optimistically.
      return rows.filter((r) => r.foo_id !== ev.aggregate_id)
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'FooCreated':
      return `Add foo "${str(ev.data, 'public_value')}"`
    case 'FooPublicValueChanged':
      return 'Edit foo public value'
    case 'FooPrivateValueChanged':
      return 'Edit foo private value'
    case 'FooDeleted':
      return 'Delete foo'
    default:
      return ev.type
  }
}

export const fooDescriptor: AggregateDescriptor<Foo> = {
  name: NAME,
  eventTypes: ['FooCreated', 'FooPublicValueChanged', 'FooPrivateValueChanged', 'FooDeleted'],
  fetch: fetchFoos,
  reduce,
  describe,
}

/** Active foos for admins: the server snapshot with pending writes folded on top. */
export function useFoos(): Foo[] {
  return useAggregateRows<Foo>(NAME)
}
