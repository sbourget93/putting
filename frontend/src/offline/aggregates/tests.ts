/**
 * The `tests` aggregate for the sync engine (daily tests).
 *
 * Scoped to Daily Putts: `fetch` reads only *today's* test from the compact
 * /api/daily payload, so the offline cache never grows with history. Its only
 * event is TestStarted, so `reduce` only ever adds a row (today's, when the day's
 * first putt starts the test). Mirrors backend/projections/tests.py.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import { fetchDaily } from './daily'
import type { Test } from '../../lib/putting'

const NAME = 'tests'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

async function fetchTests(): Promise<Snapshot<Test>> {
  const body = await fetchDaily()
  return { version: body.version, rows: body.test ? [body.test] : [] }
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
