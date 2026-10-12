/**
 * A row of five putt slots, shared by the daily miss prompt and the miss-aware edit
 * modal. Each slot is made (a green check) or a miss (red, with the direction glyph,
 * or a plain cross when the direction is unknown). Tapping a slot opens the
 * MissPicker to say where it missed, or to mark it made.
 *
 * Controlled: the parent owns the slots and gets each change through onChange, so it
 * can turn them into PuttRecorded (record) or PuttEdited (edit) events. The picker
 * open/close state is the only thing this component keeps to itself.
 */
import { useEffect, useState } from 'react'
import MissPicker from './MissPicker'
import { MISS_GLYPH, MISS_LABELS, type MissType } from '../lib/putting'
import './PuttSlots.css'

/** One slot's state: made, or a miss whose direction may not be known yet. */
export type PuttSlot = { made: boolean; miss: MissType | null }

export default function PuttSlots({
  slots,
  distance,
  disabled = false,
  onChange,
  onPickingChange,
}: {
  slots: PuttSlot[]
  distance: number
  disabled?: boolean
  onChange: (index: number, slot: PuttSlot) => void
  // Fires when the picker opens/closes, so a parent modal can stop its own
  // Escape/backdrop close from firing through the picker on top of it.
  onPickingChange?: (open: boolean) => void
}) {
  const [picking, setPicking] = useState<number | null>(null)
  const active = picking != null ? slots[picking] : null

  useEffect(() => {
    onPickingChange?.(picking != null)
  }, [picking, onPickingChange])

  return (
    <>
      <div className="putt-slots">
        {slots.map((slot, i) => {
          const label = slot.made
            ? `Putt ${i + 1}: made, tap to mark a miss`
            : slot.miss
              ? `Putt ${i + 1}: missed ${MISS_LABELS[slot.miss].toLowerCase()}, tap to change`
              : `Putt ${i + 1}: missed, tap to set where`
          const mark = slot.made ? '✓' : slot.miss ? MISS_GLYPH[slot.miss] : '✗'
          return (
            <button
              key={i}
              type="button"
              className={slot.made ? 'putt-slot made' : 'putt-slot miss'}
              disabled={disabled}
              aria-label={label}
              onClick={() => setPicking(i)}
            >
              <span className="putt-slot-mark" aria-hidden="true">
                {mark}
              </span>
            </button>
          )
        })}
      </div>

      {picking != null && (
        <MissPicker
          distance={distance}
          puttNumber={picking + 1}
          selected={active && !active.made ? active.miss : null}
          onPick={(miss) => {
            onChange(picking, { made: false, miss })
            setPicking(null)
          }}
          onMade={() => {
            onChange(picking, { made: true, miss: null })
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
