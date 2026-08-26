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
import { useEffect, useState } from 'react'
import type { DistanceStat } from './putting'

export interface LeaderboardEntry {
  sub: string
  name: string
  picture: string | null
  overall_pct: number
  attempts: number
  stats: DistanceStat[]
}

export interface LeaderboardData {
  entries: LeaderboardEntry[]
  loading: boolean
  error: string | null
}

/** Ranked players for the window [start, end] (inclusive); omit a bound for open. */
export function useLeaderboard(start?: string, end?: string): LeaderboardData {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    const qs = params.toString()
    void (async () => {
      try {
        const res = await fetch(`/api/leaderboard${qs ? `?${qs}` : ''}`)
        if (!res.ok) throw new Error(`Could not load leaderboard (${res.status})`)
        const body = (await res.json()) as { users: LeaderboardEntry[] }
        if (!cancelled) {
          setEntries(body.users)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [start, end])

  return { entries, loading, error }
}
