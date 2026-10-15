/**
 * useLeaderboard — the leaderboard's read model.
 *
 * Players ranked by daily-test make % in one of three boards (see LeaderboardMode),
 * from the public GET /api/leaderboard (email-free, keyed by the stable Google
 * `sub`). Each entry carries its make-%-by-distance breakdown too, so clicking a
 * player draws their line with no extra request. An online read by nature: it spans
 * every player, none of whom are in this device's offline cache.
 *
 * `daily` also returns `days` (every date that has a completed test, newest first)
 * for the date picker, and `inProgress` (players mid-round on `day`). The other
 * boards return neither.
 */
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'
import type { LeaderboardMode } from './leaderboard'
import type { DistanceStat } from './putting'

export interface LeaderboardEntry {
  sub: string
  name: string
  picture: string | null
  overall_pct: number
  attempts: number
  stats: DistanceStat[]
  /** Average board only: how many sessions went into the average. */
  sessions?: number
  /** Best board only: the local YYYY-MM-DD of the player's best session. */
  date?: string
  /** Daily board only: the optional note the player left on that day's test. */
  message?: string | null
}

/** A player mid-round: the day's test started but not yet finished. */
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
  days: string[]
  loading: boolean
  error: string | null
}

/**
 * Ranked players for `mode`. In `daily`, `day` (a local YYYY-MM-DD) is the board's
 * date; the other boards ignore it.
 */
export function useLeaderboard(mode: LeaderboardMode, day: string): LeaderboardData {
  const { data, loading, error } = useResilientFetch(async () => {
    const params = new URLSearchParams({ mode })
    if (mode === 'daily') params.set('day', day)
    const res = await fetchWithTimeout(`/api/leaderboard?${params.toString()}`)
    if (!res.ok) throw new Error(`Could not load leaderboard (${res.status})`)
    const body = (await res.json()) as {
      users: LeaderboardEntry[]
      in_progress?: InProgressEntry[]
      days?: string[]
    }
    return { entries: body.users, inProgress: body.in_progress ?? [], days: body.days ?? [] }
  }, [mode, day])

  return {
    entries: data?.entries ?? [],
    inProgress: data?.inProgress ?? [],
    days: data?.days ?? [],
    loading,
    error,
  }
}
