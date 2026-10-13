/**
 * useGlobalStats — the public all-players make-%-by-distance line.
 *
 * Fetches GET /api/stats and returns just its `global` field: the unweighted mean
 * of every player's make % at each distance (see backend global_average). It is a
 * computed line with no made/attempts of its own, so each point is marked
 * `attempts: 0` for the chart's tooltip — the same shape the Daily Putts baseline
 * uses for a read-only viewer. An online read by nature: it spans every player,
 * none of whom are in this device's offline cache.
 */
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'
import type { DistanceStat, GlobalStat } from './putting'

export interface GlobalStatsData {
  /** All-players make-% by distance, or [] until loaded. */
  global: DistanceStat[]
  loading: boolean
  error: string | null
}

export function useGlobalStats(): GlobalStatsData {
  const { data, loading, error } = useResilientFetch<DistanceStat[]>(async () => {
    const res = await fetchWithTimeout('/api/stats')
    if (!res.ok) throw new Error(`Could not load stats (${res.status})`)
    const body = (await res.json()) as { global: GlobalStat[] }
    return body.global.map((g) => ({ distance: g.distance, made: 0, attempts: 0, pct: g.pct }))
  }, [])

  return { global: data ?? [], loading, error }
}
