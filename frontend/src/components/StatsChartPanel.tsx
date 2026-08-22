/**
 * A titled panel wrapping the make-percentage-by-distance chart.
 *
 * Presentational: the caller passes an already-scoped set of batches (today's
 * test, today's everything, all-time, …) and a title. Shows a note instead of an
 * empty chart when the set has no putts.
 */
import { statsByDistance, type Batch } from '../lib/putting'
import PuttingChart from './PuttingChart'

export default function StatsChartPanel({
  title,
  batches,
  emptyNote,
}: {
  title: string
  batches: Batch[]
  emptyNote: string
}) {
  const stats = statsByDistance(batches)
  return (
    <div className="panel chart-panel">
      <h2 className="section-title">{title}</h2>
      {stats.length === 0 ? <p className="muted">{emptyNote}</p> : <PuttingChart stats={stats} />}
    </div>
  )
}
