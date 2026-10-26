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
