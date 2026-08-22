/**
 * The `tests` aggregate for the sync engine (daily tests).
 *
 * A thin aggregate: its only event is TestStarted, so `reduce` only ever adds a
 * row. `fetch` reads the owner-scoped server projection (GET /tests). Mirrors
 * backend/projections/tests.py.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import type { Test } from '../../lib/putting'

const NAME = 'tests'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

async function fetchTests(): Promise<Snapshot<Test>> {
  const res = await fetch('/api/tests')
  if (!res.ok) throw new Error(`fetch tests failed: ${res.status}`)
  const body = (await res.json()) as { version: number; tests: Test[] }
  return {
    version: body.version,
    rows: body.tests.map((t) => ({ test_id: t.test_id, test_date: t.test_date })),
  }
}

function reduce(rows: Test[], ev: CommandEvent): Test[] {
  switch (ev.type) {
    case 'TestStarted':
      return [...rows, { test_id: ev.aggregate_id, test_date: str(ev.data, 'test_date') }]
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'TestStarted':
      return `Start daily test ${str(ev.data, 'test_date')}`
    default:
      return ev.type
  }
}

export const testsDescriptor: AggregateDescriptor<Test> = {
  name: NAME,
  eventTypes: ['TestStarted'],
  fetch: fetchTests,
  reduce,
  describe,
}

/** This admin's daily tests: the server snapshot with pending writes folded on top. */
export function useTests(): Test[] {
  return useAggregateRows<Test>(NAME)
}
