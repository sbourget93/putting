/**
 * useResilientFetch — a single online read that recovers on its own.
 *
 * The profile and leaderboard data isn't held by the offline engine; each view
 * fetches it on demand. A plain one-shot fetch leaves the view blank until a manual
 * reload whenever a request blips or times out, since nothing retries it. This wraps
 * that one-shot read with three recoveries:
 *
 *  - it retries a transient failure a few times (small backoff) before giving up;
 *  - it refetches on reconnect (`online`) and when the app regains visibility, so a
 *    failed load heals without a reload;
 *  - a background refetch keeps the last good data on screen, surfacing an error only
 *    when there is nothing to fall back to.
 *
 * `fetcher` runs whenever `deps` change (like a useEffect dependency list). Pass a
 * stable mapping of its result in the caller. Cancellation on unmount / deps change
 * is by an ignore flag (the underlying fetchWithTimeout bounds the wait), matching
 * the hooks this replaces.
 */
import { useEffect, useRef, useState } from 'react'

const MAX_RETRIES = 2
const RETRY_BASE_MS = 1200

export interface ResilientResult<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useResilientFetch<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): ResilientResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Latest fetcher, so the reconnect/visibility listeners always call the current
  // closure without re-subscribing every render. dataRef mirrors `data` for the
  // "keep last good data on a background failure" decision.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const dataRef = useRef<T | null>(null)

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    // New key (deps changed): treat it as a fresh load, so a failure here surfaces an
    // error rather than silently keeping the previous key's data.
    dataRef.current = null

    const run = async (initial: boolean) => {
      if (inFlight || cancelled) return
      inFlight = true
      if (initial) setLoading(true)
      for (let tries = 0; ; tries++) {
        try {
          const result = await fetcherRef.current()
          if (!cancelled) {
            dataRef.current = result
            setData(result)
            setError(null)
            setLoading(false)
          }
          break
        } catch (cause) {
          if (cancelled) break
          if (tries < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (tries + 1)))
            if (cancelled) break
            continue
          }
          // Give up this run. Keep any data already on screen; only show an error
          // when there is nothing to fall back to.
          if (!cancelled) {
            if (dataRef.current == null) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
            setLoading(false)
          }
          break
        }
      }
      inFlight = false
    }

    void run(true)

    const onOnline = () => void run(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run(false)
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // deps is the caller's dependency list, intentionally spread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}
