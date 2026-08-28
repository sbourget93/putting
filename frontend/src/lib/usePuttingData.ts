/**
 * usePuttingData — the Daily Putts page's read model, resolved for the viewer.
 *
 * Deliberately compact: only today's test, today's batches, and the all-time
 * make-%-by-distance baseline (excluding today) — never the full batch log. That
 * keeps what every phone downloads (and what admins cache offline) small and
 * bounded no matter how much history exists. History / Leaderboard / Compare read
 * their own, heavier data on demand instead of through this hook.
 *
 * Two paths, matching the writer / read-only split:
 *  - A signed-in writer runs the offline sync engine, so today's test/batches come
 *    from the cached daily snapshot with pending writes folded on top, and the
 *    baseline from its cached aggregate. They can write, and they see their own data.
 *  - Everyone else (logged out, or the read-only `public` role) sees a blank day:
 *    no personal putts, no demo account. Their chart's baseline is the global
 *    average — the mean of every player's all-time make % by distance, from the
 *    public /stats endpoint — so the screen is a non-interactable version of what a
 *    new signed-in user starts with, framed against the field rather than empty.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth-context'
import { useBatches } from '../offline/aggregates/batches'
import { useTests } from '../offline/aggregates/tests'
import { useBaseline } from '../offline/aggregates/baseline'
import { findTest, localDay, type Batch, type DistanceStat, type GlobalStat, type Test } from './putting'

export interface DailyData {
  /** Today's daily test, if it has been started. */
  test: Test | null
  /** Today's test batches (at most one per distance). */
  todayBatches: Batch[]
  /** All-time make-% by distance — the chart's baseline line. Own history for a
   *  writer; the global average across all players for a read-only viewer. */
  baselineStats: DistanceStat[]
  /** Read-only viewers (logged out or `public`) see a blank day they cannot record or edit. */
  readOnly: boolean
  loading: boolean
  error: string | null
}

export function usePuttingData(): DailyData {
  const { canWrite } = useAuth()

  // Writer path: always subscribed, but only meaningful when canWrite (a non-writer
  // engine is inert and returns empty).
  const engineTests = useTests()
  const engineBatches = useBatches()
  const engineBaseline = useBaseline()

  // Read-only path: no personal data, but the chart still gets a baseline — the
  // global average by distance from the public /stats endpoint.
  const [globalBaseline, setGlobalBaseline] = useState<DistanceStat[]>([])
  const [loading, setLoading] = useState(!canWrite)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (canWrite) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch('/api/stats')
        if (!res.ok) throw new Error(`fetch stats failed: ${res.status}`)
        const body = (await res.json()) as { global: GlobalStat[] }
        if (!cancelled) {
          // The global line is a computed mean with no made/attempts of its own;
          // attempts: 0 marks it as such for the chart's tooltip.
          setGlobalBaseline(
            body.global.map((g) => ({ distance: g.distance, made: 0, attempts: 0, pct: g.pct })),
          )
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
  }, [canWrite])

  if (canWrite) {
    return {
      test: findTest(engineTests, localDay()) ?? null,
      todayBatches: engineBatches,
      baselineStats: engineBaseline,
      readOnly: false,
      loading: false,
      error: null,
    }
  }
  return {
    test: null,
    todayBatches: [],
    baselineStats: globalBaseline,
    readOnly: true,
    loading,
    error,
  }
}
