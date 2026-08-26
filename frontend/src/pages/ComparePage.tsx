/**
 * Compare — two players' make-%-by-distance, head to head.
 *
 * The same range control as the Leaderboard sets the window; two lookahead pickers
 * choose the players. Each line comes from the range-filtered leaderboard read
 * (useLeaderboard), which already carries every player's by-distance breakdown, so
 * switching players or range needs no extra request. No global-average line.
 */
import { useMemo, useState } from 'react'
import { useLeaderboard } from '../lib/useLeaderboard'
import { useUsers } from '../lib/useUserHistory'
import { windowFor, type Range } from '../lib/range'
import { seriesColor } from '../lib/seriesColors'
import RangeControl from '../components/RangeControl'
import PlayerCombobox from '../components/PlayerCombobox'
import PuttingChart, { type SeriesSpec } from '../components/PuttingChart'
import './ComparePage.css'

function ComparePage() {
  const [range, setRange] = useState<Range>('today')
  const [sub1, setSub1] = useState<string | null>(null)
  const [sub2, setSub2] = useState<string | null>(null)

  const { users } = useUsers()
  const { start, end } = useMemo(() => windowFor(range), [range])
  const { entries, loading, error } = useLeaderboard(start, end)

  // sub -> that player's range-filtered stats and overall %, for quick lookup.
  const bySub = useMemo(() => new Map(entries.map((e) => [e.sub, e])), [entries])

  // One series per chosen player, in a fixed color slot; a player with no data in
  // the range contributes an empty (undrawn) line rather than vanishing.
  const picks: { sub: string | null; slot: number }[] = [
    { sub: sub1, slot: 0 },
    { sub: sub2, slot: 1 },
  ]
  const chosen = picks.filter((p): p is { sub: string; slot: number } => p.sub != null)
  const series: SeriesSpec[] = chosen.map(({ sub, slot }) => ({
    id: sub,
    label: users.find((u) => u.sub === sub)?.name ?? '',
    color: seriesColor(slot),
    stats: bySub.get(sub)?.stats ?? [],
  }))

  return (
    <section className="page compare">
      <div className="page-head">
        <h1>Compare</h1>
      </div>

      <RangeControl range={range} name="compare-range" onChange={setRange} />

      <div className="panel compare-pickers">
        <PlayerCombobox
          users={users}
          value={sub1}
          onChange={setSub1}
          exclude={sub2}
          label="Player 1"
        />
        <PlayerCombobox
          users={users}
          value={sub2}
          onChange={setSub2}
          exclude={sub1}
          label="Player 2"
        />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="panel chart-panel">
        {/* Always render the chart (empty = just axes) so the page doesn't shift
            as players are chosen. */}
        <PuttingChart series={series} />

        {chosen.length > 0 && (
          <ul className="compare-legend" aria-label="Players compared">
            {chosen.map(({ sub, slot }) => {
              const entry = bySub.get(sub)
              const name = users.find((u) => u.sub === sub)?.name ?? ''
              return (
                <li key={sub}>
                  <span className="legend-swatch" style={{ background: seriesColor(slot) }} aria-hidden="true" />
                  <span className="legend-name">{name}</span>
                  <span className="legend-pct">
                    {entry ? `${Math.round(entry.overall_pct)}%` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {!loading && chosen.length > 0 && series.every((s) => s.stats.length === 0) && (
          <p className="muted compare-empty">No putts in this range for the chosen players.</p>
        )}
      </div>
    </section>
  )
}

export default ComparePage
