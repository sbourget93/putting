/**
 * useLeaderboard — the leaderboard's read model.
 *
 * Players ranked by overall daily-test make % over a date window, from the public
 * GET /api/leaderboard (email-free, keyed by the stable Google `sub`). Each entry
 * carries its make-%-by-distance breakdown too, so clicking a player draws their
 * line for the chosen range with no extra request. An online read by nature: it
 * spans every player, none of whom are in this device's offline cache.
 *
 * The window is passed as inclusive YYYY-MM-DD bounds computed from the viewer's
 * local day (see LeaderboardPage), so "today" rolls over at local midnight.
 */
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'
import type { DistanceStat } from './putting'

export interface LeaderboardEntry {
  sub: string
  name: string
  picture: string | null
  overall_pct: number
  attempts: number
  stats: DistanceStat[]
}

/** A player mid-round: today's test started but not yet finished. */
export interface InProgressEntry {
  sub: string
  name: string
  picture: string | null
  done: number // distances recorded so far
  remaining: number // distances still owed
  stats: DistanceStat[] // make-% so far, by distance, for the partial line
}

export interface LeaderboardData {
  entries: LeaderboardEntry[]
  inProgress: InProgressEntry[]
  loading: boolean
  error: string | null
}

/**
 * Ranked players for the window [start, end] (inclusive); omit a bound for open.
 * Pass `day` (a local YYYY-MM-DD) to also get `inProgress`: players mid-round on
 * that day, for the Today board. Other windows leave it empty.
 */
export function useLeaderboard(start?: string, end?: string, day?: string): LeaderboardData {
  const { data, loading, error } = useResilientFetch(async () => {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (day) params.set('day', day)
    const qs = params.toString()
    const res = await fetchWithTimeout(`/api/leaderboard${qs ? `?${qs}` : ''}`)
    if (!res.ok) throw new Error(`Could not load leaderboard (${res.status})`)
    const body = (await res.json()) as {
      users: LeaderboardEntry[]
      in_progress?: InProgressEntry[]
    }
    return { entries: body.users, inProgress: body.in_progress ?? [] }
  }, [start, end, day])

  return {
    entries: data?.entries ?? [],
    inProgress: data?.inProgress ?? [],
    loading,
    error,
  }
}
