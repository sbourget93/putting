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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSync } from '../offline/SyncContext'
import { usePutts } from '../offline/aggregates/putts'
import { useUserSettings } from '../offline/aggregates/userSettings'
import { newEvent } from '../offline/commands'
import type { CommandEvent } from '../offline/types'
import { usePuttingData } from '../lib/usePuttingData'
import StatsChartPanel from '../components/StatsChartPanel'
import PuttEditModal from '../components/PuttEditModal'
import PuttDeleteModal from '../components/PuttDeleteModal'
import MissPrompt from '../components/MissPrompt'
import MissEditModal from '../components/MissEditModal'
import {
  MISS_GLYPH,
  MISS_LABELS,
  MESSAGE_MAX_LENGTH,
  TEST_PUTTS,
  TRACK_MISSES,
  localDay,
  nextTestDistance,
  overallPct,
  overallPctFromStats,
  remainingTestDistances,
  testBatches,
  type Batch,
  type MissType,
  type Putt,
} from '../lib/putting'
import './DailyTestPage.css'

function DailyTestPage() {
  const { enqueue } = useSync()
  const putts = usePutts()
  const settings = useUserSettings()
  const { test, todayBatches, baselineStats, readOnly, loading, error } = usePuttingData()
  const [editing, setEditing] = useState<Batch | null>(null)
  const [deleting, setDeleting] = useState<Batch | null>(null)

  // Opt-in miss tracking swaps the count buttons for the per-putt miss entry. The
  // setting is a writer's own preference, so a read-only viewer never has it set.
  const trackMisses = settings.find((s) => s.name === TRACK_MISSES)?.value ?? false

  const today = localDay()
  const testId = test?.test_id ?? null

  const remaining = useMemo(
    () => remainingTestDistances(todayBatches, testId),
    [todayBatches, testId],
  )
  const todays = useMemo(() => testBatches(todayBatches, testId), [todayBatches, testId])

  // The miss directions per batch, for the summary's miss icons. Only misses with a
  // known direction count: a count-mode user's misses have no miss_type, so their
  // batches simply show no icons. Exact putt order doesn't matter here.
  const missesByBatch = useMemo(() => {
    const map: Record<string, MissType[]> = {}
    for (const p of putts) {
      if (p.made || !p.miss_type) continue
      ;(map[p.batch_id] ??= []).push(p.miss_type)
    }
    return map
  }, [putts])

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

  // Distances submitted but not yet confirmed in the folded snapshot. Rapid taps
  // fire several clicks before React re-renders with the new batch, so `current`
  // (and, on the first putt, `testId`) are momentarily stale; without this guard a
  // double-tap records the same slot twice and can start two tests. A distance is
  // released only once the snapshot *confirms* it (never on absence — that is the
  // in-flight window itself), so the snapshot dropping it later (a delete) frees it
  // to be recorded again.
  const recordedRef = useRef<Set<number>>(new Set())
  const doneDistances = useMemo(() => new Set(todays.map((b) => b.distance)), [todays])
  useEffect(() => {
    for (const d of [...recordedRef.current]) {
      if (doneDistances.has(d)) recordedRef.current.delete(d)
    }
  }, [doneDistances])

  // Record the current distance's batch and its putts in one atomic command. The
  // made count is derived from the putts, so BatchRecorded and its PuttRecorded rows
  // always agree. Starts today's test first if this is the day's first putt.
  function recordBatch(
    puttData: { made: boolean; number: number | null; miss_type: MissType | null }[],
  ) {
    if (current == null) return
    // Already recorded (snapshot has it) or in flight (tapped, awaiting confirm).
    if (doneDistances.has(current) || recordedRef.current.has(current)) return
    recordedRef.current.add(current)
    const events: CommandEvent[] = []
    let id = testId
    if (!id) {
      id = crypto.randomUUID()
      events.push(newEvent('TestStarted', id, { test_date: today }))
    }
    const batchId = crypto.randomUUID()
    events.push(
      newEvent('BatchRecorded', batchId, {
        test_id: id,
        distance: current,
        batch_size: TEST_PUTTS,
        made: puttData.filter((p) => p.made).length,
      }),
    )
    for (const p of puttData) {
      events.push(
        newEvent('PuttRecorded', crypto.randomUUID(), {
          batch_id: batchId,
          made: p.made,
          number: p.number,
          miss_type: p.miss_type,
        }),
      )
    }
    enqueue(events)
  }

  // Count mode: the user gives only a made count, so the first `made` putts are made
  // and the rest missed. Position and direction are unknown, so number/miss_type
  // stay null (shadow putts) — see documentation/models/projections/putts.md.
  function record(made: number) {
    recordBatch(
      Array.from({ length: TEST_PUTTS }, (_, i) => ({
        made: i < made,
        number: null,
        miss_type: null,
      })),
    )
  }

  // Miss mode: the user marks each putt made or missed and, for a miss, where. The
  // putt's number is its slot position (1-based), filled in for an opted-in user.
  function recordMisses(puttData: { made: boolean; miss_type: MissType | null }[]) {
    recordBatch(puttData.map((p, i) => ({ made: p.made, number: i + 1, miss_type: p.miss_type })))
  }

  // A batch's putts in a stable order so edit/delete target them deterministically,
  // and so the editor shows them left-to-right by position. Miss-tracked putts carry
  // a 1-5 number, which drives the order; older shadow putts have none and fall back
  // to putt_id (as good as any, since they're indistinguishable). Empty for batches
  // recorded before putts existed.
  function puttsForBatch(batchId: string): Putt[] {
    return putts
      .filter((p) => p.batch_id === batchId)
      .sort((a, b) => {
        if (a.number != null && b.number != null) return a.number - b.number
        if (a.number != null) return -1
        if (b.number != null) return 1
        return a.putt_id.localeCompare(b.putt_id)
      })
  }

  // Fat-finger correction: rewrite one batch's made count in place. Distance and
  // size are fixed test slots, so they carry through unchanged.
  function saveEdit(made: number) {
    if (!editing) return
    const events: CommandEvent[] = [
      newEvent('BatchEdited', editing.batch_id, {
        distance: editing.distance,
        batch_size: editing.batch_size,
        made,
      }),
    ]
    // Reconcile the shadow putts to the new count: the first `made` are made, the
    // rest misses. Only emit for a putt whose made value actually changes.
    puttsForBatch(editing.batch_id).forEach((p, i) => {
      const shouldMake = i < made
      if (p.made !== shouldMake) {
        events.push(
          newEvent('PuttEdited', p.putt_id, {
            made: shouldMake,
            number: p.number,
            miss_type: p.miss_type,
          }),
        )
      }
    })
    enqueue(events)
  }

  // Miss-mode correction: the user re-marks each putt (made, or missed and where).
  // The new made count reconciles the batch; a PuttEdited goes out only for a putt
  // whose made or direction actually changed. number is fixed, so it carries through.
  function saveMissEdit(
    updated: { putt_id: string; made: boolean; miss_type: MissType | null }[],
  ) {
    if (!editing) return
    const before = new Map(puttsForBatch(editing.batch_id).map((p) => [p.putt_id, p]))
    const events: CommandEvent[] = [
      newEvent('BatchEdited', editing.batch_id, {
        distance: editing.distance,
        batch_size: editing.batch_size,
        made: updated.filter((p) => p.made).length,
      }),
    ]
    for (const p of updated) {
      const prev = before.get(p.putt_id)
      if (!prev) continue
      if (prev.made !== p.made || prev.miss_type !== p.miss_type) {
        events.push(
          newEvent('PuttEdited', p.putt_id, {
            made: p.made,
            number: prev.number,
            miss_type: p.miss_type,
          }),
        )
      }
    }
    enqueue(events)
  }

  // Remove a recorded putt, after the confirm dialog. The server stamps the owner,
  // so the event needs no payload. Deleting frees that distance's slot, so it
  // re-enters the prompt queue and can be recorded again.
  function deletePutt() {
    if (!deleting) return
    const events: CommandEvent[] = [newEvent('BatchDeleted', deleting.batch_id)]
    // Soft-delete the batch's shadow putts alongside it (owner stamped server-side).
    for (const p of puttsForBatch(deleting.batch_id)) {
      events.push(newEvent('PuttDeleted', p.putt_id))
    }
    enqueue(events)
    setDeleting(null)
  }

  // Save (or clear) the day's message. Only reachable once the test exists, so
  // testId is set; the server caps the length and the input bounds it too.
  function saveMessage(message: string) {
    if (!testId) return
    enqueue([newEvent('TestMessageSet', testId, { message })])
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
          <span className="progress-pill">
            {remaining.length} {remaining.length === 1 ? 'batch' : 'batches'} remaining
          </span>
        )}
      </div>

      {readOnly && (
        <p className="muted read-only-note">
          Sign in to record your putts. Feel free to explore the rest of the app in the meantime!
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {complete && (
        <CompleteSummary todayPct={overallPct(todays)} lifetimePct={lifetimePct}>
          {!readOnly && testId && (
            <MessageInput message={test?.message ?? ''} onSave={saveMessage} />
          )}
        </CompleteSummary>
      )}

      <StatsChartPanel
        title="Today's Putts"
        batches={todays}
        baselineStats={baselineStats}
        emptyNote="No putts recorded yet today."
        alwaysRenderChart
        faded={readOnly}
      />

      {!complete && (
        <div className={readOnly ? 'panel prompt prompt-readonly' : 'panel prompt'}>
          <p className="prompt-label">Take {TEST_PUTTS} putts from</p>
          <p className="prompt-distance">
            {current} <span className="unit">ft</span>
          </p>
          {trackMisses ? (
            // Keyed on the distance so each new prompt starts from a clean
            // five-made slate instead of carrying the last distance's misses.
            <MissPrompt
              key={current ?? 'done'}
              distance={current as number}
              disabled={readOnly}
              onRecord={recordMisses}
            />
          ) : (
            <>
              <p className="prompt-sub">How many did you make?</p>
              <div className="made-buttons">
                {Array.from({ length: TEST_PUTTS + 1 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    className="made-btn"
                    disabled={readOnly}
                    onClick={() => record(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {todays.length > 0 && (
        <TodayBatches
          batches={todays}
          missesByBatch={missesByBatch}
          editable={!readOnly}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      {editing &&
        (trackMisses ? (
          // Edit mode follows the user's current preference, not how the batch was
          // originally recorded: a miss-tracker always gets the per-putt editor.
          <MissEditModal
            batch={editing}
            putts={puttsForBatch(editing.batch_id)}
            onClose={() => setEditing(null)}
            onSave={saveMissEdit}
          />
        ) : (
          <PuttEditModal batch={editing} onClose={() => setEditing(null)} onPick={saveEdit} />
        ))}

      {deleting && (
        <PuttDeleteModal
          batch={deleting}
          onConfirm={deletePutt}
          onCancel={() => setDeleting(null)}
        />
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
  children,
}: {
  todayPct: number | null
  lifetimePct: number | null
  children?: ReactNode
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
      {children}
    </div>
  )
}

/**
 * The day's optional message, at the bottom of the complete-summary panel. It
 * appears beside the player's score on the daily leaderboard. Edits are kept
 * locally while the field is focused and committed on blur, so a save fires once
 * per edit rather than on every keystroke. An empty value clears the note.
 */
function MessageInput({ message, onSave }: { message: string; onSave: (message: string) => void }) {
  const [draft, setDraft] = useState(message)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Re-seed from the snapshot when it changes under us (a sync, another device),
  // but only while the field isn't being edited, so typing is never clobbered.
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(message)
  }, [message])

  // Grow the box to fit its content: start from one line and expand as the message
  // wraps. Reset to auto first so it shrinks back when text is removed.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function commit() {
    editing.current = false
    const next = draft.trim()
    if (next !== message.trim()) onSave(next)
  }

  return (
    <div className="daily-message">
      <textarea
        ref={inputRef}
        className="daily-message-input"
        aria-label="Add a message to your daily leaderboard score"
        value={draft}
        maxLength={MESSAGE_MAX_LENGTH}
        rows={1}
        placeholder="Add a message!"
        onFocus={() => {
          editing.current = true
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

/**
 * Each recorded batch today, by distance, with a pencil to correct a fat-fingered
 * count and a trash can to remove it. Both actions are writer-only (`canWrite`);
 * read-only viewers don't see them.
 */
function TodayBatches({
  batches,
  missesByBatch,
  editable,
  onEdit,
  onDelete,
}: {
  batches: Batch[]
  missesByBatch: Record<string, MissType[]>
  editable: boolean
  onEdit: (batch: Batch) => void
  onDelete: (batch: Batch) => void
}) {
  const ordered = [...batches].sort((a, b) => a.distance - b.distance)
  return (
    <div className="panel today-batches">
      <h2 className="section-title">Today's putts</h2>
      <ul className="batch-lines">
        {ordered.map((b) => {
          const misses = missesByBatch[b.batch_id] ?? []
          return (
          <li key={b.batch_id} className="batch-line">
            <span className="batch-line-dist">{b.distance}′</span>
            <span className="batch-line-made">{b.made}/{b.batch_size}</span>
            <span
              className="batch-line-misses"
              aria-label={
                misses.length
                  ? `Missed ${misses.map((m) => MISS_LABELS[m].toLowerCase()).join(', ')}`
                  : undefined
              }
            >
              {misses.map((m, i) => (
                <span key={i} className="miss-icon" aria-hidden="true">
                  {MISS_GLYPH[m]}
                </span>
              ))}
            </span>
            {editable && (
              <span className="batch-line-actions">
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
                <button
                  type="button"
                  className="batch-delete-btn"
                  aria-label={`Delete ${b.distance} ft putt`}
                  onClick={() => onDelete(b)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </button>
              </span>
            )}
          </li>
          )
        })}
      </ul>
    </div>
  )
}

export default DailyTestPage
