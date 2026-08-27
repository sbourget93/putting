/**
 * Daily Test — the home page.
 *
 * The test is 5 putts from every distance 12–33 ft. The distance order is a
 * date-seeded shuffle (see nextTestDistance), so everyone practicing on the same
 * day faces the same distances in the same sequence. On each visit we prompt the
 * first distance in that order not yet recorded, until none are left and the day
 * is complete. Recording the first putt of the day starts today's test
 * (TestStarted) and records the putt (BatchRecorded) in one atomic command, so the
 * test always exists before a batch points at it.
 *
 * A signed-in writer records their own day; logged-out or read-only visitors see
 * a read-only day.
 */
import { useMemo, useState } from 'react'
import { useSync } from '../offline/SyncContext'
import { newEvent } from '../offline/commands'
import type { CommandEvent } from '../offline/types'
import { usePuttingData } from '../lib/usePuttingData'
import StatsChartPanel from '../components/StatsChartPanel'
import PuttEditModal from '../components/PuttEditModal'
import {
  TEST_DISTANCES,
  TEST_PUTTS,
  localDay,
  nextTestDistance,
  overallPct,
  overallPctFromStats,
  remainingTestDistances,
  testBatches,
  type Batch,
} from '../lib/putting'
import './DailyTestPage.css'

function DailyTestPage() {
  const { enqueue } = useSync()
  const { test, todayBatches, baselineStats, readOnly, loading, error } = usePuttingData()
  const [editing, setEditing] = useState<Batch | null>(null)

  const today = localDay()
  const testId = test?.test_id ?? null

  const remaining = useMemo(
    () => remainingTestDistances(todayBatches, testId),
    [todayBatches, testId],
  )
  const todays = useMemo(() => testBatches(todayBatches, testId), [todayBatches, testId])
  const doneCount = TEST_DISTANCES.length - remaining.length

  // Lifetime baseline arrives pre-aggregated by distance (excluding today), so the
  // summary and the chart's grey line compare today against history, not itself.
  const lifetimePct = useMemo(() => overallPctFromStats(baselineStats), [baselineStats])

  // The prompted distance is a pure function of the date-seeded order and what's
  // been recorded, so it needs no local state: it's the first distance today's
  // order still owes.
  const current = useMemo(
    () => nextTestDistance(todayBatches, testId, today) ?? null,
    [todayBatches, testId, today],
  )

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

  // Fat-finger correction: rewrite one batch's made count in place. Distance and
  // size are fixed test slots, so they carry through unchanged.
  function saveEdit(made: number) {
    if (!editing) return
    enqueue([
      newEvent('BatchEdited', editing.batch_id, {
        distance: editing.distance,
        batch_size: editing.batch_size,
        made,
      }),
    ])
  }

  if (loading) return <section className="page"><p className="muted">Loading…</p></section>

  const complete = remaining.length === 0

  return (
    <section className="page daily-test">
      <div className="page-head">
        <h1>Daily Putts</h1>
        {complete ? (
          <span className="progress-pill complete-pill">Complete</span>
        ) : (
          <span className="progress-pill">{doneCount} / {TEST_DISTANCES.length}</span>
        )}
      </div>

      {readOnly && <p className="muted read-only-note">Viewing read-only. Sign in to record your own.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {complete && <CompleteSummary todayPct={overallPct(todays)} lifetimePct={lifetimePct} />}

      <StatsChartPanel
        title="Today's Putts"
        batches={todays}
        baselineStats={baselineStats}
        emptyNote="No putts recorded yet today."
      />

      {!complete &&
        (readOnly ? (
          <div className="panel">
            <p className="muted">
              {doneCount === 0
                ? "Today's test hasn't been started yet."
                : `${remaining.length} distance${remaining.length === 1 ? '' : 's'} still to go today.`}
            </p>
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
        ))}

      {todays.length > 0 && (
        <TodayBatches batches={todays} editable={!readOnly} onEdit={setEditing} />
      )}

      {editing && (
        <PuttEditModal batch={editing} onClose={() => setEditing(null)} onPick={saveEdit} />
      )}
    </section>
  )
}

/**
 * The end-of-day summary: today's overall test make percentage, and how it
 * compares to the lifetime average. The panel tints green when today beats the
 * baseline and red when it trails.
 */
function CompleteSummary({
  todayPct,
  lifetimePct,
}: {
  todayPct: number | null
  lifetimePct: number | null
}) {
  const today = Math.round(todayPct ?? 0)
  const hasBaseline = lifetimePct != null
  const lifetime = hasBaseline ? Math.round(lifetimePct) : null
  const diff = hasBaseline ? today - (lifetime as number) : 0
  const tone = !hasBaseline ? 'neutral' : diff >= 0 ? 'up' : 'down'

  return (
    <div className={`panel complete summary summary-${tone}`}>
      <p className="summary-pct">C1X putting percentage: {today}%</p>
      {hasBaseline && (
        <p className="summary-compare">
          {diff === 0
            ? `On par with your lifetime average of ${lifetime}%`
            : `${Math.abs(diff)}% ${diff > 0 ? 'better' : 'worse'} than your lifetime average of ${lifetime}%`}
        </p>
      )}
    </div>
  )
}

/**
 * Each recorded batch today, by distance, with a pencil to correct a fat-fingered
 * count. The pencil is admin-only; the demo view is read-only.
 */
function TodayBatches({
  batches,
  editable,
  onEdit,
}: {
  batches: Batch[]
  editable: boolean
  onEdit: (batch: Batch) => void
}) {
  const ordered = [...batches].sort((a, b) => a.distance - b.distance)
  return (
    <div className="panel today-batches">
      <h2 className="section-title">Today's putts</h2>
      <ul className="batch-lines">
        {ordered.map((b) => (
          <li key={b.batch_id} className="batch-line">
            <span className="batch-line-dist">{b.distance}′</span>
            <span className="batch-line-made">{b.made}/{b.batch_size}</span>
            {editable && (
              <button
                type="button"
                className="batch-edit-btn"
                aria-label={`Edit ${b.distance} ft putt`}
                onClick={() => onEdit(b)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default DailyTestPage
