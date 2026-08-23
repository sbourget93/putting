/**
 * useStats — the comparison view's read model.
 *
 * Comparing users is inherently an online read: another user's data isn't in the
 * local offline cache, so every line on the Statistics page (including your own)
 * comes from GET /api/stats. The endpoint is public and email-free — users are
 * keyed by the stable Google `sub` with a display name (see backend main.get_stats).
 *
 * Fetched once on mount. Offline or on error, the page falls back to its
 * error/empty state; there is no local cache for other users to fold.
 */
import { useEffect, useState } from 'react'
import type { GlobalStat, UserStats } from './putting'

export interface StatsData {
  users: UserStats[]
  global: GlobalStat[]
  loading: boolean
  error: string | null
}

export function useStats(): StatsData {
  const [data, setData] = useState<{ users: UserStats[]; global: GlobalStat[] }>({
    users: [],
    global: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch('/api/stats')
        if (!res.ok) throw new Error(`Could not load stats (${res.status})`)
        const body = (await res.json()) as { users: UserStats[]; global: GlobalStat[] }
        if (!cancelled) {
          setData({ users: body.users, global: body.global })
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
  }, [])

  return { users: data.users, global: data.global, loading, error }
}
