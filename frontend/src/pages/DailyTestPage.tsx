/**
 * Daily Test — the home page.
 *
 * The test is 5 putts from every distance 12–33 ft. On each visit we compute what
 * distances remain for today (from the batches referencing today's test) and prompt
 * a random one until none are left, at which point the day is complete. Recording
 * the first putt of the day starts today's test (TestStarted) and records the putt
 * (BatchRecorded) in one atomic command, so the test always exists before a batch
 * points at it.
 *
 * Non-admins see the demo owner's progress, read-only.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSync } from '../offline/SyncContext'
import { newEvent } from '../offline/commands'
import type { CommandEvent } from '../offline/types'
import { usePuttingData } from '../lib/usePuttingData'
import StatsChartPanel from '../components/StatsChartPanel'
import {
  TEST_DISTANCES,
  TEST_PUTTS,
  findTest,
  localDay,
  pickRandom,
  remainingTestDistances,
  testBatches,
} from '../lib/putting'
import './DailyTestPage.css'

function DailyTestPage() {
  const { enqueue } = useSync()
  const { tests, batches, readOnly, loading, error } = usePuttingData()

  const today = localDay()
  const test = findTest(tests, today)
  const testId = test?.test_id ?? null

  const remaining = useMemo(
    () => remainingTestDistances(batches, testId),
    [batches, testId],
  )
  const todays = useMemo(() => testBatches(batches, testId), [batches, testId])
  const doneCount = TEST_DISTANCES.length - remaining.length

  // The prompted distance stays put across re-renders and only re-rolls once the
  // current one has been recorded (so it drops out of `remaining`).
  const [current, setCurrent] = useState<number | null>(null)
  useEffect(() => {
    setCurrent((cur) => (cur != null && remaining.includes(cur) ? cur : pickRandom(remaining) ?? null))
  }, [remaining])

  function record(made: number) {
    if (current == null) return
    const events: CommandEvent[] = []
    let id = testId
    if (!id) {
      id = crypto.randomUUID()
      events.push(newEvent('TestStarted', id, { test_date: today }))
    }
    events.push(
      newEvent('BatchRecorded', crypto.randomUUID(), {
        kind: 'test',
        test_id: id,
        distance: current,
        batch_size: TEST_PUTTS,
        made,
      }),
    )
    enqueue(events)
  }

  if (loading) return <section className="page"><p className="muted">Loading…</p></section>

  const complete = remaining.length === 0

  return (
    <section className="page daily-test">
      <div className="page-head">
        <h1>Daily Test</h1>
        <span className="progress-pill">{doneCount} / {TEST_DISTANCES.length}</span>
      </div>

      {readOnly && <p className="muted read-only-note">Viewing the demo. Sign in as an admin to record your own.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <StatsChartPanel
        title="Today's test"
        batches={todays}
        emptyNote="No daily-test putts yet today."
      />

      {complete ? (
        <div className="panel complete">
          <p className="complete-head">Daily test complete for today ✓</p>
          <p className="muted">Resets tomorrow. Here's how today went:</p>
          <ResultsGrid batches={todays} />
        </div>
      ) : readOnly ? (
        <div className="panel">
          <p className="muted">
            {doneCount === 0
              ? "Today's test hasn't been started yet."
              : `${remaining.length} distance${remaining.length === 1 ? '' : 's'} still to go today.`}
          </p>
          {doneCount > 0 && <ResultsGrid batches={todays} />}
        </div>
      ) : (
        <div className="panel prompt">
          <p className="prompt-label">Putt {TEST_PUTTS} from</p>
          <p className="prompt-distance">
            {current} <span className="unit">ft</span>
          </p>
          <p className="prompt-sub">How many did you make?</p>
          <div className="made-buttons">
            {Array.from({ length: TEST_PUTTS + 1 }, (_, n) => (
              <button key={n} type="button" className="made-btn" onClick={() => record(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** A compact 12–33 grid showing made/5 for each recorded distance today. */
function ResultsGrid({ batches }: { batches: { distance: number; made: number }[] }) {
  const byDistance = new Map(batches.map((b) => [b.distance, b.made]))
  return (
    <ul className="results-grid">
      {TEST_DISTANCES.map((d) => {
        const made = byDistance.get(d)
        return (
          <li key={d} className={made === undefined ? 'result pending' : 'result done'}>
            <span className="result-dist">{d}′</span>
            <span className="result-made">{made === undefined ? '—' : `${made}/${TEST_PUTTS}`}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default DailyTestPage
