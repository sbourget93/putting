/**
 * Leaderboard — players ranked by overall daily-test make %.
 *
 * A range control (Today / Last 30 days / All time, defaulting to Today) sets the
 * window; the list re-ranks for it. Tapping a player expands their make-%-by-
 * distance graph for that same range. All reads are online (see useLeaderboard):
 * the board spans every player, so there is nothing to fold from the local cache.
 *
 * On Today, players who have started but not finished today's test show at the
 * bottom with a caution sign instead of a rank, so you can see who is mid-round.
 */
import { useMemo, useState } from 'react'
import { useLeaderboard } from '../lib/useLeaderboard'
import { windowFor, type Range } from '../lib/range'
import RangeControl from '../components/RangeControl'
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
  const [range, setRange] = useState<Range>('today')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { start, end } = useMemo(() => windowFor(range), [range])
  // In-progress players only make sense for Today; end is today's local day there.
  const { entries, inProgress, loading, error } = useLeaderboard(
    start,
    end,
    range === 'today' ? end : undefined,
  )

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

      <RangeControl
        range={range}
        name="leaderboard-range"
        onChange={(r) => {
          setRange(r)
          setExpanded(new Set())
        }}
      />

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 && inProgress.length === 0 ? (
        <div className="panel"><p className="muted">No scores in this range yet.</p></div>
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
          {inProgress.map((p) => {
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
