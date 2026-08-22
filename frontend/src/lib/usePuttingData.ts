/**
 * usePuttingData — the app's read model, resolved for whichever role is viewing.
 *
 * Two paths, matching the template's admin/non-admin split:
 *  - Admins run the offline sync engine, so their tests and batches come from the
 *    cached projection with pending writes folded on top (useTests/useBatches).
 *    They can write, and they see their own data.
 *  - Everyone else (logged out, or signed in but not on the allowlist) has an
 *    inert engine, so we read the owner-scoped query endpoints online. The server
 *    returns the demo owner's data, and these viewers are read-only.
 *
 * Every page consumes this one hook, so the role branching lives in a single
 * place instead of being repeated per page.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth-context'
import { useBatches } from '../offline/aggregates/batches'
import { useTests } from '../offline/aggregates/tests'
import type { Batch, Test } from './putting'

export interface PuttingData {
  tests: Test[]
  batches: Batch[]
  /** Non-admins view the demo owner's data and cannot record or edit. */
  readOnly: boolean
  loading: boolean
  error: string | null
}

export function usePuttingData(): PuttingData {
  const { isAdmin } = useAuth()

  // Admin path: always subscribed, but only meaningful when isAdmin (a non-admin
  // engine is inert and returns empty).
  const adminTests = useTests()
  const adminBatches = useBatches()

  // Non-admin path: fetched once online.
  const [online, setOnline] = useState<{ tests: Test[]; batches: Batch[] }>({
    tests: [],
    batches: [],
  })
  const [loading, setLoading] = useState(!isAdmin)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAdmin) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [tRes, bRes] = await Promise.all([fetch('/api/tests'), fetch('/api/batches')])
        if (!tRes.ok) throw new Error(`Could not load tests (${tRes.status})`)
        if (!bRes.ok) throw new Error(`Could not load batches (${bRes.status})`)
        const tBody = (await tRes.json()) as { tests: Test[] }
        const bBody = (await bRes.json()) as { batches: Batch[] }
        if (!cancelled) {
          setOnline({ tests: tBody.tests, batches: bBody.batches })
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
    return { tests: adminTests, batches: adminBatches, readOnly: false, loading: false, error: null }
  }
  return { tests: online.tests, batches: online.batches, readOnly: true, loading, error }
}
