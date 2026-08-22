/**
 * Free Putt — record ad-hoc batches at any distance.
 *
 * Pick a distance and batch size from horizontal strips, then tap the number you
 * made to record the batch in one press. Distance and batch size stick between
 * records for quick repeated entry. Each tap is one BatchRecorded (kind 'free').
 * Below the form is today's test chart. Non-admins can't record but still see it.
 */
import { useMemo, useState } from 'react'
import { useSync } from '../offline/SyncContext'
import { newEvent } from '../offline/commands'
import { usePuttingData } from '../lib/usePuttingData'
import NumberStrip from '../components/NumberStrip'
import TodayTestChart from '../components/TodayTestChart'
import { clamp, FREE_DEFAULT_BATCH, FREE_MAX, FREE_MIN } from '../lib/putting'
import './FreePuttPage.css'

const DISTANCES = Array.from({ length: FREE_MAX - FREE_MIN + 1 }, (_, i) => FREE_MIN + i)
const BATCH_SIZES = Array.from({ length: 50 }, (_, i) => i + 1)

function FreePuttPage() {
  const { enqueue } = useSync()
  const { tests, batches, readOnly } = usePuttingData()

  const [distance, setDistance] = useState(20)
  const [batchSize, setBatchSize] = useState(FREE_DEFAULT_BATCH)
  const [justSaved, setJustSaved] = useState<string | null>(null)

  const madeOptions = useMemo(
    () => Array.from({ length: batchSize + 1 }, (_, i) => i),
    [batchSize],
  )

  function record(made: number) {
    enqueue([
      newEvent('BatchRecorded', crypto.randomUUID(), {
        kind: 'free',
        distance,
        batch_size: batchSize,
        made,
      }),
    ])
    setJustSaved(`Saved ${made}/${batchSize} from ${distance} ft ✓`)
    window.setTimeout(() => setJustSaved(null), 1800)
  }

  return (
    <section className="page free-putt">
      <div className="page-head">
        <h1>Free Putt</h1>
      </div>

      {readOnly ? (
        <div className="panel">
          <p className="muted">Recording is for signed-in admins. You can still browse the demo's History and Stats.</p>
        </div>
      ) : (
        <div className="panel free-form">
          <div className="field-block">
            <span className="field-label">Distance <em>{distance} ft</em></span>
            <NumberStrip
              values={DISTANCES}
              selected={distance}
              onSelect={setDistance}
              suffix="′"
              ariaLabel="Distance in feet"
            />
          </div>

          <div className="field-block">
            <span className="field-label">Batch size <em>{batchSize}</em></span>
            <NumberStrip
              values={BATCH_SIZES}
              selected={batchSize}
              onSelect={(n) => setBatchSize(clamp(n, 1, 50))}
              ariaLabel="Batch size"
            />
          </div>

          <div className="field-block">
            <span className="field-label">How many did you make?</span>
            <NumberStrip
              values={madeOptions}
              onSelect={record}
              ariaLabel="Number made"
              mode="action"
            />
          </div>

          <p className="save-note" aria-live="polite">{justSaved ?? ' '}</p>
        </div>
      )}

      <TodayTestChart batches={batches} tests={tests} />
    </section>
  )
}

export default FreePuttPage
