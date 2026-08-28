/**
 * Delete-confirmation dialog for a single daily-test batch.
 *
 * Laid out like the edit popup (PuttEditModal): centered, the same small label,
 * big distance, and sub line — so the two read as one family. It states what was
 * recorded and offers Cancel / Delete; confirming removes the batch (the caller
 * turns it into a BatchDeleted event), which frees the slot to be recorded again.
 * Shares the .putt-modal styles from PuttEditModal.css. Closes on Escape or a
 * backdrop tap (both count as cancel).
 */
import { useEffect } from 'react'
import type { Batch } from '../lib/putting'
import './PuttEditModal.css'

export default function PuttDeleteModal({
  batch,
  onConfirm,
  onCancel,
}: {
  batch: Batch
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal putt-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete ${batch.distance} ft batch`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="prompt-label">Delete batch from</p>
        <p className="prompt-distance">
          {batch.distance} <span className="unit">ft</span>
        </p>
        <p className="prompt-sub">
          You recorded {batch.made} out of {batch.batch_size}
        </p>
        <div className="putt-modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
