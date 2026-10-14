/**
 * Leaderboard — players ranked by daily-test make %, across three boards:
 *
 * - Daily: one day's test, defaulting to today. A date picker steps through (or
 *   drops down) every day that has a completed test; "today"/"yesterday" are named,
 *   other days show their date.
 * - Average: each player's last 50 tests from the past year, pooled.
 * - Best: each player's single best test ever.
 *
 * Tapping a player expands their make-%-by-distance graph for that board. All reads
 * are online (see useLeaderboard): the board spans every player, so there is nothing
 * to fold from the local cache.
 *
 * On today's Daily board, players who have started but not finished today's test
 * show at the bottom with a caution sign instead of a rank. That only makes sense
 * for today; a past day's unfinished test is abandoned, so in-progress is hidden there.
 */
import { useState } from 'react'
import { useLeaderboard } from '../lib/useLeaderboard'
import { MODE_BLURB, formatDay, type LeaderboardMode } from '../lib/leaderboard'
import { localDay } from '../lib/putting'
import ModeControl from '../components/ModeControl'
import DayPicker from '../components/DayPicker'
import PuttingChart, { type SeriesSpec } from '../components/PuttingChart'
import './LeaderboardPage.css'

/** Caution triangle shown in the rank slot for a mid-round player. */
function CautionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M12 3 1.5 21h21z M12 10v5 M12 18h.01"
      />
    </svg>
  )
}

function LeaderboardPage() {
  const [mode, setMode] = useState<LeaderboardMode>('daily')
  const [day, setDay] = useState<string>(() => localDay())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { entries, inProgress, days, loading, error } = useLeaderboard(mode, day)

  // In-progress players only make sense for today's Daily board.
  const today = localDay()
  const showInProgress = mode === 'daily' && day === today
  const pending = showInProgress ? inProgress : []
  const blurb = MODE_BLURB[mode]

  // Today is always offered, even before anyone has putted: `days` lists only dates
  // with a completed test, so prepend today when it isn't there yet (it is newest).
  const pickerDays = days.includes(today) ? days : [today, ...days]

  function toggle(sub: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sub)) next.delete(sub)
      else next.add(sub)
      return next
    })
  }

  return (
    <section className="page leaderboard">
      <div className="page-head">
        <h1>Leaderboard</h1>
      </div>

      {/* Mode picker, date picker, and description share one bordered card. The
          second row keeps a fixed height across modes so the board below never
          shifts when you switch. */}
      <div className="board-controls">
        <ModeControl
          mode={mode}
          onChange={(m) => {
            setMode(m)
            setExpanded(new Set())
          }}
        />
        <div className="board-controls-sub">
          {mode === 'daily' ? (
            <DayPicker
              day={day}
              days={pickerDays}
              onChange={(d) => {
                setDay(d)
                setExpanded(new Set())
              }}
            />
          ) : (
            <p className="board-blurb">{blurb}</p>
          )}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 && pending.length === 0 ? (
        <div className="panel">
          <p className="muted">
            {mode === 'daily' ? 'No completed tests for this day yet.' : 'No scores yet.'}
          </p>
        </div>
      ) : (
        <ol className="board-list">
          {entries.map((entry, i) => {
            const isOpen = expanded.has(entry.sub)
            const series: SeriesSpec[] = [
              {
                id: entry.sub,
                label: entry.name,
                color: 'var(--brand)',
                stats: entry.stats,
                emphasis: true,
              },
            ]
            return (
              <li key={entry.sub} className="board-entry">
                <button
                  type="button"
                  className="board-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(entry.sub)}
                >
                  <span className="board-rank">{i + 1}</span>
                  {entry.picture && (
                    <img className="board-avatar" src={entry.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="board-name">{entry.name}</span>
                  {mode === 'average' && entry.sessions != null && (
                    <span className="board-sub">
                      {entry.sessions} {entry.sessions === 1 ? 'session' : 'sessions'} included
                    </span>
                  )}
                  {mode === 'best' && entry.date && (
                    <span className="board-sub">{formatDay(entry.date)}</span>
                  )}
                  <span className="board-pct">{Math.round(entry.overall_pct)}%</span>
                </button>

                {isOpen && (
                  <div className="entry-detail">
                    <div className="panel chart-panel">
                      <PuttingChart series={series} />
                    </div>
                  </div>
                )}
              </li>
            )
          })}

          {/* Mid-round players, pinned below the ranked board: no rank or score
              yet, a caution and how many batches remain instead. Tapping one opens
              their partial make-%-by-distance line, like a ranked row. */}
          {pending.map((p) => {
            const isOpen = expanded.has(p.sub)
            const series: SeriesSpec[] = [
              { id: p.sub, label: p.name, color: 'var(--brand)', stats: p.stats, emphasis: true },
            ]
            return (
              <li key={p.sub} className="board-entry">
                <button
                  type="button"
                  className="board-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(p.sub)}
                >
                  <span className="board-rank" aria-hidden="true" />
                  {p.picture && (
                    <img className="board-avatar" src={p.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="board-name">{p.name}</span>
                  <span className="board-remaining">
                    <CautionIcon />
                    {p.remaining} {p.remaining === 1 ? 'batch' : 'batches'} remaining
                  </span>
                </button>

                {isOpen && (
                  <div className="entry-detail">
                    <div className="panel chart-panel">
                      <PuttingChart series={series} />
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export default LeaderboardPage
