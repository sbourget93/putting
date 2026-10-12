/**
 * Miss picker — where did this putt miss?
 *
 * Opened from a single putt slot in the daily prompt when the user tracks misses.
 * It shows the basket with a soft 3×3 grid laid over it (MISS_GRID): tap a cell to
 * record the direction the putt missed. The centre cell is a spit-out (the putt hit
 * the basket and popped out). "I actually made this putt" is the escape hatch for a
 * slot opened by mistake, or to undo a miss — it marks the slot made and closes.
 *
 * Picking only reports the choice up; the parent slot owns the state, so reopening
 * the same slot shows the current pick highlighted. Closes on Escape or a backdrop
 * tap, matching the other daily-test popups.
 */
import { useEffect } from 'react'
import { MISS_GRID, MISS_LABELS } from '../lib/putting'
import type { MissType } from '../lib/putting'
import basket from '../assets/basket.png'
import './MissPicker.css'

export default function MissPicker({
  distance,
  puttNumber,
  selected,
  onPick,
  onMade,
  onClose,
}: {
  distance: number
  puttNumber: number
  selected: MissType | null
  onPick: (miss: MissType) => void
  onMade: () => void
  onClose: () => void
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
        className="modal miss-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Where did putt ${puttNumber} from ${distance} ft miss?`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="prompt-label">Putt {puttNumber}</p>
        <p className="prompt-sub miss-sub">Where did it miss?</p>

        <div className="miss-target">
          <img src={basket} alt="" className="miss-basket" aria-hidden="true" />
          <div className="miss-grid" role="group" aria-label="Miss location">
            {MISS_GRID.flat().map((miss) => (
              // The cell holds no text or glyph: the basket shows through, and the
              // chosen cell is marked only by a red overlay over that spot.
              <button
                key={miss}
                type="button"
                className={miss === selected ? 'miss-cell selected' : 'miss-cell'}
                aria-pressed={miss === selected}
                aria-label={MISS_LABELS[miss]}
                onClick={() => onPick(miss)}
              />
            ))}
          </div>
        </div>

        <div className="putt-modal-actions miss-modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn miss-made-btn" onClick={onMade}>
            It went in!
          </button>
        </div>
      </div>
    </div>
  )
}
