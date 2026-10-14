/**
 * useGlobalStats — the public all-players make-%-by-distance data.
 *
 * Fetches GET /api/stats and returns two things:
 * - `global`: the unweighted mean of every player's make % at each distance (see
 *   backend global_average). A computed line with no made/attempts of its own, so
 *   each point is marked `attempts: 0` for the chart's tooltip — the same shape the
 *   Daily Putts baseline uses for a read-only viewer.
 * - `users`: each player's all-time make % by distance, keyed by `sub`, which the
 *   History page's "compare with" line reads without a second request.
 *
 * An online read by nature: it spans every player, none of whom are in this device's
 * offline cache.
 */
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'
import type { DistanceStat, GlobalStat, UserStats } from './putting'

export interface GlobalStatsData {
  /** All-players make-% by distance, or [] until loaded. */
  global: DistanceStat[]
  /** Per-player all-time make-% by distance, or [] until loaded. */
  users: UserStats[]
  loading: boolean
  error: string | null
}

export function useGlobalStats(): GlobalStatsData {
  const { data, loading, error } = useResilientFetch<{ global: DistanceStat[]; users: UserStats[] }>(
    async () => {
      const res = await fetchWithTimeout('/api/stats')
      if (!res.ok) throw new Error(`Could not load stats (${res.status})`)
      const body = (await res.json()) as { global: GlobalStat[]; users: UserStats[] }
      return {
        global: body.global.map((g) => ({ distance: g.distance, made: 0, attempts: 0, pct: g.pct })),
        users: body.users,
      }
    },
    [],
  )

  return { global: data?.global ?? [], users: data?.users ?? [], loading, error }
}
