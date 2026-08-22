/**
 * The stats line chart scoped to today's daily test.
 *
 * Same chart the Stats page shows, but over only today's test batches, so the
 * Daily Test and Free Putt pages can show "how am I putting today". Renders a note
 * instead of an empty chart when today's test hasn't produced any putts yet.
 */
import { findTest, statsByDistance, testBatches, type Batch, type Test } from '../lib/putting'
import PuttingChart from './PuttingChart'

export default function TodayTestChart({ batches, tests }: { batches: Batch[]; tests: Test[] }) {
  const test = findTest(tests)
  const todays = testBatches(batches, test?.test_id ?? null)
  const stats = statsByDistance(todays)

  return (
    <div className="panel chart-panel">
      <h2 className="section-title">Today's test</h2>
      {stats.length === 0 ? (
        <p className="muted">No daily-test putts yet today.</p>
      ) : (
        <PuttingChart stats={stats} />
      )}
    </div>
  )
}
