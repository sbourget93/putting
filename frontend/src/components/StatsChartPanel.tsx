/**
 * A titled panel wrapping the make-percentage-by-distance chart.
 *
 * Presentational: the caller passes an already-scoped set of batches (today's
 * test, all-time, …) and a title. An optional `baseline` set is drawn as a grey
 * comparison line behind the primary one, with a one-line legend beneath the
 * chart. Shows a note instead of an empty chart when the set has no putts.
 */
import { statsByDistance, type Batch } from '../lib/putting'
import PuttingChart from './PuttingChart'

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

  return (
    <div className="panel chart-panel">
      <h2 className="section-title">{title}</h2>
      {stats.length === 0 ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <>
          <PuttingChart stats={stats} baseline={baselineStats} />
          {showLegend && (
            <ul className="chart-legend">
              <li>
                <span className="legend-swatch series" aria-hidden="true" />
                {seriesLabel}
              </li>
              <li>
                <span className="legend-swatch baseline" aria-hidden="true" />
                {baselineLabel}
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  )
}
