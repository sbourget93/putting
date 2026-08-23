/**
 * A titled panel wrapping the make-percentage-by-distance chart.
 *
 * Presentational: the caller passes an already-scoped set of batches (today's
 * test, all-time, …) and a title. An optional `baseline` set is drawn as a grey
 * dashed comparison line behind the primary one, with a one-line legend beneath
 * the chart. Shows a note instead of an empty chart when the set has no putts.
 */
import { statsByDistance, type Batch } from '../lib/putting'
import PuttingChart, { type SeriesSpec } from './PuttingChart'

const BRAND = 'var(--brand)'
const BASELINE = 'color-mix(in srgb, CanvasText 30%, Canvas)'

export default function StatsChartPanel({
  title,
  batches,
  emptyNote,
  baseline,
  baselineLabel = 'All-time',
  seriesLabel = 'Today',
}: {
  title: string
  batches: Batch[]
  emptyNote: string
  baseline?: Batch[]
  baselineLabel?: string
  seriesLabel?: string
}) {
  const stats = statsByDistance(batches)
  const baselineStats = baseline ? statsByDistance(baseline) : []
  const showLegend = baselineStats.length > 0 && stats.length > 0

  const series: SeriesSpec[] = [
    { id: 'series', label: seriesLabel, color: BRAND, stats, emphasis: true },
  ]
  if (baselineStats.length > 0) {
    series.push({ id: 'baseline', label: baselineLabel, color: BASELINE, stats: baselineStats, dashed: true })
  }

  return (
    <div className="panel chart-panel">
      <h2 className="section-title">{title}</h2>
      {stats.length === 0 ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <>
          <PuttingChart series={series} />
          {showLegend && (
            <ul className="chart-legend">
              <li>
                <span className="legend-swatch" style={{ background: BRAND }} aria-hidden="true" />
                {seriesLabel}
              </li>
              <li>
                <span className="legend-swatch" style={{ background: BASELINE }} aria-hidden="true" />
                {baselineLabel}
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  )
}
