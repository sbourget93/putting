/**
 * Quick-correct dialog for a single daily-test batch.
 *
 * A fat-finger fix: it shows the distance and the same 0–TEST_PUTTS buttons as the
 * daily prompt, and picking one reports the corrected made count (the caller turns
 * it into a BatchEdited event). Only the made count changes — distance and size are
 * fixed slots in the test. Closes on Escape or a backdrop tap.
 */
import { useEffect } from 'react'
import { TEST_PUTTS, type Batch } from '../lib/putting'
import './PuttEditModal.css'

export default function PuttEditModal({
  batch,
  onClose,
  onPick,
}: {
  batch: Batch
  onClose: () => void
  onPick: (made: number) => void
}) {
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${batch.distance} ft putt`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">
          {batch.distance} ft — how many made?
        </h2>
        <div className="putt-edit-buttons">
          {Array.from({ length: TEST_PUTTS + 1 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={n === batch.made ? 'made-btn current' : 'made-btn'}
              aria-pressed={n === batch.made}
              onClick={() => {
                if (n !== batch.made) onPick(n)
                onClose()
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
