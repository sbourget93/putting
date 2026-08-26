/**
 * The date-range choice shared by the Leaderboard and Compare pages.
 *
 * A range resolves to inclusive [start, end] day bounds computed from the viewer's
 * local day (see localDay), so "today" rolls over at local midnight and the server
 * filters on the same local test_date the client recorded.
 */
import { localDay } from './putting'

export type Range = 'today' | '30d' | 'all'

export const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
]

/** The inclusive [start, end] day bounds for a range; undefined bound = open. */
export function windowFor(range: Range): { start?: string; end?: string } {
  if (range === 'all') return {}
  const end = localDay()
  if (range === 'today') return { start: end, end }
  const since = new Date()
  since.setDate(since.getDate() - 29) // 30-day window, inclusive of today
  return { start: localDay(since), end }
}
