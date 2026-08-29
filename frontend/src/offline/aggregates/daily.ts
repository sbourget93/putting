/**
 * Shared fetch for the compact Daily Putts payload (GET /api/daily).
 *
 * Three offline aggregates (tests, batches, baseline) each read one slice of this
 * one small, bounded response, and the online (non-admin) path reads it too. They
 * fire at the same moment, so a short in-flight dedupe collapses their concurrent
 * reads into a single round-trip instead of three identical ones.
 *
 * Bounded by design: only the current day's test and batches plus the all-time
 * make-%-by-distance baseline — never the full batch log — so nothing here grows
 * with history, no matter how long someone has been putting.
 */
import { fetchWithTimeout } from '../../lib/http'
import { localDay, type Batch, type DistanceStat, type Test } from '../../lib/putting'

export interface DailyPayload {
  version: number
  test: Test | null
  today_batches: Batch[]
  baseline: DistanceStat[]
}

/** Normalize a raw server batch row into a Batch (guards the loosely-typed JSON). */
export function toBatch(raw: Batch): Batch {
  return {
    batch_id: raw.batch_id,
    test_id: raw.test_id ?? null,
    distance: raw.distance,
    batch_size: raw.batch_size,
    made: raw.made,
    created_at: raw.created_at,
  }
}

let inflight: { day: string; at: number; promise: Promise<DailyPayload> } | null = null

/** Today's compact daily payload, deduped across concurrent callers. */
export function fetchDaily(): Promise<DailyPayload> {
  const day = localDay()
  const now = Date.now()
  // Same day and within a tick of another call: share the in-flight request.
  if (inflight && inflight.day === day && now - inflight.at < 200) return inflight.promise
  const promise = (async () => {
    const res = await fetchWithTimeout(`/api/daily?day=${encodeURIComponent(day)}`)
    if (!res.ok) throw new Error(`fetch daily failed: ${res.status}`)
    return (await res.json()) as DailyPayload
  })()
  inflight = { day, at: now, promise }
  return promise
}
