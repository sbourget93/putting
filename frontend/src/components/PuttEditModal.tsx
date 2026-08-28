/**
 * Quick-correct dialog for a single daily-test batch.
 *
 * It mirrors the daily prompt: the same big distance, the "How many did you make?"
 * sub, and the same 0–TEST_PUTTS made buttons. Tapping a number only selects it;
 * an explicit Save commits the corrected count (the caller turns it into a
 * BatchEdited event), so a misfire is harmless until confirmed — the same
 * select-then-Save flow as the role editor. Only the made count changes; distance
 * and size are fixed slots in the test.
 *
 * The solid brand fill tracks the working selection, while a dashed brand outline
 * stays on the originally-recorded value, so after a few taps it's still clear
 * where you started. Closes on Escape or a backdrop tap.
 */
import { useEffect, useState } from 'react'
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
  const [selected, setSelected] = useState<number>(batch.made)

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  function save() {
    if (selected !== batch.made) onPick(selected)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal putt-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${batch.distance} ft putt`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="prompt-label">Edit putt from</p>
        <p className="prompt-distance">
          {batch.distance} <span className="unit">ft</span>
        </p>
        <p className="prompt-sub">How many did you <em>actually</em> make?</p>
        <div className="made-buttons">
          {Array.from({ length: TEST_PUTTS + 1 }, (_, n) => {
            const isOriginal = n === batch.made
            const className = ['made-btn']
            if (n === selected) className.push('current')
            if (isOriginal) className.push('orig')
            return (
              <button
                key={n}
                type="button"
                className={className.join(' ')}
                aria-pressed={n === selected}
                aria-label={isOriginal ? `${n}, originally recorded` : undefined}
                onClick={() => setSelected(n)}
              >
                {n}
              </button>
            )
          })}
        </div>
        <div className="putt-modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected === batch.made}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
