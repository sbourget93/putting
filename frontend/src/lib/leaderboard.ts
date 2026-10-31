/**
 * The Leaderboard's three boards and the labels around them.
 *
 * `daily` ranks a single day (default today) and is paired with a date picker;
 * `average` and `best` are per-player all-time-ish views with no date. The blurb
 * is the small gray line shown under the control for the two aggregate boards, so
 * a viewer knows what the ranking means without a legend.
 */
import { localDay } from './putting'

export type LeaderboardMode = 'daily' | 'average' | 'best'

// The Average board pools each player's most recent complete tests, reaching back
// no further than a year. Mirrors the backend constants of the same name (see
// routers/putting.py); the session minimum is intentionally not mirrored, since
// callers here only care which tests fall inside the sample, not who qualifies.
export const AVERAGE_TEST_LIMIT = 50
export const AVERAGE_MAX_AGE_DAYS = 365

export const MODES: { id: LeaderboardMode; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'average', label: 'Average' },
  { id: 'best', label: 'Best' },
]

/** The small gray caption under the control; null for Daily (its picker says it). */
export const MODE_BLURB: Record<LeaderboardMode, string | null> = {
  daily: null,
  average:
    'Average of each player’s last 50 sessions, going back up to a year. Minimum 5 sessions required.',
  best: 'Each player’s all time best session.',
}

/** One rank label (with its tie flag) per entry, in board order. */
export interface RankLabel {
  label: string
  tied: boolean
}

/**
 * Rank labels for entries already ordered best-first by percentage.
 *
 * Players whose percentage is equal to one decimal place are tied: they share a
 * single rank number and every label in the group is prefixed "T", so a tie at
 * the top reads T1, T1, then 3 for the next player. Ranking is competition style,
 * so the rank after a tie skips the places the tie consumed.
 *
 * The board still shows whole-number percentages; only this tie test looks at the
 * first decimal. Two rows showing the same rounded 55% are therefore tied only
 * when they also match at 55.x, so a 54.5% and a 55.5% that both display as 55%
 * are not tied.
 */
export function rankLabels(pcts: number[]): RankLabel[] {
  // One-decimal bucket as an integer, so the compare is exact (no float equality).
  const bucket = (pct: number): number => Math.round(pct * 10)
  const out: RankLabel[] = []
  for (let start = 0; start < pcts.length; ) {
    let end = start + 1
    while (end < pcts.length && bucket(pcts[end]) === bucket(pcts[start])) end++
    const tied = end - start > 1
    for (let i = start; i < end; i++) out.push({ label: tied ? `T${start + 1}` : `${start + 1}`, tied })
    start = end
  }
  return out
}

/** The YYYY-MM-DD `delta` days from `day`, via local-time date math (DST-safe). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  return localDay(dt)
}

/** A plain date like "Oct 11, 2026" from a local YYYY-MM-DD. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "Today" / "Yesterday" for the obvious days, else the plain date (see formatDay). */
export function dayLabel(day: string, today: string = localDay()): string {
  if (day === today) return 'Today'
  if (day === shiftDay(today, -1)) return 'Yesterday'
  return formatDay(day)
}
