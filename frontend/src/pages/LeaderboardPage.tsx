/**
 * Leaderboard — players ranked by overall daily-test make %.
 *
 * A range control (Today / Last 30 days / All time, defaulting to Today) sets the
 * window; the list re-ranks for it. Tapping a player expands their make-%-by-
 * distance graph for that same range. All reads are online (see useLeaderboard):
 * the board spans every player, so there is nothing to fold from the local cache.
 */
import { useMemo, useState } from 'react'
import { useLeaderboard } from '../lib/useLeaderboard'
import { windowFor, type Range } from '../lib/range'
import RangeControl from '../components/RangeControl'
import PuttingChart, { type SeriesSpec } from '../components/PuttingChart'
import './LeaderboardPage.css'

function LeaderboardPage() {
  const [range, setRange] = useState<Range>('today')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { start, end } = useMemo(() => windowFor(range), [range])
  const { entries, loading, error } = useLeaderboard(start, end)

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
      ) : entries.length === 0 ? (
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
        </ol>
      )}
    </section>
  )
}

export default LeaderboardPage
