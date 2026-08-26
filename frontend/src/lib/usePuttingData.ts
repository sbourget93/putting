/**
 * usePuttingData — the Daily Putts page's read model, resolved for the viewer.
 *
 * Deliberately compact: only today's test, today's batches, and the all-time
 * make-%-by-distance baseline (excluding today) — never the full batch log. That
 * keeps what every phone downloads (and what admins cache offline) small and
 * bounded no matter how much history exists. History / Leaderboard / Compare read
 * their own, heavier data on demand instead of through this hook.
 *
 * Two paths, matching the template's admin/non-admin split:
 *  - Admins run the offline sync engine, so today's test/batches come from the
 *    cached daily snapshot with pending writes folded on top, and the baseline
 *    from its cached aggregate. They can write, and they see their own data.
 *  - Everyone else reads the same compact payload online (GET /api/daily) and is
 *    read-only, seeing the demo owner's day.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth-context'
import { useBatches } from '../offline/aggregates/batches'
import { useTests } from '../offline/aggregates/tests'
import { useBaseline } from '../offline/aggregates/baseline'
import { fetchDaily, toBatch } from '../offline/aggregates/daily'
import { findTest, localDay, type Batch, type DistanceStat, type Test } from './putting'

export interface DailyData {
  /** Today's daily test, if it has been started. */
  test: Test | null
  /** Today's test batches (at most one per distance). */
  todayBatches: Batch[]
  /** All-time make-% by distance, excluding today — the chart's baseline line. */
  baselineStats: DistanceStat[]
  /** Non-admins view the demo owner's day and cannot record or edit. */
  readOnly: boolean
  loading: boolean
  error: string | null
}

export function usePuttingData(): DailyData {
  const { isAdmin } = useAuth()

  // Admin path: always subscribed, but only meaningful when isAdmin (a non-admin
  // engine is inert and returns empty).
  const adminTests = useTests()
  const adminBatches = useBatches()
  const adminBaseline = useBaseline()

  // Non-admin path: the same compact payload, fetched online.
  const [online, setOnline] = useState<{ test: Test | null; todayBatches: Batch[]; baselineStats: DistanceStat[] }>({
    test: null,
    todayBatches: [],
    baselineStats: [],
  })
  const [loading, setLoading] = useState(!isAdmin)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAdmin) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const body = await fetchDaily()
        if (!cancelled) {
          setOnline({
            test: body.test,
            todayBatches: body.today_batches.map(toBatch),
            baselineStats: body.baseline,
          })
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
  }, [isAdmin])

  if (isAdmin) {
    return {
      test: findTest(adminTests, localDay()) ?? null,
      todayBatches: adminBatches,
      baselineStats: adminBaseline,
      readOnly: false,
      loading: false,
      error: null,
    }
  }
  return {
    test: online.test,
    todayBatches: online.todayBatches,
    baselineStats: online.baselineStats,
    readOnly: true,
    loading,
    error,
  }
}
