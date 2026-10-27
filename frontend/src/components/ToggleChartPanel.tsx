/**
 * The Daily Putts top panel: a make-%-by-distance chart with an optional
 * Putts / Misses switch.
 *
 * When the player tracks misses, a segmented toggle swaps the chart for their miss
 * heat map. The chart keeps its natural proportions (the same size it has with no
 * miss tracking), and the square heat map scales down to fit that same box, so
 * toggling never resizes the panel (see ToggleChartPanel.css). Without miss
 * tracking it's just the chart.
 *
 * Presentational: the caller supplies the primary series (raw `batches` or
 * pre-aggregated `stats`), the all-time `baselineStats` comparison line, and the
 * miss counts. Used by both the Daily Putts page (today vs the player's all-time)
 * and the Leaderboard's expanded rows (a player's board result vs their all-time),
 * so the two read identically.
 */
import { useState } from 'react'
import StatsChartPanel from './StatsChartPanel'
import MissHeatBasket from './MissHeatBasket'
import type { Batch, DistanceStat, MissType } from '../lib/putting'
import './ToggleChartPanel.css'

export default function ToggleChartPanel({
  seriesLabel,
  batches,
  stats,
  baselineStats,
  baselineLabel = 'All-time',
  missCounts,
  missTotal,
  showMissToggle,
  emptyNote,
  faded = false,
  alwaysRenderChart = false,
}: {
  seriesLabel: string
  batches?: Batch[]
  stats?: DistanceStat[]
  baselineStats?: DistanceStat[]
  baselineLabel?: string
  missCounts: Partial<Record<MissType, number>>
  missTotal: number
  /** Show the Putts / Misses toggle. The caller decides what "tracks misses" means
   *  (a writer's setting on Daily Putts; any recorded misses on the Leaderboard). */
  showMissToggle: boolean
  emptyNote: string
  faded?: boolean
  alwaysRenderChart?: boolean
}) {
  const [view, setView] = useState<'putts' | 'misses'>('putts')

  if (!showMissToggle) {
    return (
      <StatsChartPanel
        batches={batches}
        stats={stats}
        baselineStats={baselineStats}
        baselineLabel={baselineLabel}
        seriesLabel={seriesLabel}
        emptyNote={emptyNote}
        alwaysRenderChart={alwaysRenderChart}
        faded={faded}
      />
    )
  }

  return (
    <div className={faded ? 'panel chart-panel chart-panel-faded' : 'panel chart-panel'}>
      <fieldset className="top-view-toggle">
        <legend>Chart view</legend>
        {(['putts', 'misses'] as const).map((v) => (
          <label key={v} className={view === v ? 'top-view-option active' : 'top-view-option'}>
            <input
              type="radio"
              name="top-view"
              value={v}
              checked={view === v}
              onChange={() => setView(v)}
            />
            {v === 'putts' ? 'Putts' : 'Misses'}
          </label>
        ))}
      </fieldset>
      {view === 'putts' ? (
        // Natural chart proportions — the same size it has with no miss tracking.
        // The Misses view below matches this box's height so the panel doesn't jump.
        <div className="top-view-chart">
          <StatsChartPanel
            embedded
            batches={batches}
            stats={stats}
            baselineStats={baselineStats}
            baselineLabel={baselineLabel}
            seriesLabel={seriesLabel}
            emptyNote={emptyNote}
            alwaysRenderChart
          />
        </div>
      ) : (
        // Always the basket, even with no misses yet: an empty map (no tints) reads
        // as "nowhere missed so far". The square map scales to fit the chart's box.
        <div className="top-view-misses">
          <div className="top-view-plot">
            <MissHeatBasket embedded counts={missCounts} total={missTotal} />
          </div>
        </div>
      )}
    </div>
  )
}
