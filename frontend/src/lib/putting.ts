/**
 * Putting domain: the shared types, rules, and pure derivations.
 *
 * The two projections (tests, batches) are the source of truth; everything the
 * UI shows is derived from their rows by the helpers here. Keeping the types and
 * math in one dependency-free module lets the offline aggregates, the online read
 * path, and the pages all agree on the same rules without importing each other.
 */

/** A daily test as the server projection returns it (see backend/projections/tests.py). */
export interface Test {
  test_id: string
  test_date: string // local calendar day, YYYY-MM-DD
}

/** A putt batch as the server projection returns it (see backend/projections/batches.py). */
export interface Batch {
  batch_id: string
  kind: 'free' | 'test'
  test_id: string | null
  distance: number
  batch_size: number
  made: number
  created_at: string
}

// Free putts: any distance in this range, any batch size.
export const FREE_MIN = 10
export const FREE_MAX = 60
export const FREE_DEFAULT_BATCH = 10

// The daily test: 5 putts from every distance in [TEST_MIN, TEST_MAX] inclusive.
export const TEST_MIN = 12
export const TEST_MAX = 33
export const TEST_PUTTS = 5

/** Every distance a daily test covers, 12…33 ft inclusive (22 in all). */
export const TEST_DISTANCES: number[] = Array.from(
  { length: TEST_MAX - TEST_MIN + 1 },
  (_, i) => TEST_MIN + i,
)

/**
 * The device-local calendar day as YYYY-MM-DD. The daily test is keyed on this,
 * so it rolls over at local midnight without any server or timezone knowledge.
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today's daily test for this user, if one has been started. */
export function findTest(tests: Test[], day: string = localDay()): Test | undefined {
  return tests.find((t) => t.test_date === day)
}

/** The batches belonging to a given daily test. */
export function testBatches(batches: Batch[], testId: string | null): Batch[] {
  if (!testId) return []
  return batches.filter((b) => b.kind === 'test' && b.test_id === testId)
}

/**
 * Distances a test still owes: the 12…33 set minus those already recorded. A test
 * that hasn't started yet (no id) owes them all.
 */
export function remainingTestDistances(batches: Batch[], testId: string | null): number[] {
  const done = new Set(testBatches(batches, testId).map((b) => b.distance))
  return TEST_DISTANCES.filter((d) => !done.has(d))
}

/** Constrain a number to the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A uniformly random element, or undefined when the list is empty. */
export function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}

export interface DistanceStat {
  distance: number
  made: number
  attempts: number
  pct: number // 0–100
}

/**
 * Make percentage per distance across all batches, free and test combined,
 * sorted by distance. This is what the stats line chart plots.
 */
export function statsByDistance(batches: Batch[]): DistanceStat[] {
  const by = new Map<number, { made: number; attempts: number }>()
  for (const b of batches) {
    const agg = by.get(b.distance) ?? { made: 0, attempts: 0 }
    agg.made += b.made
    agg.attempts += b.batch_size
    by.set(b.distance, agg)
  }
  return [...by.entries()]
    .map(([distance, { made, attempts }]) => ({
      distance,
      made,
      attempts,
      pct: attempts ? (100 * made) / attempts : 0,
    }))
    .sort((a, b) => a.distance - b.distance)
}
