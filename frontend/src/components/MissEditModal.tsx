/**
 * Miss-aware correction dialog for a completed batch (shown when the user tracks
 * misses, in place of the count-only PuttEditModal).
 *
 * It mirrors the daily miss prompt inside a modal: the batch's five putts as slots,
 * each tappable to open the basket picker and set where it missed (or mark it made).
 * The made count is derived from the slots, so a misfire is harmless until Save,
 * which hands the updated putts up for the caller to turn into PuttEdited events
 * (and a BatchEdited for the new count). Closes on Escape or a backdrop tap.
 *
 * A batch recorded in count mode has misses with no direction yet; those slots show
 * a plain cross until the user picks one. Reuses the modal shell from PuttEditModal.
 */
import { useEffect, useState } from 'react'
import PuttSlots, { type PuttSlot } from './PuttSlots'
import type { Batch, MissType, Putt } from '../lib/putting'
import './PuttEditModal.css'

export default function MissEditModal({
  batch,
  putts,
  onClose,
  onSave,
}: {
  batch: Batch
  putts: Putt[]
  onClose: () => void
  onSave: (updated: { putt_id: string; made: boolean; miss_type: MissType | null }[]) => void
}) {
  const [slots, setSlots] = useState<PuttSlot[]>(
    putts.map((p) => ({ made: p.made, miss: p.miss_type })),
  )
  // While the basket picker is open on top, it owns Escape and backdrop taps; this
  // modal stays put so backing out of the picker doesn't discard the whole edit.
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pickerOpen) onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose, pickerOpen])

  const madeCount = slots.filter((s) => s.made).length
  const changed = slots.some((s, i) => {
    const miss = s.made ? null : s.miss
    return s.made !== putts[i].made || miss !== putts[i].miss_type
  })

  function save() {
    if (changed) {
      onSave(
        putts.map((p, i) => ({
          putt_id: p.putt_id,
          made: slots[i].made,
          miss_type: slots[i].made ? null : slots[i].miss,
        })),
      )
    }
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={() => !pickerOpen && onClose()}>
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
        <p className="prompt-sub">
          {madeCount} of {batch.batch_size} made
        </p>

        <PuttSlots
          slots={slots}
          distance={batch.distance}
          onChange={(i, slot) => setSlots((prev) => prev.map((s, j) => (j === i ? slot : s)))}
          onPickingChange={setPickerOpen}
        />

        <div className="putt-modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!changed} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
