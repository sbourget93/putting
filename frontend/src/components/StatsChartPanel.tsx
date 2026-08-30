/**
 * A titled panel wrapping the make-percentage-by-distance chart.
 *
 * Presentational: the caller passes an already-scoped set of batches (today's
 * test, all-time, …) and a title. An optional `baseline` set is drawn as a grey
 * dashed comparison line behind the primary one, with a one-line legend beneath
 * the chart. By default it shows a note instead of an empty chart when the set has
 * no putts; pass `alwaysRenderChart` to keep the axes (and any baseline line) on
 * screen regardless, so the frame doesn't blink in and out as putts arrive.
 */
import type { ReactNode } from 'react'
import { statsByDistance, type Batch, type DistanceStat } from '../lib/putting'
import PuttingChart, { type SeriesSpec } from './PuttingChart'

const BRAND = 'var(--brand)'
const BASELINE = 'color-mix(in srgb, CanvasText 30%, Canvas)'

export default function StatsChartPanel({
  title,
  batches,
  emptyNote,
  baseline,
  baselineStats: baselineStatsProp,
  baselineLabel = 'All-time',
  seriesLabel = 'Today',
  alwaysRenderChart = false,
  faded = false,
  compare,
  footer,
}: {
  title?: string
  batches: Batch[]
  emptyNote: string
  /** The baseline line, either as raw batches (aggregated here) or pre-aggregated
   *  by-distance stats (baselineStats). Pass at most one. */
  baseline?: Batch[]
  baselineStats?: DistanceStat[]
  baselineLabel?: string
  seriesLabel?: string
  /** Draw the chart frame even with no putts in the set, rather than the note. */
  alwaysRenderChart?: boolean
  /** Dim the whole panel (e.g. a read-only viewer who can't record). */
  faded?: boolean
  /** An extra solid comparison line (e.g. another player) drawn alongside the
   *  primary and baseline, with its own legend key. */
  compare?: { label: string; color: string; stats: DistanceStat[] }
  /** Extra content pinned to the bottom of the panel, below the chart and legend. */
  footer?: ReactNode
}) {
  const stats = statsByDistance(batches)
  const baselineStats = baselineStatsProp ?? (baseline ? statsByDistance(baseline) : [])
  const showChart = alwaysRenderChart || stats.length > 0
  const showToday = stats.length > 0
  const showBaseline = baselineStats.length > 0
  const showCompare = !!compare && compare.stats.length > 0
  // Label each line that's actually drawn. The baseline anchors the legend (it's the
  // ambiguous grey line), so a read-only viewer with no "Today" line still sees the
  // "All-time" key; a writer with both gets both.
  const showLegend = showChart && (showBaseline || showCompare)

  const series: SeriesSpec[] = [
    { id: 'series', label: seriesLabel, color: BRAND, stats, emphasis: true },
  ]
  if (showBaseline) {
    series.push({ id: 'baseline', label: baselineLabel, color: BASELINE, stats: baselineStats, dashed: true })
  }
  if (showCompare) {
    // Emphasized so the compare line/dots match the primary player's weight (the
    // two are equals), while the grey baseline stays thin and behind both.
    series.push({ id: 'compare', label: compare.label, color: compare.color, stats: compare.stats, emphasis: true })
  }

  return (
    <div className={faded ? 'panel chart-panel chart-panel-faded' : 'panel chart-panel'}>
      {title && <h2 className="section-title">{title}</h2>}
      {!showChart ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <>
          <PuttingChart series={series} />
          {showLegend && (
            <ul className="chart-legend">
              {showToday && (
                <li>
                  <span className="legend-swatch" style={{ background: BRAND }} aria-hidden="true" />
                  {seriesLabel}
                </li>
              )}
              {showBaseline && (
                <li>
                  <span className="legend-swatch" style={{ background: BASELINE }} aria-hidden="true" />
                  {baselineLabel}
                </li>
              )}
              {showCompare && (
                <li>
                  <span className="legend-swatch" style={{ background: compare.color }} aria-hidden="true" />
                  {compare.label}
                </li>
              )}
            </ul>
          )}
        </>
      )}
      {footer}
    </div>
  )
}
