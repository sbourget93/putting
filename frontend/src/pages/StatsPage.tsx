/**
 * Stats — make percentage by distance, as a line chart over all history.
 *
 * Free and test batches are combined; each distance's percentage is total made
 * over total attempted (see statsByDistance). Non-admins see the demo owner's.
 */
import { useMemo } from 'react'
import { usePuttingData } from '../lib/usePuttingData'
import { statsByDistance } from '../lib/putting'
import PuttingChart from '../components/PuttingChart'
import './StatsPage.css'

function StatsPage() {
  const { batches, loading, error } = usePuttingData()
  const stats = useMemo(() => statsByDistance(batches), [batches])

  const totalMade = stats.reduce((sum, s) => sum + s.made, 0)
  const totalAttempts = stats.reduce((sum, s) => sum + s.attempts, 0)
  const overall = totalAttempts ? Math.round((100 * totalMade) / totalAttempts) : 0

  if (loading) return <section className="page"><p className="muted">Loading…</p></section>

  return (
    <section className="page stats">
      <div className="page-head">
        <h1>Stats</h1>
        {totalAttempts > 0 && <span className="progress-pill">{overall}% overall</span>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {stats.length === 0 ? (
        <div className="panel"><p className="muted">No putts recorded yet.</p></div>
      ) : (
        <div className="panel chart-panel">
          <PuttingChart stats={stats} />
          <p className="chart-caption muted">
            {totalMade} made of {totalAttempts} across {stats.length} distance
            {stats.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}
    </section>
  )
}

export default StatsPage
